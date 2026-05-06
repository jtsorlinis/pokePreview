import { enumerateBattlePlans, filledEntries } from './candidates';
import { baseSpeciesForMega, findMove, findPair, findSpecies, indexedData, isMegaSpecies, normalizeKey } from './data';
import { inferOpponentPreview } from './opponentInference';
import { effectiveness, multiplierLabel } from './typeChart';
import type { BattlePlan, IndexedData, MetaSpecies, MoveData, OpponentInference, PokemonEntry, PokemonType, Recommendation, ScoreReason } from './types';

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const nonEmptyMoves = (pokemon: PokemonEntry): string[] => pokemon.moves.map((move) => move.trim()).filter(Boolean);

const speciesMeta = (pokemon: PokemonEntry, data: IndexedData): MetaSpecies | undefined => findSpecies(pokemon.species, data);

const hasExplicitMove = (pokemon: PokemonEntry, moveKey: string): boolean =>
  nonEmptyMoves(pokemon).some((moveName) => normalizeKey(moveName) === moveKey);

const hasExplicitPerishSong = (pokemon: PokemonEntry): boolean => hasExplicitMove(pokemon, 'perishsong');

interface StrategyContext {
  perishTrap: boolean;
}

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
    speedStat: null,
    inactiveMegaSpecies: pokemon.species
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

const isLikelyMegaStoneForBase = (item: string, baseSpecies: string): boolean => {
  const itemKey = item.trim().toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '');
  const baseKey = baseSpecies.trim().toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '');
  if (!/ite[xy]?$/.test(itemKey) || baseKey.length < 4) return false;

  return itemKey.includes(baseKey.slice(0, Math.min(6, baseKey.length)));
};

const regularFormViability = (pokemon: PokemonEntry, data: IndexedData): number => {
  const meta = speciesMeta(pokemon, data);
  if (!meta) return 0.3;

  const commonItems = meta.commonItems ?? [];
  const nonMegaItemShare = commonItems.length
    ? commonItems.filter((item) => !isLikelyMegaStoneForBase(item, meta.displayName)).length / commonItems.length
    : 0.25;
  const tags = new Set(meta.roleTags);
  const utilityScore =
    (tags.has('lead-pressure') ? 0.16 : 0) +
    (tags.has('fake-out') ? 0.18 : 0) +
    (tags.has('tailwind') || tags.has('trick-room') || tags.has('speed-control') ? 0.16 : 0) +
    (tags.has('intimidate') || tags.has('redirection') || tags.has('wide-guard') ? 0.14 : 0) +
    (tags.has('pivot') ? 0.08 : 0);
  const usageWithNonMegaEvidence = clamp(meta.usage * 2.5, 0, 0.28) * nonMegaItemShare * clamp((meta.sampleSize ?? 0) / 250, 0.25, 1);

  return clamp(0.08 + nonMegaItemShare * 0.42 + utilityScore + usageWithNonMegaEvidence, 0.06, 1);
};

const inactiveMegaMultiplier = (pokemon: PokemonEntry, data: IndexedData): number => {
  if (!pokemon.inactiveMegaSpecies) return 1;
  return clamp(regularFormViability(pokemon, data), 0.08, 1);
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
    const moveKey = normalizeKey(moveName);
    if (moveKey === 'perishsong') tags.add('perish');
    if (['encore', 'disable', 'taunt'].includes(moveKey)) tags.add('disruption');
  });
  const abilityText = [pokemon.ability ?? '', ...(speciesMeta(pokemon, data)?.abilities ?? [])].join(' ').toLowerCase();
  if (abilityText.includes('intimidate')) tags.add('intimidate');
  if (abilityText.includes('prankster')) tags.add('speed-control');
  if (abilityText.includes('drizzle') || abilityText.includes('drought')) tags.add('weather');
  if (abilityText.includes('friend guard')) tags.add('support');
  if (abilityText.includes('shadow tag')) tags.add('trap');
  tags.delete('hazard');
  return tags;
};

const hasTrapSignal = (pokemon: PokemonEntry, data: IndexedData): boolean => {
  const abilityText = [pokemon.ability ?? '', ...(speciesMeta(pokemon, data)?.abilities ?? [])].join(' ').toLowerCase();
  return abilityText.includes('shadow tag') || (speciesMeta(pokemon, data)?.roleTags ?? []).includes('trap');
};

const inferredFormFor = (species: string, inference: OpponentInference | undefined, data: IndexedData): string => {
  const previewKey = normalizeKey(baseSpeciesForMega(species, data));
  const formGuess = inference?.formGuesses.find((guess) => normalizeKey(guess.previewSpecies) === previewKey);
  const topForm = formGuess?.forms[0];
  if (!topForm || topForm.probability < 0.42) return species;

  return topForm.species;
};

