import { enumerateBattlePlans, filledEntries } from './candidates';
import { baseSpeciesForMega, findMove, findPair, findSpecies, indexedData, isMegaSpecies } from './data';
import { effectiveness, multiplierLabel } from './typeChart';
import type { BattlePlan, IndexedData, MetaSpecies, MoveData, PokemonEntry, PokemonType, Recommendation, ScoreReason } from './types';

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const nonEmptyMoves = (pokemon: PokemonEntry): string[] => pokemon.moves.map((move) => move.trim()).filter(Boolean);

const speciesMeta = (pokemon: PokemonEntry, data: IndexedData): MetaSpecies | undefined => findSpecies(pokemon.species, data);

const demoteMegaEntry = (pokemon: PokemonEntry, data: IndexedData): PokemonEntry => {
  const species = baseSpeciesForMega(pokemon.species, data);
  const meta = findSpecies(species, data);
  const currentAbility = pokemon.ability?.trim();
  const baseAbilities = new Set(meta?.abilities ?? []);
  const ability = !currentAbility || baseAbilities.has(currentAbility) ? currentAbility : meta?.abilities[0] ?? '';

  return {
    ...pokemon,
    species: meta?.displayName ?? species,
    types: meta?.types ?? pokemon.types,
    ability,
    speedStat: null
  };
};

const withMegaLimit = (plan: BattlePlan, data: IndexedData): Array<{ plan: BattlePlan; warning?: string }> => {
  const megaEntries = plan.brought.filter((pokemon) => isMegaSpecies(pokemon.species));
  if (megaEntries.length <= 1) return [{ plan }];

  return megaEntries.map((activeMega) => {
    const demoted = new Map(
      megaEntries
        .filter((pokemon) => pokemon.id !== activeMega.id)
        .map((pokemon) => [pokemon.id, demoteMegaEntry(pokemon, data)])
    );
    const applyLimit = (pokemon: PokemonEntry) => demoted.get(pokemon.id) ?? pokemon;
    const demotedNames = [...demoted.values()].map((pokemon) => pokemon.species);
    const warning = `Mega limit: ${activeMega.species} is the active Mega; ${demotedNames.join(', ')} ${demotedNames.length === 1 ? 'is' : 'are'} scored as regular.`;

    return {
      plan: {
        brought: plan.brought.map(applyLimit),
        leads: plan.leads.map(applyLimit),
        backs: plan.backs.map(applyLimit)
      },
      warning
    };
  });
};

const entryTypes = (pokemon: PokemonEntry, data: IndexedData): PokemonType[] => {
  return speciesMeta(pokemon, data)?.types ?? pokemon.types;
};

const entrySpeed = (pokemon: PokemonEntry, data: IndexedData): number | undefined => {
  if (typeof pokemon.speedStat === 'number' && pokemon.speedStat > 0) return pokemon.speedStat;
  return speciesMeta(pokemon, data)?.baseStats.speed;
};

const entryTags = (pokemon: PokemonEntry, data: IndexedData): Set<string> => {
  const tags = new Set<string>(speciesMeta(pokemon, data)?.roleTags ?? []);
  nonEmptyMoves(pokemon).forEach((moveName) => {
    findMove(moveName, data)?.tags.forEach((tag) => tags.add(tag));
  });
  const ability = pokemon.ability?.toLowerCase() ?? '';
  if (ability.includes('intimidate')) tags.add('intimidate');
  if (ability.includes('prankster')) tags.add('speed-control');
  if (ability.includes('drizzle') || ability.includes('drought')) tags.add('weather');
  if (ability.includes('friend guard')) tags.add('support');
  if (ability.includes('toxic debris')) tags.add('hazard');
  return tags;
};

const attackingTypes = (pokemon: PokemonEntry, data: IndexedData): PokemonType[] => {
  const moveTypes = nonEmptyMoves(pokemon)
    .map((moveName) => findMove(moveName, data)?.type)
    .filter((type): type is PokemonType => Boolean(type));

  if (moveTypes.length > 0) return Array.from(new Set(moveTypes));

  const commonMoveTypes = (speciesMeta(pokemon, data)?.commonMoves ?? [])
    .map((moveName) => findMove(moveName, data)?.type)
    .filter((type): type is PokemonType => Boolean(type));

  return Array.from(new Set([...commonMoveTypes, ...entryTypes(pokemon, data)]));
};