const inferredSetFor = (species: string, inference: OpponentInference | undefined, data: IndexedData) => {
  const previewKey = normalizeKey(baseSpeciesForMega(species, data));
  return inference?.setGuesses.find((guess) => normalizeKey(guess.species) === previewKey);
};

const inferredOpponentEntry = (species: string, data: IndexedData, inference?: OpponentInference): PokemonEntry => {
  const inferredSpecies = inferredFormFor(species, inference, data);
  const meta = findSpecies(inferredSpecies, data) ?? findSpecies(species, data);
  const setGuess = inferredSetFor(species, inference, data);
  const setAbility = setGuess?.abilities[0] ?? '';
  const ability = setAbility && meta?.abilities.includes(setAbility) ? setAbility : meta?.abilities[0] ?? setAbility;

  return {
    id: `inferred-${species}`,
    species: meta?.displayName ?? species,
    types: meta?.types ?? [],
    ability,
    moves: [...(setGuess?.moves ?? []), ...(meta?.commonMoves ?? []), '', '', '', ''].slice(0, 4),
    speedStat: null
  };
};

const opponentEntryForScoring = (pokemon: PokemonEntry, inference: OpponentInference, data: IndexedData): PokemonEntry => {
  const inferred = inferredOpponentEntry(pokemon.species, data, inference);
  return {
    ...pokemon,
    species: inferred.species,
    types: inferred.types,
    ability: inferred.ability,
    moves: inferred.moves,
    speedStat: pokemon.speedStat ?? inferred.speedStat
  };
};

const attackingTypes = (pokemon: PokemonEntry, data: IndexedData, includeSpeciesTypes = false): PokemonType[] => {
  const naturalTypes = entryTypes(pokemon, data);
  const moveTypes = nonEmptyMoves(pokemon)
    .map((moveName) => findMove(moveName, data)?.type)
    .filter((type): type is PokemonType => Boolean(type));

  if (moveTypes.length > 0) return Array.from(new Set(includeSpeciesTypes ? [...moveTypes, ...naturalTypes] : moveTypes));

  const commonMoveTypes = (speciesMeta(pokemon, data)?.commonMoves ?? [])
    .map((moveName) => findMove(moveName, data)?.type)
    .filter((type): type is PokemonType => Boolean(type));

  return Array.from(new Set([...commonMoveTypes, ...naturalTypes]));
};

const bestOffensiveMultiplier = (attacker: PokemonEntry, defender: PokemonEntry, data: IndexedData): number => {
  const defenderTypes = entryTypes(defender, data);
  if (defenderTypes.length === 0) return 1;

  const attackTypes = attackingTypes(attacker, data);
  if (attackTypes.length === 0) return 1;

  return Math.max(...attackTypes.map((type) => effectiveness(type, defenderTypes)));
};

const threatMultiplierInto = (attacker: PokemonEntry, defender: PokemonEntry, data: IndexedData, includeSpeciesTypes = false): number => {
  const defenderTypes = entryTypes(defender, data);
  if (defenderTypes.length === 0) return 1;

  const attackTypes = attackingTypes(attacker, data, includeSpeciesTypes);
  if (attackTypes.length === 0) return 1;

  return Math.max(...attackTypes.map((type) => effectiveness(type, defenderTypes)));
};

const movePoolFor = (pokemon: PokemonEntry, data: IndexedData): MoveData[] => {
  const moves = nonEmptyMoves(pokemon)
    .map((moveName) => findMove(moveName, data))
    .filter((move): move is MoveData => Boolean(move));
  if (moves.length > 0) return moves;

  return (speciesMeta(pokemon, data)?.commonMoves ?? [])
    .map((moveName) => findMove(moveName, data))
    .filter((move): move is MoveData => Boolean(move));
};

const bestDamagePressure = (
  attacker: PokemonEntry,
  defender: PokemonEntry,
  data: IndexedData
): { score: number; multiplier: number; move?: MoveData } => {
  const defenderTypes = entryTypes(defender, data);
  const attackerMeta = speciesMeta(attacker, data);
  const defenderMeta = speciesMeta(defender, data);
  const moves = movePoolFor(attacker, data);
  if (defenderTypes.length === 0 || moves.length === 0 || !attackerMeta || !defenderMeta) {
    const multiplier = threatMultiplierInto(attacker, defender, data);
    return { score: multiplier * 0.75, multiplier };
  }

  return moves.reduce(
    (best, move) => {
      const multiplier = effectiveness(move.type, defenderTypes);
      if (move.category === 'Status' || !move.power || multiplier === 0) {
        const utilityScore =
          move.tags.includes('speed-control') || move.tags.includes('tailwind') || move.tags.includes('trick-room')
            ? 0.35
            : move.tags.includes('protect')
              ? 0
              : 0.18;
        return utilityScore > best.score ? { score: utilityScore, multiplier, move } : best;
      }

      const attackStat = move.category === 'Physical' ? attackerMeta.baseStats.attack : attackerMeta.baseStats.specialAttack;
      const defenseStat = move.category === 'Physical' ? defenderMeta.baseStats.defense : defenderMeta.baseStats.specialDefense;
      const statRatio = clamp((attackStat + 40) / (defenseStat + 40), 0.55, 1.9);
      const stab = entryTypes(attacker, data).includes(move.type) ? 1.5 : 1;
      const spreadPenalty = move.tags.includes('spread') ? 0.82 : 1;
      const priorityBonus = move.tags.includes('priority') ? 1.12 : 1;
      const score = (move.power / 80) * multiplier * stab * statRatio * spreadPenalty * priorityBonus;

      return score > best.score ? { score, multiplier, move } : best;
    },
    { score: 0, multiplier: 0, move: undefined as MoveData | undefined }
  );
};