const bestOffensiveMultiplier = (attacker: PokemonEntry, defender: PokemonEntry, data: IndexedData): number => {
  const defenderTypes = entryTypes(defender, data);
  if (defenderTypes.length === 0) return 1;

  const attackTypes = attackingTypes(attacker, data);
  if (attackTypes.length === 0) return 1;

  return Math.max(...attackTypes.map((type) => effectiveness(type, defenderTypes)));
};

const threatMultiplierInto = (attacker: PokemonEntry, defender: PokemonEntry, data: IndexedData): number => {
  const defenderTypes = entryTypes(defender, data);
  if (defenderTypes.length === 0) return 1;

  const attackTypes = attackingTypes(attacker, data);
  if (attackTypes.length === 0) return 1;

  return Math.max(...attackTypes.map((type) => effectiveness(type, defenderTypes)));
};

const addReason = (reasons: ScoreReason[], label: string, detail: string, weight: number, tone: ScoreReason['tone'] = 'positive') => {
  reasons.push({ label, detail, weight, tone });
};

const scoreOffense = (plan: BattlePlan, opponents: PokemonEntry[], data: IndexedData, reasons: ScoreReason[]): number => {
  if (opponents.length === 0) return 16;

  let score = 0;
  const highValueTargets: string[] = [];
  const deadZones: string[] = [];

  opponents.forEach((opponent) => {
    const best = Math.max(...plan.brought.map((pokemon) => bestOffensiveMultiplier(pokemon, opponent, data)));
    if (best >= 2) highValueTargets.push(opponent.species);
    if (best <= 0.5) deadZones.push(opponent.species);

    if (best >= 4) score += 7;
    else if (best >= 2) score += 4.5;
    else if (best === 1) score += 1.8;
    else if (best > 0) score -= 1.2;
    else score -= 3;
  });

  const capped = clamp(score, -10, 28);
  if (highValueTargets.length >= Math.ceil(opponents.length / 2)) {
    addReason(reasons, 'Coverage', `Super-effective pressure into ${highValueTargets.slice(0, 4).join(', ')}.`, 3.5);
  }
  if (deadZones.length > 0) {
    addReason(reasons, 'Coverage gap', `Limited immediate pressure into ${deadZones.slice(0, 3).join(', ')}.`, -2.5, 'warning');
  }
  return capped;
};

const scoreDefense = (plan: BattlePlan, opponents: PokemonEntry[], data: IndexedData, reasons: ScoreReason[], warnings: string[]): number => {
  if (opponents.length === 0) return 12;

  let score = 12;
  const vulnerable: string[] = [];
  const sturdy: string[] = [];
  const sharedWeaknesses = new Map<PokemonType, number>();

  plan.brought.forEach((pokemon) => {
    const pokemonTypes = entryTypes(pokemon, data);
    if (pokemonTypes.length === 0) return;

    opponents.forEach((opponent) => {
      const mult = threatMultiplierInto(opponent, pokemon, data);
      if (mult >= 2) vulnerable.push(`${pokemon.species} (${multiplierLabel(mult)} from ${opponent.species})`);
      if (mult <= 0.5) sturdy.push(`${pokemon.species} into ${opponent.species}`);
    });

    const incomingTypes = opponents.flatMap((opponent) => attackingTypes(opponent, data));
    incomingTypes.forEach((type) => {
      if (effectiveness(type, pokemonTypes) >= 2) {
        sharedWeaknesses.set(type, (sharedWeaknesses.get(type) ?? 0) + 1);
      }
    });
  });

  score += sturdy.length * 0.7;
  score -= vulnerable.length * 0.8;

  const overloadedTypes = Array.from(sharedWeaknesses.entries()).filter(([, count]) => count >= 3);
  if (overloadedTypes.length > 0) {
    const summary = overloadedTypes.map(([type, count]) => `${count} weak to ${type}`).join(', ');
    warnings.push(`Shared defensive strain: ${summary}.`);
    score -= overloadedTypes.length * 3;
  }

  if (sturdy.length >= 4) addReason(reasons, 'Defensive pivots', 'Several brought Pokémon resist or blank likely opposing attacks.', 2.5);
  if (vulnerable.length >= 5) addReason(reasons, 'Defensive strain', 'The opponent has multiple clean damage routes into this four.', -3, 'warning');

  return clamp(score, -8, 24);
};