const damagePressureScore = (pressure: number): number => {
  if (pressure >= 2.6) return 1.65;
  if (pressure >= 1.8) return 1.15;
  if (pressure >= 1.15) return 0.55;
  if (pressure >= 0.65) return 0.05;
  return -0.55;
};

const hasConcreteUtility = (tags: Set<string>): boolean =>
  tags.has('fake-out') ||
  tags.has('redirection') ||
  tags.has('intimidate') ||
  tags.has('speed-control') ||
  tags.has('tailwind') ||
  tags.has('trick-room') ||
  tags.has('wide-guard') ||
  tags.has('pivot') ||
  tags.has('disruption') ||
  tags.has('perish') ||
  tags.has('trap');

const hasPerishTrapMode = (plan: BattlePlan, data: IndexedData): boolean => {
  return plan.brought.some(hasExplicitPerishSong) && plan.brought.some((pokemon) => hasTrapSignal(pokemon, data));
};

const strategyContextFor = (team: PokemonEntry[], data: IndexedData): StrategyContext => {
  return {
    perishTrap: team.some(hasExplicitPerishSong) && team.some((pokemon) => hasTrapSignal(pokemon, data))
  };
};

const isPerishSupportTags = (tags: Set<string>): boolean =>
  tags.has('perish') ||
  tags.has('fake-out') ||
  tags.has('redirection') ||
  tags.has('intimidate') ||
  tags.has('speed-control') ||
  tags.has('tailwind') ||
  tags.has('trick-room') ||
  tags.has('disruption') ||
  tags.has('pivot');

const isGhostEntry = (pokemon: PokemonEntry, data: IndexedData): boolean => entryTypes(pokemon, data).includes('Ghost');

const enemyPerishTrapThreat = (opponents: PokemonEntry[], inference: OpponentInference, data: IndexedData) => {
  const opponentTags = opponents.map((pokemon) => entryTags(pokemon, data));
  const trapper = opponents.find((_, index) => opponentTags[index].has('trap'));
  const perishUsers = opponents.filter((_, index) => opponentTags[index].has('perish'));
  const archetypeRead = inference.archetypes.includes('Perish Trap');

  if (!trapper || (perishUsers.length === 0 && !archetypeRead)) return undefined;

  return {
    trapper,
    perishUsers,
    confidence: clamp((archetypeRead ? 0.25 : 0) + (perishUsers.length ? 0.35 : 0) + (trapper ? 0.35 : 0), 0.35, 0.95)
  };
};

const addReason = (reasons: ScoreReason[], label: string, detail: string, weight: number, tone: ScoreReason['tone'] = 'positive') => {
  reasons.push({ label, detail, weight, tone });
};