const scoreSpeed = (plan: BattlePlan, opponents: PokemonEntry[], data: IndexedData, reasons: ScoreReason[], warnings: string[]): number => {
  const broughtTags = plan.brought.map((pokemon) => entryTags(pokemon, data));
  const leadTags = plan.leads.map((pokemon) => entryTags(pokemon, data));
  const hasTailwind = broughtTags.some((tags) => tags.has('tailwind'));
  const hasTrickRoom = broughtTags.some((tags) => tags.has('trick-room'));
  const hasSpeedControl = broughtTags.some((tags) => tags.has('speed-control') || tags.has('tailwind') || tags.has('trick-room'));
  const hasLeadSpeedControl = leadTags.some((tags) => tags.has('speed-control') || tags.has('tailwind') || tags.has('trick-room'));
  const opponentHasSpeedControl = opponents.some((pokemon) => {
    const tags = entryTags(pokemon, data);
    return tags.has('speed-control') || tags.has('tailwind') || tags.has('trick-room');
  });

  const leadSpeeds = plan.leads.map((pokemon) => entrySpeed(pokemon, data)).filter((speed): speed is number => typeof speed === 'number');
  const opponentSpeeds = opponents.map((pokemon) => entrySpeed(pokemon, data)).filter((speed): speed is number => typeof speed === 'number');
  const leadSpeedAverage = leadSpeeds.length ? leadSpeeds.reduce((total, speed) => total + speed, 0) / leadSpeeds.length : 80;
  const opponentSpeedAverage = opponentSpeeds.length ? opponentSpeeds.reduce((total, speed) => total + speed, 0) / opponentSpeeds.length : 90;

  let score = 6;
  if (hasSpeedControl) score += 5;
  if (hasLeadSpeedControl) score += 3;
  if (leadSpeedAverage > opponentSpeedAverage + 12) score += 2.5;
  if (leadSpeedAverage < opponentSpeedAverage - 20 && !hasTrickRoom) score -= 2.5;
  if (hasTrickRoom && leadSpeedAverage < opponentSpeedAverage) score += 1.5;
  if (opponentHasSpeedControl && !hasSpeedControl) {
    warnings.push('Opponent preview shows speed-control pressure and this plan does not bring an answer.');
    score -= 4;
  }

  if (hasTailwind) addReason(reasons, 'Speed plan', 'Tailwind gives this four a proactive speed mode.', 2);
  if (hasTrickRoom) addReason(reasons, 'Speed plan', 'Trick Room mode can punish faster opposing leads.', 2);
  if (hasLeadSpeedControl) addReason(reasons, 'Lead tempo', 'The lead pair can change speed immediately.', 1.5);

  return clamp(score, -6, 18);
};

const scoreLead = (plan: BattlePlan, opponents: PokemonEntry[], data: IndexedData, reasons: ScoreReason[]): number => {
  let score = 7;
  const leadTags = plan.leads.map((pokemon) => entryTags(pokemon, data));
  const leadNames = plan.leads.map((pokemon) => pokemon.species).join(' + ');
  const hasHazardLead = leadTags.some((tags) => tags.has('hazard'));
  const hasFastDisruptionLead = plan.leads.some((pokemon, index) => {
    const speed = entrySpeed(pokemon, data) ?? 0;
    const tags = leadTags[index];
    return speed >= 115 && (tags.has('fake-out') || tags.has('priority') || tags.has('disruption') || tags.has('speed-control'));
  });
  const hasWeavileGlimmoraLead =
    plan.leads.some((pokemon) => pokemon.species === 'Weavile') &&
    plan.leads.some((pokemon) => pokemon.species === 'Glimmora' || pokemon.species === 'Mega Glimmora');
  const publicLeadPrior = plan.leads.reduce((total, pokemon) => {
    const meta = speciesMeta(pokemon, data);
    if (!meta?.leadRate) return total;
    const sampleConfidence = clamp((meta.sampleSize ?? 0) / 250, 0, 1);
    return total + clamp(meta.leadRate * 8 * sampleConfidence, 0, 2.4);
  }, 0);

  if (leadTags.some((tags) => tags.has('fake-out'))) score += 3;
  if (leadTags.some((tags) => tags.has('redirection'))) score += 2.5;
  if (leadTags.some((tags) => tags.has('intimidate'))) score += 1.5;
  if (leadTags.some((tags) => tags.has('wide-guard'))) score += opponents.some((opponent) => entryTags(opponent, data).has('spread')) ? 2.5 : 0.8;
  if (hasHazardLead && hasFastDisruptionLead) score += 3.2;
  if (hasWeavileGlimmoraLead) score += 1.2;
  score += publicLeadPrior;
  if (leadTags.every((tags) => tags.has('support') || tags.has('redirection'))) score -= 3;

  const leadPressure = plan.leads.reduce((total, lead) => {
    const bestIntoPreview = opponents.length
      ? Math.max(...opponents.map((opponent) => bestOffensiveMultiplier(lead, opponent, data)))
      : 1;
    return total + (bestIntoPreview >= 2 ? 1.6 : bestIntoPreview === 1 ? 0.6 : -0.6);
  }, 0);
  score += leadPressure;

  if (leadTags.some((tags) => tags.has('fake-out')) || leadTags.some((tags) => tags.has('redirection'))) {
    addReason(reasons, 'Lead shape', `${leadNames} has immediate positioning tools.`, 2);
  }
  if (hasHazardLead && hasFastDisruptionLead) {
    addReason(reasons, 'Lead pressure', `${leadNames} pairs fast disruption with hazard pressure.`, 2.4);
  }
  if (publicLeadPrior >= 1.5) {
    addReason(reasons, 'Public lead data', `${leadNames} has useful lead usage in public Regulation M-A data.`, 1.5, 'neutral');
  }

  return clamp(score, -4, 18);
};

const scoreRoles = (plan: BattlePlan, data: IndexedData, reasons: ScoreReason[], warnings: string[]): number => {
  const tagGroups = plan.brought.map((pokemon) => entryTags(pokemon, data));
  const attackers = tagGroups.filter((tags) => tags.has('physical-attacker') || tags.has('special-attacker')).length;
  const supports = tagGroups.filter((tags) => tags.has('support') || tags.has('redirection') || tags.has('fake-out')).length;
  const pivots = tagGroups.filter((tags) => tags.has('pivot') || tags.has('intimidate')).length;
  const protectCount = plan.brought.filter((pokemon) =>
    nonEmptyMoves(pokemon).some((moveName) => findMove(moveName, data)?.tags.includes('protect'))
  ).length;

  let score = 8;
  if (attackers >= 2) score += 3;
  if (supports >= 1) score += 2;
  if (pivots >= 1) score += 1.5;
  if (protectCount >= 2) score += 1.5;
  if (attackers <= 1) {
    warnings.push('This four may not apply enough damage before the opponent stabilizes.');
    score -= 3;
  }
  if (supports >= 3 && attackers <= 2) score -= 2;

  if (attackers >= 2 && supports >= 1) addReason(reasons, 'Role balance', 'Damage plus support gives the plan room to adapt after preview.', 2);
  if (pivots >= 1) addReason(reasons, 'Positioning', 'Pivot or Intimidate utility helps protect the back line.', 1.5);

  return clamp(score, -4, 17);
};

const scoreMeta = (plan: BattlePlan, data: IndexedData, reasons: ScoreReason[]): number => {
  let score = 0;
  const usageBoost = plan.brought.reduce((total, pokemon) => {
    const meta = speciesMeta(pokemon, data);
    if (!meta) return total;
    const sampleConfidence = clamp((meta.sampleSize ?? 0) / 300, 0, 1);
    const winDelta = ((meta.winRate ?? 0.5) - 0.5) * 12 * sampleConfidence;
    return total + meta.usage * 2.5 + winDelta;
  }, 0);

  const pairBoost = plan.brought.reduce((total, first, index) => {
    return (
      total +
      plan.brought.slice(index + 1).reduce((pairTotal, second) => {
        const pair = findPair(first.species, second.species, data);
        if (!pair) return pairTotal;
        const confidence = clamp((pair.sampleSize ?? 0) / 180, 0, 1);
        return pairTotal + pair.frequency * 8 + ((pair.winRate ?? 0.5) - 0.5) * 10 * confidence;
      }, 0)
    );
  }, 0);

  score = usageBoost + pairBoost;
  if (pairBoost > 1.2) addReason(reasons, 'Known core', 'This four includes pairings with useful public-meta priors.', 1.2, 'neutral');
  return clamp(score, 0, 10);
};