const scoreOffense = (plan: BattlePlan, opponents: PokemonEntry[], data: IndexedData, reasons: ScoreReason[]): number => {
  if (opponents.length === 0) return 16;

  let score = 0;
  const highValueTargets: string[] = [];
  const deadZones: string[] = [];
  const lowValueBrought: string[] = [];

  opponents.forEach((opponent) => {
    const best = Math.max(...plan.brought.map((pokemon) => bestOffensiveMultiplier(pokemon, opponent, data)));
    const bestDamage = Math.max(...plan.brought.map((pokemon) => bestDamagePressure(pokemon, opponent, data).score));
    if (best >= 2) highValueTargets.push(opponent.species);
    if (best <= 0.5 || bestDamage < 0.55) deadZones.push(opponent.species);

    if (best >= 4) score += 5.6;
    else if (best >= 2) score += 3.5;
    else if (best === 1) score += 1.4;
    else if (best > 0) score -= 1.4;
    else score -= 3.2;

    if (bestDamage >= 2.4) score += 0.8;
    else if (bestDamage >= 1.6) score += 0.35;
    else if (bestDamage < 0.55) score -= 1.4;
  });

  plan.brought.forEach((pokemon) => {
    const tags = entryTags(pokemon, data);
    const concreteTargets = opponents.filter((opponent) => {
      const multiplier = bestOffensiveMultiplier(pokemon, opponent, data);
      const damage = bestDamagePressure(pokemon, opponent, data).score;
      return multiplier >= 2 || damage >= 1.15;
    }).length;
    const defensiveAnchors = opponents.filter((opponent) => threatMultiplierInto(opponent, pokemon, data, true) <= 0.5).length;
    const liabilities = opponents.filter((opponent) => {
      const damage = bestDamagePressure(opponent, pokemon, data).score;
      return threatMultiplierInto(opponent, pokemon, data, true) >= 2 || damage >= 1.75;
    }).length;
    const hasUtility = hasConcreteUtility(tags);

    score += Math.min(concreteTargets, 3) * 0.35;
    if (defensiveAnchors >= 2) score += 0.55;
    score -= Math.max(0, liabilities - defensiveAnchors) * 0.28;
    if (liabilities >= Math.ceil(opponents.length / 2)) score -= 0.9;
    if (concreteTargets === 0 && !hasUtility) {
      lowValueBrought.push(pokemon.species);
      score -= 1.75;
    } else if (concreteTargets <= 1 && liabilities >= Math.ceil(opponents.length / 2) && !hasUtility) {
      lowValueBrought.push(pokemon.species);
      score -= 1.1;
    } else if (concreteTargets <= 2 && liabilities >= Math.ceil(opponents.length / 2)) {
      lowValueBrought.push(pokemon.species);
      score -= 0.8;
    }
  });

  const capped = clamp(score, -10, 28);
  if (highValueTargets.length >= Math.ceil(opponents.length / 2)) {
    addReason(reasons, 'Coverage', `Super-effective pressure into ${highValueTargets.slice(0, 4).join(', ')}.`, 3.5);
  }
  if (deadZones.length > 0) {
    addReason(reasons, 'Coverage gap', `Limited immediate pressure into ${deadZones.slice(0, 3).join(', ')}.`, -2.5, 'warning');
  }
  if (lowValueBrought.length > 0) {
    addReason(reasons, 'Preview fit', `${lowValueBrought.slice(0, 2).join(', ')} ${lowValueBrought.length === 1 ? 'has' : 'have'} limited value into this preview.`, -2.2, 'warning');
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
      const mult = threatMultiplierInto(opponent, pokemon, data, true);
      if (mult >= 2) vulnerable.push(`${pokemon.species} (${multiplierLabel(mult)} from ${opponent.species})`);
      if (mult <= 0.5) sturdy.push(`${pokemon.species} into ${opponent.species}`);
    });

    const incomingTypes = opponents.flatMap((opponent) => attackingTypes(opponent, data, true));
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