const confidenceFor = (plan: BattlePlan, opponents: PokemonEntry[], data: IndexedData): number => {
  const allVisible = [...plan.brought, ...opponents];
  const knownSpecies = allVisible.filter((pokemon) => speciesMeta(pokemon, data)).length;
  const knownTypes = allVisible.filter((pokemon) => entryTypes(pokemon, data).length > 0).length;
  const knownMoveSlots = plan.brought.reduce((total, pokemon) => total + nonEmptyMoves(pokemon).length, 0);
  const opponentDetail = opponents.reduce((total, pokemon) => {
    if (pokemon.item || pokemon.ability || nonEmptyMoves(pokemon).length > 0 || pokemon.speedStat) return total + 1;
    return total;
  }, 0);

  const base = 0.42;
  const dataScore = allVisible.length ? (knownSpecies + knownTypes) / (allVisible.length * 2) : 0.25;
  const setScore = clamp(knownMoveSlots / 24, 0, 1);
  const previewScore = opponents.length ? clamp(opponentDetail / opponents.length, 0, 1) : 0;
  return clamp(base + dataScore * 0.25 + setScore * 0.2 + previewScore * 0.13, 0.25, 0.92);
};

const recommendationTags = (plan: BattlePlan, data: IndexedData): string[] => {
  const tags = new Set<string>();
  plan.brought.forEach((pokemon) => {
    const pokemonTags = entryTags(pokemon, data);
    if (pokemonTags.has('tailwind')) tags.add('Tailwind');
    if (pokemonTags.has('trick-room')) tags.add('Trick Room');
    if (pokemonTags.has('fake-out')) tags.add('Fake Out');
    if (pokemonTags.has('redirection')) tags.add('Redirection');
    if (pokemonTags.has('weather')) tags.add('Weather');
    if (pokemonTags.has('wide-guard')) tags.add('Wide Guard');
    if (pokemonTags.has('priority')) tags.add('Priority');
    if (pokemonTags.has('hazard')) tags.add('Hazard Pressure');
  });
  return Array.from(tags).slice(0, 5);
};

export const scoreBattlePlan = (
  plan: BattlePlan,
  opponents: PokemonEntry[],
  data: IndexedData = indexedData
): Recommendation => {
  const variants = withMegaLimit(plan, data);
  if (variants.length > 1) {
    return variants
      .map((variant) => scoreSingleBattlePlan(variant.plan, opponents, data, variant.warning))
      .sort((a, b) => b.score - a.score)[0];
  }

  return scoreSingleBattlePlan(variants[0].plan, opponents, data, variants[0].warning);
};

const scoreSingleBattlePlan = (
  plan: BattlePlan,
  opponents: PokemonEntry[],
  data: IndexedData,
  megaLimitWarning?: string
): Recommendation => {
  const reasons: ScoreReason[] = [];
  const warnings: string[] = megaLimitWarning ? [megaLimitWarning] : [];
  const visibleOpponents = filledEntries(opponents);

  const offense = scoreOffense(plan, visibleOpponents, data, reasons);
  const defense = scoreDefense(plan, visibleOpponents, data, reasons, warnings);
  const speed = scoreSpeed(plan, visibleOpponents, data, reasons, warnings);
  const lead = scoreLead(plan, visibleOpponents, data, reasons);
  const roles = scoreRoles(plan, data, reasons, warnings);
  const meta = scoreMeta(plan, data, reasons);
  const score = clamp(offense + defense + speed + lead + roles + meta, 0, 100);

  const sortedReasons = reasons
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 5);

  return {
    ...plan,
    score: Math.round(score * 10) / 10,
    confidence: confidenceFor(plan, visibleOpponents, data),
    tags: recommendationTags(plan, data),
    reasons: sortedReasons,
    warnings: Array.from(new Set(warnings)).slice(0, 4),
    breakdown: { offense, defense, speed, lead, roles, meta }
  };
};

export const recommendPlans = (
  team: PokemonEntry[],
  opponents: PokemonEntry[],
  data: IndexedData = indexedData
): Recommendation[] =>
  enumerateBattlePlans(team)
    .map((plan) => scoreBattlePlan(plan, opponents, data))
    .sort((a, b) => b.score - a.score)
    .map((recommendation, index, all) => ({
      ...recommendation,
      confidence: clamp(recommendation.confidence - index * 0.002 + (recommendation.score - (all.at(-1)?.score ?? 0)) / 1000, 0.25, 0.94)
    }));