const predictedLeadMatchup = (
  plan: BattlePlan,
  inference: OpponentInference,
  data: IndexedData,
  warnings: string[]
): { score: number; topLead?: string; topLeadProbability?: number; risk?: string } => {
  const predicted = inference.likelyLeadPairs
    .filter((pair) => pair.probability >= 0.015)
    .slice(0, 8);
  if (predicted.length === 0) return { score: 0 };

  const totalWeight = predicted.reduce((total, pair) => total + pair.probability, 0) || 1;
  const ourLeadSpeed = plan.leads
    .map((pokemon) => entrySpeed(pokemon, data))
    .filter((speed): speed is number => typeof speed === 'number')
    .reduce((total, speed, _, speeds) => total + speed / speeds.length, 0);
  const ourLeadTags = plan.leads.map((pokemon) => entryTags(pokemon, data));
  const hasSpeedControl = ourLeadTags.some((tags) => tags.has('speed-control') || tags.has('tailwind') || tags.has('trick-room'));
  const hasWideGuard = ourLeadTags.some((tags) => tags.has('wide-guard'));
  const hasFakeOut = ourLeadTags.some((tags) => tags.has('fake-out'));

  let totalScore = 0;
  const riskScores = new Map<string, number>();
  predicted.forEach((pair) => {
    const enemyLeads = pair.members.map((member) => inferredOpponentEntry(member, data, inference));
    const enemyTags = enemyLeads.map((pokemon) => entryTags(pokemon, data));
    const enemySpeed = enemyLeads
      .map((pokemon) => entrySpeed(pokemon, data))
      .filter((speed): speed is number => typeof speed === 'number')
      .reduce((total, speed, _, speeds) => total + speed / speeds.length, 0);
    const pressure = plan.leads.reduce((total, lead) => {
      const best = Math.max(...enemyLeads.map((enemy) => bestDamagePressure(lead, enemy, data).score));
      return total + damagePressureScore(best);
    }, 0);
    const danger = enemyLeads.reduce((total, enemy) => {
      const best = Math.max(...plan.leads.map((lead) => bestDamagePressure(enemy, lead, data).score));
      return total + damagePressureScore(best);
    }, 0);
    const enemyHasSpread = enemyTags.some((tags) => tags.has('spread'));
    const enemyHasSpeedControl = enemyTags.some((tags) => tags.has('speed-control') || tags.has('tailwind') || tags.has('trick-room'));
    const enemyHasFakeOut = enemyTags.some((tags) => tags.has('fake-out'));
    const probabilityWeight = pair.probability / totalWeight;
    const evidenceWeight = probabilityWeight * clamp(pair.confidence + 0.25, 0.45, 1);
    let pairScore = pressure - danger;
    let counterPenalty = 0;

    plan.leads.forEach((lead) => {
      const leadName = lead.species;
      const leadTags = entryTags(lead, data);
      const leadSpeed = entrySpeed(lead, data) ?? 0;
      enemyLeads.forEach((enemy, enemyIndex) => {
        const enemyName = enemy.species;
        const enemyTagSet = enemyTags[enemyIndex];
        const enemySpeedValue = entrySpeed(enemy, data) ?? 0;
        const enemyPressure = bestDamagePressure(enemy, lead, data);
        const leadPressure = bestDamagePressure(lead, enemy, data);
        const enemyIntoLead = enemyPressure.multiplier;
        const leadIntoEnemy = leadPressure.multiplier;
        const enemyHasPriority = enemyTagSet.has('priority');
        const priorityPunishesLead = (enemyHasPriority || enemyPressure.move?.tags.includes('priority')) && enemyPressure.score >= 1.25;
        const speedPunishesLead = enemySpeedValue > leadSpeed + 10 && !leadTags.has('priority') && !leadTags.has('speed-control');
        const checkedWithoutReturnDamage = enemyPressure.score >= 1.45 && leadPressure.score <= 0.95;
        const hardWall = leadPressure.score <= 0.45 || leadIntoEnemy === 0;

        if (!checkedWithoutReturnDamage && !hardWall) return;

        const penalty =
          0.75 +
          clamp(enemyPressure.score - leadPressure.score, 0, 1.4) +
          (enemyIntoLead >= 4 ? 0.7 : 0) +
          (priorityPunishesLead ? 1.05 : 0) +
          (speedPunishesLead ? 0.35 : 0) +
          (hardWall ? 0.65 : 0) +
          (leadTags.has('late-game') ? 0.55 : 0);
        counterPenalty += penalty;
        const riskKey = `${leadName} into ${enemyName}`;
        riskScores.set(riskKey, (riskScores.get(riskKey) ?? 0) + penalty * evidenceWeight * 6);
      });
    });

    if (ourLeadSpeed > enemySpeed + 12) pairScore += 0.55;
    if (ourLeadSpeed < enemySpeed - 18 && !hasSpeedControl) pairScore -= 0.75;
    if (hasSpeedControl && enemyHasSpeedControl) pairScore += 0.45;
    if (hasWideGuard && enemyHasSpread) pairScore += 0.65;
    if (hasFakeOut && !enemyHasFakeOut) pairScore += 0.35;
    pairScore -= clamp(counterPenalty, 0, 3.2);

    totalScore += pairScore * probabilityWeight;
  });

  const topLead = predicted[0] ? predicted[0].members.join(' + ') : undefined;
  const topLeadProbability = predicted[0]?.probability;
  const sortedRisks = Array.from(riskScores.entries()).sort((first, second) => second[1] - first[1]);
  const topRisk = sortedRisks[0];
  const stackedRiskPenalty = sortedRisks.reduce((total, [, riskScore]) => total + Math.max(0, riskScore - 0.85), 0);
  const directRiskPenalty = topRisk ? clamp(topRisk[1] * 1.25 + stackedRiskPenalty * 0.85, 0, 5.8) : 0;
  const score = clamp(totalScore - directRiskPenalty, -7.5, 4.5);
  if (score < -1.6 && topLead) {
    const probabilityText = topLeadProbability ? ` (${Math.round(topLeadProbability * 100)}%)` : '';
    warnings.push(`Likely lead risk: public data points toward ${topLead}${probabilityText}, which pressures this lead pair.`);
  }
  sortedRisks
    .filter(([, riskScore]) => riskScore >= 1.2)
    .slice(0, 2)
    .forEach(([risk]) => warnings.push(`Lead counter risk: ${risk} looks unfavorable from public moves and typing.`));

  return { score, topLead, topLeadProbability, risk: topRisk?.[0] };
};

const scoreLead = (
  plan: BattlePlan,
  opponents: PokemonEntry[],
  data: IndexedData,
  reasons: ScoreReason[],
  warnings: string[],
  inference: OpponentInference,
  strategy: StrategyContext
): number => {
  let score = 7;
  const broughtTags = plan.brought.map((pokemon) => entryTags(pokemon, data));
  const leadTags = plan.leads.map((pokemon) => entryTags(pokemon, data));
  const leadNames = plan.leads.map((pokemon) => pokemon.species).join(' + ');
  const perishTrapMode = strategy.perishTrap;
  const hasTrapInFour = broughtTags.some((tags) => tags.has('trap'));
  const trapLeadIndex = leadTags.findIndex((tags) => tags.has('trap'));
  const hasTrapLead = trapLeadIndex >= 0;
  const hasPerishLead = plan.leads.some(hasExplicitPerishSong);
  const hasPerishSupportLead = leadTags.some((tags, index) => index !== trapLeadIndex && isPerishSupportTags(tags));
  const enemyPerishThreat = enemyPerishTrapThreat(opponents, inference, data);
  const leadHasPivot = leadTags.some((tags) => tags.has('pivot'));
  const broughtHasPivot = broughtTags.some((tags) => tags.has('pivot'));
  const leadHasDisruption = leadTags.some((tags) => tags.has('disruption'));
  const leadHasGhost = plan.leads.some((pokemon) => isGhostEntry(pokemon, data));
  const maxTrapperPressure = enemyPerishThreat
    ? Math.max(...plan.leads.map((lead) => bestDamagePressure(lead, enemyPerishThreat.trapper, data).score))
    : 0;
  const fasterThanTrapper =
    enemyPerishThreat
      ? plan.leads.some((lead) => (entrySpeed(lead, data) ?? 0) > (entrySpeed(enemyPerishThreat.trapper, data) ?? 0) + 5)
      : false;
  const perishCounterplay =
    (leadHasGhost ? 2.4 : 0) +
    (leadHasPivot ? 2.2 : broughtHasPivot ? 0.8 : 0) +
    (leadHasDisruption ? 1.5 : 0) +
    (fasterThanTrapper ? 0.9 : 0) +
    (maxTrapperPressure >= 2.4 ? 3.2 : maxTrapperPressure >= 1.55 ? 1.8 : maxTrapperPressure >= 1 ? 0.7 : 0);
  const lateGameLeadPenalty = plan.leads.reduce((total, pokemon, index) => {
    const tags = leadTags[index];
    if (!tags.has('late-game')) return total;
    const hasImmediateMode = tags.has('fake-out') || tags.has('tailwind') || tags.has('trick-room') || tags.has('redirection');
    return total + (hasImmediateMode ? 0.75 : 1.8);
  }, 0);
  const publicLeadPrior = plan.leads.reduce((total, pokemon) => {
    const meta = speciesMeta(pokemon, data);
    if (!meta?.leadRate) return total;
    const sampleConfidence = clamp((meta.sampleSize ?? 0) / 250, 0, 1);
    return total + clamp(meta.leadRate * 8 * sampleConfidence, 0, 2.4);
  }, 0);
  const inactiveMegaLeadPenalty = plan.leads.reduce((total, pokemon) => {
    if (!pokemon.inactiveMegaSpecies) return total;
    return total + (1 - regularFormViability(pokemon, data)) * 2.2;
  }, 0);
  const predictedMatchup = predictedLeadMatchup(plan, inference, data, warnings);

  if (leadTags.some((tags) => tags.has('fake-out'))) score += 3;
  if (leadTags.some((tags) => tags.has('redirection'))) score += 2.5;
  if (leadTags.some((tags) => tags.has('intimidate'))) score += 1.5;
  if (leadTags.some((tags) => tags.has('wide-guard'))) score += opponents.some((opponent) => entryTags(opponent, data).has('spread')) ? 2.5 : 0.8;
  if (perishTrapMode && hasTrapLead) score += 6;
  if (perishTrapMode && hasTrapLead && hasPerishLead) score += 1.6;
  if (perishTrapMode && hasTrapLead && hasPerishSupportLead) score += 1.3;
  if (perishTrapMode && !hasTrapInFour) score -= 10;
  else if (perishTrapMode && !hasTrapLead) score -= 7.5;
  if (enemyPerishThreat) {
    if (perishCounterplay >= 4) score += 2.2;
    else if (perishCounterplay >= 2.5) score += 0.4;
    else score -= 4.8 * enemyPerishThreat.confidence;
  }
  score += publicLeadPrior;
  score += predictedMatchup.score;
  score -= lateGameLeadPenalty;
  score -= inactiveMegaLeadPenalty;
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
  if (perishTrapMode && hasTrapLead) {
    addReason(reasons, 'Perish Trap lead', `${leadNames} puts the trapper on the field immediately for the Perish plan.`, 4.2);
  }
  if (perishTrapMode && !hasTrapInFour) {
    addReason(reasons, 'Perish Trap missing', `${leadNames} does not bring the trapper, so the main Perish mode is unavailable.`, -6, 'warning');
    warnings.push('Perish Trap plan: this four does not bring the trapper, so the countdown plan is hard to execute.');
  } else if (perishTrapMode && !hasTrapLead) {
    addReason(reasons, 'Perish Trap delay', `${leadNames} leaves the trapper in back, so opponents can switch before the countdown plan starts.`, -5.2, 'warning');
    warnings.push('Perish Trap plan: leading without the trapper gives the opponent more room to switch around Perish Song.');
  }
  if (enemyPerishThreat && perishCounterplay >= 4) {
    addReason(reasons, 'Perish counterplay', `${leadNames} can pressure or escape ${enemyPerishThreat.trapper.species} before Perish Trap stabilizes.`, 2.1);
  } else if (enemyPerishThreat && perishCounterplay < 2.5) {
    addReason(
      reasons,
      'Enemy Perish Trap risk',
      `${leadNames} lacks strong pressure, pivoting, or Ghost-type escape into ${enemyPerishThreat.trapper.species}.`,
      -3.2,
      'warning'
    );
    warnings.push(`Enemy Perish Trap risk: ${enemyPerishThreat.trapper.species} can trap while Perish Song pressure develops.`);
  }
  if (publicLeadPrior >= 1.5) {
    addReason(reasons, 'Public lead data', `${leadNames} has useful lead usage in public Regulation M-A data.`, 1.5, 'neutral');
  }
  if (predictedMatchup.topLead && Math.abs(predictedMatchup.score) >= 1.2) {
    const tone = predictedMatchup.score > 0 ? 'positive' : 'warning';
    const topLeadText = predictedMatchup.topLeadProbability
      ? `${predictedMatchup.topLead} (${Math.round(predictedMatchup.topLeadProbability * 100)}%)`
      : predictedMatchup.topLead;
    addReason(
      reasons,
      'Opponent lead read',
      predictedMatchup.risk
        ? `${leadNames} may struggle into likely ${topLeadText}; ${predictedMatchup.risk} is the main concern.`
        : `${leadNames} ${predictedMatchup.score > 0 ? 'matches up well into' : 'may struggle into'} likely ${topLeadText}.`,
      predictedMatchup.score,
      tone
    );
  }
  if (lateGameLeadPenalty >= 1) {
    addReason(reasons, 'Backline value', `${leadNames} includes a late-game cleaner that often gains value from the back.`, -lateGameLeadPenalty, 'warning');
  }
  if (inactiveMegaLeadPenalty >= 1) {
    addReason(reasons, 'Inactive Mega lead', `${leadNames} includes a regular form that loses too much value when it is not the active Mega.`, -inactiveMegaLeadPenalty, 'warning');
  }

  return clamp(score, -6, 18);
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
    const inactiveMultiplier = inactiveMegaMultiplier(pokemon, data);
    return total + (meta.usage * 2.5 + winDelta) * inactiveMultiplier;
  }, 0);

  const pairBoost = plan.brought.reduce((total, first, index) => {
    return (
      total +
      plan.brought.slice(index + 1).reduce((pairTotal, second) => {
        const pair = findPair(first.species, second.species, data);
        if (!pair) return pairTotal;
        const confidence = clamp((pair.sampleSize ?? 0) / 180, 0, 1);
        const inactiveMultiplier = inactiveMegaMultiplier(first, data) * inactiveMegaMultiplier(second, data);
        return pairTotal + (pair.frequency * 8 + ((pair.winRate ?? 0.5) - 0.5) * 10 * confidence) * inactiveMultiplier;
      }, 0)
    );
  }, 0);
  const inactiveMegaAdjustment = plan.brought.reduce((total, pokemon) => {
    if (!pokemon.inactiveMegaSpecies) return total;

    const viability = regularFormViability(pokemon, data);
    const penalty = (1 - viability) * 4.4;
    if (viability >= 0.55) {
      addReason(reasons, 'Flexible Mega slot', `${pokemon.species} keeps enough regular-form utility if another Mega is active.`, 1, 'neutral');
    } else {
      addReason(reasons, 'Inactive Mega cost', `${pokemon.species} has little regular-form evidence when ${pokemon.inactiveMegaSpecies} is not active.`, -penalty, 'warning');
    }
    return total - penalty + (viability >= 0.55 ? 0.8 : 0);
  }, 0);

  score = usageBoost + pairBoost + inactiveMegaAdjustment;
  if (pairBoost > 1.2) addReason(reasons, 'Known core', 'This four includes pairings with useful public-meta priors.', 1.2, 'neutral');
  return clamp(score, -4, 10);
};

const confidenceFor = (plan: BattlePlan, opponents: PokemonEntry[], data: IndexedData, inference: OpponentInference): number => {
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
  return clamp(base + dataScore * 0.25 + setScore * 0.2 + previewScore * 0.08 + inference.confidence * 0.12, 0.25, 0.92);
};

const recommendationTags = (plan: BattlePlan, data: IndexedData): string[] => {
  const tags = new Set<string>();
  const hasPerishTrapPlan = plan.brought.some(hasExplicitPerishSong) && plan.brought.some((pokemon) => hasTrapSignal(pokemon, data));
  plan.brought.forEach((pokemon) => {
    const pokemonTags = entryTags(pokemon, data);
    if (pokemonTags.has('tailwind')) tags.add('Tailwind');
    if (pokemonTags.has('trick-room')) tags.add('Trick Room');
    if (pokemonTags.has('fake-out')) tags.add('Fake Out');
    if (pokemonTags.has('redirection')) tags.add('Redirection');
    if (pokemonTags.has('weather')) tags.add('Weather');
    if (pokemonTags.has('wide-guard')) tags.add('Wide Guard');
    if (pokemonTags.has('priority')) tags.add('Priority');
  });
  if (hasPerishTrapPlan) tags.add('Perish Trap');
  return Array.from(tags).slice(0, 5);
};

export const scoreBattlePlan = (
  plan: BattlePlan,
  opponents: PokemonEntry[],
  data: IndexedData = indexedData,
  inference: OpponentInference = inferOpponentPreview(opponents, data),
  strategy: StrategyContext = { perishTrap: hasPerishTrapMode(plan, data) }
): Recommendation => {
  const variants = withMegaLimit(plan, data);
  if (variants.length > 1) {
    return variants
      .map((variant) => scoreSingleBattlePlan(variant.plan, opponents, data, inference, strategy, variant.warning))
      .sort((a, b) => b.score - a.score)[0];
  }

  return scoreSingleBattlePlan(variants[0].plan, opponents, data, inference, strategy, variants[0].warning);
};

const scoreSingleBattlePlan = (
  plan: BattlePlan,
  opponents: PokemonEntry[],
  data: IndexedData,
  inference: OpponentInference,
  strategy: StrategyContext,
  megaLimitWarning?: string
): Recommendation => {
  const reasons: ScoreReason[] = [];
  const warnings: string[] = megaLimitWarning ? [megaLimitWarning] : [];
  const visibleOpponents = filledEntries(opponents).map((opponent) => opponentEntryForScoring(opponent, inference, data));

  const offense = scoreOffense(plan, visibleOpponents, data, reasons);
  const defense = scoreDefense(plan, visibleOpponents, data, reasons, warnings);
  const speed = scoreSpeed(plan, visibleOpponents, data, reasons, warnings);
  const lead = scoreLead(plan, visibleOpponents, data, reasons, warnings, inference, strategy);
  const roles = scoreRoles(plan, data, reasons, warnings);
  const meta = scoreMeta(plan, data, reasons);
  const hasOpponentPreview = visibleOpponents.length > 0;
  const score = clamp(
    hasOpponentPreview
      ? offense * 1.12 + defense * 1.28 + speed * 0.72 + lead * 1.1 + roles * 0.62 + meta * 0.5
      : offense + defense + speed + lead + roles + meta,
    0,
    100
  );

  const sortedReasons = reasons
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 5);

  return {
    ...plan,
    score: Math.round(score * 10) / 10,
    confidence: confidenceFor(plan, visibleOpponents, data, inference),
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
): Recommendation[] => {
  const inference = inferOpponentPreview(opponents, data);
  const strategy = strategyContextFor(filledEntries(team), data);
  return enumerateBattlePlans(team)
    .map((plan) => scoreBattlePlan(plan, opponents, data, inference, strategy))
    .sort((a, b) => b.score - a.score)
    .map((recommendation, index, all) => ({
      ...recommendation,
      confidence: clamp(recommendation.confidence - index * 0.002 + (recommendation.score - (all.at(-1)?.score ?? 0)) / 1000, 0.25, 0.94)
    }));
};

const bringFourKey = (recommendation: Recommendation): string =>
  recommendation.brought
    .map((pokemon) => pokemon.id)
    .sort()
    .join('|');

export const selectRecommendationHighlights = (recommendations: Recommendation[], limit = 8): Recommendation[] => {
  const selected: Recommendation[] = [];
  const seenBringFours = new Set<string>();

  recommendations.forEach((recommendation) => {
    if (selected.length >= limit) return;
    const key = bringFourKey(recommendation);
    if (seenBringFours.has(key)) return;

    seenBringFours.add(key);
    selected.push(recommendation);
  });

  recommendations.forEach((recommendation) => {
    if (selected.length >= limit) return;
    if (selected.includes(recommendation)) return;
    selected.push(recommendation);
  });

  return selected;
};
