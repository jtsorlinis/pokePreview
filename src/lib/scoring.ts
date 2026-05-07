import { enumerateBattlePlans, enumerateBringFours, filledEntries } from './candidates';
import { baseSpeciesForMega, findMove, findPair, findSpecies, indexedData, isMegaSpecies, normalizeKey } from './data';
import { effectiveness, multiplierLabel } from './typeChart';
import type {
  BattlePlan,
  BenchNote,
  BringRecommendation,
  IndexedData,
  MetaSpecies,
  ModeCheck,
  MoveData,
  PokemonEntry,
  PokemonType,
  Recommendation,
  ScoreReason
} from './types';

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const uniqueStrings = (values: string[]): string[] => Array.from(new Set(values));

const nonEmptyMoves = (pokemon: PokemonEntry): string[] => pokemon.moves.map((move) => move.trim()).filter(Boolean);

const speciesMeta = (pokemon: PokemonEntry, data: IndexedData): MetaSpecies | undefined => findSpecies(pokemon.species, data);

const publicSpeciesMeta = (pokemon: PokemonEntry, data: IndexedData): MetaSpecies | undefined => {
  const meta = speciesMeta(pokemon, data);
  if (!isMegaSpecies(pokemon.species)) return meta;

  const baseMeta = findSpecies(baseSpeciesForMega(pokemon.species, data), data);
  if (!baseMeta) return meta;

  return (baseMeta.sampleSize ?? 0) > (meta?.sampleSize ?? 0) ? baseMeta : meta;
};

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

const megaVariantKey = (plan: BattlePlan): string =>
  plan.brought
    .map((pokemon) => `${pokemon.id}:${pokemon.species}:${pokemon.inactiveMegaSpecies ?? ''}`)
    .join('|');

const withMegaLimit = (plan: BattlePlan, data: IndexedData): Array<{ plan: BattlePlan; warning?: string }> => {
  const megaEntries = plan.brought.filter((pokemon) => isMegaSpecies(pokemon.species));
  if (megaEntries.length === 0) return [{ plan }];

  const buildVariant = (activeMega?: PokemonEntry): { plan: BattlePlan; warning?: string } => {
    const demoted = new Map(
      megaEntries
        .filter((pokemon) => pokemon.id !== activeMega?.id)
        .map((pokemon) => [pokemon.id, demoteMegaEntry(pokemon, data)])
    );
    const applyLimit = (pokemon: PokemonEntry) => demoted.get(pokemon.id) ?? pokemon;
    const demotedEntries = [...demoted.values()];
    const demotedNames = demotedEntries.map((pokemon) => pokemon.species);
    const warning = activeMega
      ? demotedEntries.length > 0
        ? `Mega limit: ${activeMega.species} is the active Mega; ${demotedNames.join(', ')} ${
            demotedNames.length === 1 ? 'is' : 'are'
          } scored as regular.`
        : undefined
      : `Mega option: ${demotedEntries
          .map((pokemon) => `${pokemon.inactiveMegaSpecies ?? pokemon.species} is scored as regular ${pokemon.species}`)
          .join('; ')}.`;

    return {
      plan: {
        brought: plan.brought.map(applyLimit),
        leads: plan.leads.map(applyLimit),
        backs: plan.backs.map(applyLimit)
      },
      warning
    };
  };

  const variants = [...megaEntries.map((activeMega) => buildVariant(activeMega)), buildVariant()];
  const seen = new Set<string>();
  return variants.filter((variant) => {
    const key = megaVariantKey(variant.plan);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
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
  const spreadUtility = tags.has('spread') ? 0.1 * clamp(nonMegaItemShare / 0.35, 0, 1) : 0;
  const utilityScore =
    (tags.has('lead-pressure') ? 0.16 : 0) +
    (tags.has('fake-out') ? 0.18 : 0) +
    spreadUtility +
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
  const tags = new Set<string>((speciesMeta(pokemon, data)?.roleTags ?? []).filter((tag) => tag !== 'hazard'));
  nonEmptyMoves(pokemon).forEach((moveName) => {
    findMove(moveName, data)?.tags.forEach((tag) => {
      if (tag !== 'hazard') tags.add(tag);
    });
  });
  const ability = pokemon.ability?.toLowerCase() ?? '';
  if (ability.includes('intimidate')) tags.add('intimidate');
  if (ability.includes('prankster')) tags.add('speed-control');
  if (ability.includes('drizzle') || ability.includes('drought')) tags.add('weather');
  if (ability.includes('friend guard')) tags.add('support');
  return tags;
};

const abilityNamesFor = (pokemon: PokemonEntry, data: IndexedData): string[] => {
  const explicitAbility = pokemon.ability?.trim();
  if (explicitAbility) return [explicitAbility];
  return speciesMeta(pokemon, data)?.abilities ?? [];
};

const hasKnownAbility = (pokemon: PokemonEntry, data: IndexedData, abilities: string[]): boolean => {
  const abilityKeys = new Set(abilities.map(normalizeKey));
  return abilityNamesFor(pokemon, data).some((ability) => abilityKeys.has(normalizeKey(ability)));
};

const ignoresDefensiveAbilities = (pokemon: PokemonEntry): boolean => {
  const ability = normalizeKey(pokemon.ability ?? '');
  return ability === 'moldbreaker' || ability === 'teravolt' || ability === 'turboblaze';
};

const abilityImmunity = (attackType: PokemonType, attacker: PokemonEntry, defender: PokemonEntry, data: IndexedData): string | undefined => {
  if (ignoresDefensiveAbilities(attacker)) return undefined;

  if (attackType === 'Water' && hasKnownAbility(defender, data, ['Dry Skin', 'Storm Drain', 'Water Absorb'])) return 'Water immunity';
  if (attackType === 'Electric' && hasKnownAbility(defender, data, ['Lightning Rod', 'Motor Drive', 'Volt Absorb'])) return 'Electric immunity';
  if (attackType === 'Fire' && hasKnownAbility(defender, data, ['Flash Fire', 'Well-Baked Body'])) return 'Fire immunity';
  if (attackType === 'Ground' && hasKnownAbility(defender, data, ['Earth Eater', 'Levitate'])) return 'Ground immunity';
  if (attackType === 'Grass' && hasKnownAbility(defender, data, ['Sap Sipper'])) return 'Grass immunity';

  return undefined;
};

const attackMultiplierInto = (attackType: PokemonType, attacker: PokemonEntry, defender: PokemonEntry, data: IndexedData): number => {
  if (abilityImmunity(attackType, attacker, defender, data)) return 0;
  return effectiveness(attackType, entryTypes(defender, data));
};

const opponentEntryForScoring = (pokemon: PokemonEntry, data: IndexedData): PokemonEntry => {
  const meta = findSpecies(pokemon.species, data);
  return {
    ...pokemon,
    species: meta?.displayName ?? pokemon.species,
    types: meta?.types ?? pokemon.types,
    moves: [...pokemon.moves, '', '', '', ''].slice(0, 4),
    speedStat: pokemon.speedStat ?? null
  };
};

const attackingTypes = (pokemon: PokemonEntry, data: IndexedData): PokemonType[] => {
  const knownMoves = nonEmptyMoves(pokemon)
    .map((moveName) => findMove(moveName, data))
    .filter((move): move is MoveData => Boolean(move));
  const moveTypes = knownMoves
    .filter((move) => move.category !== 'Status' && Boolean(move.power))
    .map((move) => move.type)
    .filter((type): type is PokemonType => Boolean(type));

  if (knownMoves.length > 0) return Array.from(new Set(moveTypes));

  const commonMoves = (speciesMeta(pokemon, data)?.commonMoves ?? [])
    .map((moveName) => findMove(moveName, data))
    .filter((move): move is MoveData => Boolean(move));
  const commonMoveTypes = commonMoves
    .filter((move) => move.category !== 'Status' && Boolean(move.power))
    .map((move) => move.type)
    .filter((type): type is PokemonType => Boolean(type));

  if (commonMoves.length > 0) return Array.from(new Set(commonMoveTypes));

  return Array.from(new Set([...commonMoveTypes, ...entryTypes(pokemon, data)]));
};

const bestOffensiveMultiplier = (attacker: PokemonEntry, defender: PokemonEntry, data: IndexedData): number => {
  const defenderTypes = entryTypes(defender, data);
  if (defenderTypes.length === 0) return 1;

  const attackTypes = attackingTypes(attacker, data);
  if (attackTypes.length === 0) return 0;

  return Math.max(...attackTypes.map((type) => attackMultiplierInto(type, attacker, defender, data)));
};

const threatMultiplierInto = (attacker: PokemonEntry, defender: PokemonEntry, data: IndexedData): number => {
  const defenderTypes = entryTypes(defender, data);
  if (defenderTypes.length === 0) return 1;

  const attackTypes = attackingTypes(attacker, data);
  if (attackTypes.length === 0) return 0;

  return Math.max(...attackTypes.map((type) => attackMultiplierInto(type, attacker, defender, data)));
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
      const multiplier = attackMultiplierInto(move.type, attacker, defender, data);
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

const addReason = (reasons: ScoreReason[], label: string, detail: string, weight: number, tone: ScoreReason['tone'] = 'positive') => {
  reasons.push({ label, detail, weight, tone });
};

const topReasons = (reasons: ScoreReason[], requiredLabel?: string): ScoreReason[] => {
  const sorted = reasons.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 5);
  const required = requiredLabel ? reasons.find((reason) => reason.label === requiredLabel) : undefined;
  if (!required || sorted.some((reason) => reason.label === required.label)) return sorted;
  return [...sorted.slice(0, 4), required];
};

const scoreOffense = (plan: BattlePlan, opponents: PokemonEntry[], data: IndexedData, reasons: ScoreReason[]): number => {
  if (opponents.length === 0) return 16;

  let score = 0;
  const highValueTargets: string[] = [];
  const deadZones: string[] = [];

  opponents.forEach((opponent) => {
    const best = Math.max(...plan.brought.map((pokemon) => bestOffensiveMultiplier(pokemon, opponent, data)));
    const bestDamage = Math.max(...plan.brought.map((pokemon) => bestDamagePressure(pokemon, opponent, data).score));
    if (best >= 2) highValueTargets.push(opponent.species);
    if (best <= 0.5 || bestDamage < 0.55) deadZones.push(opponent.species);

    if (best >= 4) score += 7;
    else if (best >= 2) score += 4.5;
    else if (best === 1) score += 1.8;
    else if (best > 0) score -= 1.2;
    else score -= 3;

    if (bestDamage >= 2.4) score += 1.2;
    else if (bestDamage >= 1.6) score += 0.6;
    else if (bestDamage < 0.55) score -= 1.2;
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
  const incomingTypes = Array.from(new Set(opponents.flatMap((opponent) => attackingTypes(opponent, data))));

  plan.brought.forEach((pokemon) => {
    const pokemonTypes = entryTypes(pokemon, data);
    if (pokemonTypes.length === 0) return;

    opponents.forEach((opponent) => {
      const mult = threatMultiplierInto(opponent, pokemon, data);
      if (mult >= 2) vulnerable.push(`${pokemon.species} (${multiplierLabel(mult)} from ${opponent.species})`);
      if (mult <= 0.5) sturdy.push(`${pokemon.species} into ${opponent.species}`);
    });

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

const scoreIndividualCounterRisk = (
  plan: BattlePlan,
  opponents: PokemonEntry[],
  data: IndexedData,
  reasons: ScoreReason[],
  warnings: string[]
): number => {
  if (opponents.length === 0) return 0;

  const hardCounters: string[] = [];
  const softCounters: string[] = [];

  plan.brought.forEach((pokemon) => {
    opponents.forEach((opponent) => {
      const outgoingPressure = bestDamagePressure(pokemon, opponent, data).score;
      const incomingPressure = bestDamagePressure(opponent, pokemon, data).score;
      const outgoingMultiplier = bestOffensiveMultiplier(pokemon, opponent, data);
      const incomingMultiplier = threatMultiplierInto(opponent, pokemon, data);
      const opponentSpeed = entrySpeed(opponent, data) ?? 0;
      const pokemonSpeed = entrySpeed(pokemon, data) ?? 0;
      const opponentIsFaster = opponentSpeed > pokemonSpeed + 15;

      if (outgoingMultiplier === 0 && outgoingPressure <= 0.35 && (incomingPressure >= 1.35 || incomingMultiplier >= 2)) {
        hardCounters.push(`${pokemon.species} into ${opponent.species}`);
      } else if (outgoingPressure < 0.65 && incomingPressure >= 1.8 && (incomingMultiplier >= 2 || opponentIsFaster)) {
        softCounters.push(`${pokemon.species} into ${opponent.species}`);
      }
    });
  });

  const hardPenalty = Math.min(hardCounters.length * 5.5, 14);
  const softPenalty = Math.min(softCounters.length * 2.4, 8);
  const penalty = hardPenalty + softPenalty;
  if (penalty === 0) return 0;

  const examples = [...hardCounters, ...softCounters].slice(0, 3).join(', ');
  addReason(reasons, 'Hard counter risk', `${examples} ${hardCounters.length + softCounters.length === 1 ? 'is' : 'are'} heavily checked by the visible preview.`, -Math.min(penalty, 6), 'warning');
  if (hardCounters.length > 0) {
    warnings.push(`Hard counter risk: ${hardCounters.slice(0, 2).join(', ')} may need to stay on the bench.`);
  }

  return -penalty;
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

const scoreBringSpeed = (plan: BattlePlan, opponents: PokemonEntry[], data: IndexedData, reasons: ScoreReason[], warnings: string[]): number => {
  const broughtTags = plan.brought.map((pokemon) => entryTags(pokemon, data));
  const hasTailwind = broughtTags.some((tags) => tags.has('tailwind'));
  const hasTrickRoom = broughtTags.some((tags) => tags.has('trick-room'));
  const hasSpeedControl = broughtTags.some((tags) => tags.has('speed-control') || tags.has('tailwind') || tags.has('trick-room'));
  const opponentHasSpeedControl = opponents.some((pokemon) => {
    const tags = entryTags(pokemon, data);
    return tags.has('speed-control') || tags.has('tailwind') || tags.has('trick-room');
  });

  const broughtSpeeds = plan.brought
    .map((pokemon) => entrySpeed(pokemon, data))
    .filter((speed): speed is number => typeof speed === 'number')
    .sort((first, second) => second - first);
  const opponentSpeeds = opponents.map((pokemon) => entrySpeed(pokemon, data)).filter((speed): speed is number => typeof speed === 'number');
  const fastestTwo = broughtSpeeds.slice(0, 2);
  const fastestTwoAverage = fastestTwo.length ? fastestTwo.reduce((total, speed) => total + speed, 0) / fastestTwo.length : 80;
  const opponentSpeedAverage = opponentSpeeds.length ? opponentSpeeds.reduce((total, speed) => total + speed, 0) / opponentSpeeds.length : 90;

  let score = 6;
  if (hasSpeedControl) score += 5;
  if (fastestTwoAverage > opponentSpeedAverage + 12) score += 2.5;
  if (fastestTwoAverage < opponentSpeedAverage - 20 && !hasTrickRoom) score -= 2.5;
  if (hasTrickRoom) score += fastestTwoAverage < opponentSpeedAverage ? 2.5 : 1;
  if (opponentHasSpeedControl && !hasSpeedControl) {
    warnings.push('Opponent preview shows speed-control pressure and this four does not bring an answer.');
    score -= 4;
  }

  if (hasTailwind) addReason(reasons, 'Speed plan', 'Tailwind gives this four a proactive speed mode.', 2);
  if (hasTrickRoom) addReason(reasons, 'Speed plan', 'Trick Room mode can punish faster opposing teams.', 2);

  return clamp(score, -6, 18);
};

const planHasTag = (plan: BattlePlan, data: IndexedData, tags: string[]): boolean =>
  plan.brought.some((pokemon) => {
    const pokemonTags = entryTags(pokemon, data);
    return tags.some((tag) => pokemonTags.has(tag));
  });

const planHasAttackType = (plan: BattlePlan, data: IndexedData, types: PokemonType[]): boolean =>
  plan.brought.some((pokemon) => attackingTypes(pokemon, data).some((type) => types.includes(type)));

const planHasDefensiveType = (plan: BattlePlan, data: IndexedData, types: PokemonType[]): boolean =>
  plan.brought.some((pokemon) => entryTypes(pokemon, data).some((type) => types.includes(type)));

const displayModeName = (mode: string): string => {
  const labels: Record<string, string> = {
    rain: 'Rain',
    sun: 'Sun',
    sand: 'Sand',
    snow: 'Snow',
    tailwind: 'Tailwind',
    trickroom: 'Trick Room',
    redirection: 'Redirection',
    endgame: 'Endgame',
    priority: 'Priority'
  };

  return labels[normalizeKey(mode)] ?? mode;
};

const visibleModeNames = (opponents: PokemonEntry[], data: IndexedData): string[] => {
  const names = opponents.map((pokemon) => findSpecies(pokemon.species, data)?.displayName ?? pokemon.species);
  const previewText = normalizeKey(names.join(' '));
  const opponentTags = opponents.flatMap((pokemon) => Array.from(entryTags(pokemon, data)));
  const modeNames = new Map<string, string>();
  const addMode = (mode: string) => modeNames.set(normalizeKey(mode), displayModeName(mode));

  if (/(pelipper|politoed|archaludon|basculegion)/.test(previewText)) addMode('Rain');
  if (/(charizard|ninetales|venusaur|torkoal|typhlosion)/.test(previewText)) addMode('Sun');
  if (/(tyranitar|excadrill|hippowdon)/.test(previewText)) addMode('Sand');
  if (/(ninetalesalolanform|froslass|abomasnow)/.test(previewText)) addMode('Snow');
  if (opponentTags.includes('tailwind')) addMode('Tailwind');
  if (opponentTags.includes('trick-room')) addMode('Trick Room');
  if (opponentTags.includes('redirection')) addMode('Redirection');
  if (opponentTags.includes('late-game')) addMode('Endgame');
  if (opponentTags.includes('priority')) addMode('Priority');

  return Array.from(modeNames.values());
};

const scoreModeCoverage = (
  plan: BattlePlan,
  opponents: PokemonEntry[],
  data: IndexedData,
  reasons: ScoreReason[],
  warnings: string[]
): { score: number; checks: ModeCheck[] } => {
  const checks: ModeCheck[] = visibleModeNames(opponents, data).map((mode) => {
    const key = normalizeKey(mode);
    let covered = false;
    let detail = '';

    if (key === 'rain') {
      covered =
        planHasTag(plan, data, ['weather', 'wide-guard']) ||
        planHasAttackType(plan, data, ['Electric', 'Grass']) ||
        planHasDefensiveType(plan, data, ['Water', 'Grass', 'Dragon']);
      detail = covered ? 'Answers rain with weather contest, resist profile, or Water-pressure tools.' : 'Thin into rain: few Water resists, weather answers, or Grass/Electric pressure.';
    } else if (key === 'sun') {
      covered =
        planHasTag(plan, data, ['weather', 'speed-control']) ||
        planHasAttackType(plan, data, ['Rock', 'Water']) ||
        planHasDefensiveType(plan, data, ['Fire', 'Water', 'Dragon', 'Rock']);
      detail = covered ? 'Has tools to contest sun speed or punish Fire/Grass cores.' : 'Thin into sun: limited weather contest, speed control, or Fire-resistant pressure.';
    } else if (key === 'sand') {
      covered =
        planHasTag(plan, data, ['intimidate', 'wide-guard']) ||
        planHasAttackType(plan, data, ['Water', 'Grass', 'Fighting', 'Ground']);
      detail = covered ? 'Can pressure or blunt the sand core.' : 'Thin into sand: Tyranitar/Excadrill-style cores may get too much room.';
    } else if (key === 'snow') {
      covered = planHasTag(plan, data, ['weather']) || planHasAttackType(plan, data, ['Fire', 'Steel', 'Rock']);
      detail = covered ? 'Can contest snow or hit its common pieces directly.' : 'Thin into snow: few weather or Fire/Steel/Rock answers.';
    } else if (key === 'tailwind') {
      covered = planHasTag(plan, data, ['speed-control', 'tailwind', 'trick-room', 'fake-out', 'priority']);
      detail = covered ? 'Has counter-tempo into opposing Tailwind.' : 'Thin into Tailwind: speed can get one-sided.';
    } else if (key === 'trickroom') {
      covered = planHasTag(plan, data, ['trick-room', 'fake-out', 'priority', 'disruption']) || planHasDefensiveType(plan, data, ['Steel']);
      detail = covered ? 'Has ways to stall, deny, or play inside Trick Room.' : 'Thin into Trick Room: few denial tools or slow-board answers.';
    } else if (key === 'redirection') {
      covered = planHasTag(plan, data, ['spread', 'fake-out']) || planHasAttackType(plan, data, ['Poison', 'Steel', 'Fire', 'Flying']);
      detail = covered ? 'Has spread damage, Fake Out, or direct redirection pressure.' : 'Thin into redirection: single-target plans may get soaked.';
    } else if (key === 'endgame') {
      covered = planHasTag(plan, data, ['intimidate', 'priority', 'redirection']) || planHasAttackType(plan, data, ['Dark', 'Fairy', 'Electric', 'Grass']);
      detail = covered ? 'Has tools for late-game cleaners.' : 'Thin into endgame cleaners if the board trades down.';
    } else if (key === 'priority') {
      covered = planHasTag(plan, data, ['redirection', 'intimidate', 'priority']) || planHasDefensiveType(plan, data, ['Steel']);
      detail = covered ? 'Can absorb or answer priority pressure.' : 'Thin into priority pressure.';
    } else {
      covered = true;
      detail = 'No special mode penalty applied.';
    }

    return {
      mode,
      status: covered ? 'covered' : 'thin',
      detail,
      score: covered ? 1.7 : -3.2
    };
  });

  const score = clamp(checks.reduce((total, check) => total + check.score, 0), -10, 12);
  const coveredModes = checks.filter((check) => check.status === 'covered').map((check) => check.mode);
  const thinModes = checks.filter((check) => check.status === 'thin').map((check) => check.mode);

  if (coveredModes.length > 0) {
    addReason(reasons, 'Mode coverage', `Answers ${coveredModes.slice(0, 3).join(', ')} mode pressure.`, Math.min(coveredModes.length * 1.4, 3.6), 'neutral');
  }
  if (thinModes.length > 0) {
    addReason(reasons, 'Mode risk', `Thin into ${thinModes.slice(0, 3).join(', ')} mode pressure.`, -Math.min(thinModes.length * 1.8, 4.5), 'warning');
    warnings.push(`Mode gap: ${thinModes.slice(0, 3).join(', ')} pressure may need careful play.`);
  }

  return { score, checks };
};

const scoreLead = (plan: BattlePlan, opponents: PokemonEntry[], data: IndexedData, reasons: ScoreReason[], warnings: string[]): number => {
  let score = 7;
  const leadTags = plan.leads.map((pokemon) => entryTags(pokemon, data));
  const leadNames = plan.leads.map((pokemon) => pokemon.species).join(' + ');
  const hasWeavileGlimmoraLead =
    plan.leads.some((pokemon) => pokemon.species === 'Weavile') &&
    plan.leads.some((pokemon) => pokemon.species === 'Glimmora' || pokemon.species === 'Mega Glimmora');
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

  if (leadTags.some((tags) => tags.has('fake-out'))) score += 3;
  if (leadTags.some((tags) => tags.has('redirection'))) score += 2.5;
  if (leadTags.some((tags) => tags.has('intimidate'))) score += 1.5;
  if (leadTags.some((tags) => tags.has('wide-guard'))) score += opponents.some((opponent) => entryTags(opponent, data).has('spread')) ? 2.5 : 0.8;
  if (hasWeavileGlimmoraLead) score += 1.2;
  score += publicLeadPrior;
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
  if (publicLeadPrior >= 1.5) {
    addReason(reasons, 'Public lead data', `${leadNames} has useful lead usage in public Regulation M-A data.`, 1.5, 'neutral');
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

const publicPairAliases = (pokemon: PokemonEntry, data: IndexedData): string[] => {
  const aliases = [pokemon.species];
  if (isMegaSpecies(pokemon.species)) aliases.push(baseSpeciesForMega(pokemon.species, data));
  if (pokemon.inactiveMegaSpecies) aliases.push(pokemon.inactiveMegaSpecies);
  return uniqueStrings(aliases);
};

const publicPairBoost = (first: PokemonEntry, second: PokemonEntry, data: IndexedData): number => {
  const firstAliases = publicPairAliases(first, data);
  const secondAliases = publicPairAliases(second, data);
  let bestBoost = 0;

  firstAliases.forEach((firstAlias) => {
    secondAliases.forEach((secondAlias) => {
      const pair = findPair(firstAlias, secondAlias, data);
      if (!pair) return;

      const confidence = clamp((pair.sampleSize ?? 0) / 180, 0, 1);
      const boost = pair.frequency * 8 + ((pair.winRate ?? 0.5) - 0.5) * 10 * confidence;
      bestBoost = Math.max(bestBoost, boost);
    });
  });

  return bestBoost;
};

const scoreMegaFlexibility = (plan: BattlePlan, data: IndexedData, reasons: ScoreReason[]): number => {
  const activeMegas = plan.brought.filter((pokemon) => isMegaSpecies(pokemon.species));
  const regularMegaSlots = plan.brought
    .filter((pokemon) => pokemon.inactiveMegaSpecies)
    .map((pokemon) => ({ pokemon, viability: regularFormViability(pokemon, data) }))
    .filter(({ viability }) => viability >= 0.55);

  if (activeMegas.length === 0 || regularMegaSlots.length === 0) return 0;

  const boost = clamp(
    regularMegaSlots.reduce((total, { viability }) => total + 0.75 + (viability - 0.55) * 3.5, 0),
    0,
    2.4
  );
  const regularNames = regularMegaSlots.map(({ pokemon }) => pokemon.species).join(', ');
  const activeNames = activeMegas.map((pokemon) => pokemon.species).join(', ');
  addReason(
    reasons,
    'Mega flexibility',
    `${regularNames} ${regularMegaSlots.length === 1 ? 'keeps' : 'keep'} enough regular-form utility beside active ${activeNames}.`,
    Math.max(2.1, Math.min(boost, 2.2)),
    'neutral'
  );
  return boost;
};

const scoreMeta = (plan: BattlePlan, data: IndexedData, reasons: ScoreReason[]): number => {
  let score = 0;
  const activeMegaNames = plan.brought.filter((pokemon) => isMegaSpecies(pokemon.species)).map((pokemon) => pokemon.species);
  const usageBoost = plan.brought.reduce((total, pokemon) => {
    const meta = publicSpeciesMeta(pokemon, data);
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
        const inactiveMultiplier = inactiveMegaMultiplier(first, data) * inactiveMegaMultiplier(second, data);
        return pairTotal + publicPairBoost(first, second, data) * inactiveMultiplier;
      }, 0)
    );
  }, 0);
  const megaFlexibilityBoost = scoreMegaFlexibility(plan, data, reasons);
  const inactiveMegaAdjustment = plan.brought.reduce((total, pokemon) => {
    if (!pokemon.inactiveMegaSpecies) return total;

    const viability = regularFormViability(pokemon, data);
    const penalty = (1 - viability) * 4.4;
    if (viability >= 0.55) {
      const detail = activeMegaNames.length
        ? `${pokemon.species} keeps enough regular-form utility while ${activeMegaNames.join(', ')} is active.`
        : `${pokemon.species} has enough regular-form evidence to be considered without Mega evolving.`;
      addReason(reasons, 'Flexible Mega slot', detail, 1, 'neutral');
    } else {
      addReason(reasons, 'Inactive Mega cost', `${pokemon.species} has little regular-form evidence when ${pokemon.inactiveMegaSpecies} is not active.`, -penalty, 'warning');
    }
    return total - (viability >= 0.55 ? penalty * 0.45 : penalty) + (viability >= 0.55 ? 0.6 : 0);
  }, 0);

  score = usageBoost + pairBoost + inactiveMegaAdjustment + megaFlexibilityBoost;
  if (pairBoost > 1.2) addReason(reasons, 'Known core', 'This four includes pairings with useful public-meta priors.', 1.2, 'neutral');
  return clamp(score, -4, 12);
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

  const base = 0.32;
  const dataScore = allVisible.length ? (knownSpecies + knownTypes) / (allVisible.length * 2) : 0.25;
  const setScore = clamp(knownMoveSlots / 24, 0, 1);
  const previewCompleteness = clamp(opponents.length / 6, 0, 1);
  const previewScore = opponents.length ? clamp(opponentDetail / opponents.length, 0, 1) : 0;
  return clamp(base + dataScore * 0.24 + setScore * 0.18 + previewCompleteness * 0.12 + previewScore * 0.08, 0.2, 0.82);
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
  });
  return Array.from(tags).slice(0, 5);
};

const safestLeadScore = (pokemon: PokemonEntry, opponents: PokemonEntry[], data: IndexedData): number => {
  const tags = entryTags(pokemon, data);
  const meta = speciesMeta(pokemon, data);
  if (opponents.length === 0) return 0;

  const incomingPressure = opponents.map((opponent) => bestDamagePressure(opponent, pokemon, data).score);
  const averagePressure = incomingPressure.reduce((total, pressure) => total + pressure, 0) / incomingPressure.length;
  const worstPressure = Math.max(...incomingPressure);
  const highThreats = incomingPressure.filter((pressure) => pressure >= 1.8).length;
  const severeThreats = incomingPressure.filter((pressure) => pressure >= 2.6).length;
  const defensiveMultipliers = opponents.map((opponent) => threatMultiplierInto(opponent, pokemon, data));
  const weakRoutes = defensiveMultipliers.filter((multiplier) => multiplier >= 2).length;
  const sturdyRoutes = defensiveMultipliers.filter((multiplier) => multiplier <= 0.5).length;
  const bulkScore = meta
    ? clamp((meta.baseStats.hp + meta.baseStats.defense + meta.baseStats.specialDefense - 250) / 120, -0.75, 1.1)
    : 0;
  const speed = entrySpeed(pokemon, data) ?? 80;
  const utilityScore =
    (tags.has('fake-out') ? 0.75 : 0) +
    (tags.has('intimidate') ? 0.7 : 0) +
    (tags.has('redirection') ? 0.55 : 0) +
    (tags.has('wide-guard') ? 0.55 : 0) +
    (tags.has('speed-control') || tags.has('tailwind') || tags.has('trick-room') ? 0.45 : 0) +
    (tags.has('priority') ? 0.25 : 0) +
    (speed >= 115 ? 0.18 : 0);

  return (
    10 +
    bulkScore +
    utilityScore +
    sturdyRoutes * 0.28 -
    averagePressure * 1.55 -
    worstPressure * 1.05 -
    highThreats * 0.42 -
    severeThreats * 0.55 -
    weakRoutes * 0.38
  );
};

const safestLeadsFor = (plan: BattlePlan, opponents: PokemonEntry[], data: IndexedData): PokemonEntry[] =>
  [...plan.brought]
    .sort((first, second) => {
      const scoreDelta = safestLeadScore(second, opponents, data) - safestLeadScore(first, opponents, data);
      return scoreDelta || first.species.localeCompare(second.species);
    })
    .slice(0, 2);

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
  const visibleOpponents = filledEntries(opponents).map((opponent) => opponentEntryForScoring(opponent, data));

  const offense = scoreOffense(plan, visibleOpponents, data, reasons);
  const defense = scoreDefense(plan, visibleOpponents, data, reasons, warnings) + scoreIndividualCounterRisk(plan, visibleOpponents, data, reasons, warnings);
  const speed = scoreSpeed(plan, visibleOpponents, data, reasons, warnings);
  const lead = scoreLead(plan, visibleOpponents, data, reasons, warnings);
  const roles = scoreRoles(plan, data, reasons, warnings);
  const meta = scoreMeta(plan, data, reasons);
  const score = clamp(offense + defense + speed + lead + roles + meta, 0, 100);

  const sortedReasons = topReasons(reasons);

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

export const scoreBringFour = (
  plan: BattlePlan,
  opponents: PokemonEntry[],
  data: IndexedData = indexedData
): BringRecommendation => {
  const variants = withMegaLimit(plan, data);
  if (variants.length > 1) {
    return variants
      .map((variant) => scoreSingleBringFour(variant.plan, opponents, data, variant.warning))
      .sort((a, b) => b.score - a.score)[0];
  }

  return scoreSingleBringFour(variants[0].plan, opponents, data, variants[0].warning);
};

const scoreSingleBringFour = (
  plan: BattlePlan,
  opponents: PokemonEntry[],
  data: IndexedData,
  megaLimitWarning?: string
): BringRecommendation => {
  const reasons: ScoreReason[] = [];
  const warnings: string[] = megaLimitWarning ? [megaLimitWarning] : [];
  const visibleOpponents = filledEntries(opponents).map((opponent) => opponentEntryForScoring(opponent, data));

  if (visibleOpponents.length > 0) {
    addReason(reasons, 'Whole preview', `Scored into all ${visibleOpponents.length} opposing preview slots.`, 1.5, 'neutral');
  }

  const offense = scoreOffense(plan, visibleOpponents, data, reasons);
  const defense = scoreDefense(plan, visibleOpponents, data, reasons, warnings) + scoreIndividualCounterRisk(plan, visibleOpponents, data, reasons, warnings);
  const speed = scoreBringSpeed(plan, visibleOpponents, data, reasons, warnings);
  const modeCoverage = scoreModeCoverage(plan, visibleOpponents, data, reasons, warnings);
  const roles = scoreRoles(plan, data, reasons, warnings);
  const meta = scoreMeta(plan, data, reasons);
  const score = clamp(offense + defense + speed + modeCoverage.score + roles + meta, 0, 100);

  const sortedReasons = topReasons(reasons, 'Whole preview');

  return {
    brought: plan.brought,
    safestLeads: safestLeadsFor(plan, visibleOpponents, data),
    score: Math.round(score * 10) / 10,
    confidence: confidenceFor(plan, visibleOpponents, data),
    tags: recommendationTags(plan, data),
    reasons: sortedReasons,
    warnings: Array.from(new Set(warnings)).slice(0, 4),
    benchNotes: [],
    modeChecks: modeCoverage.checks,
    breakdown: { offense, defense, speed, modes: modeCoverage.score, roles, meta }
  };
};

const roleLabelForTag = (tag: string): string | undefined => {
  const labels: Record<string, string> = {
    'fake-out': 'Fake Out',
    'tailwind': 'Tailwind',
    'trick-room': 'Trick Room',
    'speed-control': 'speed control',
    weather: 'weather',
    redirection: 'redirection',
    'wide-guard': 'Wide Guard',
    priority: 'priority',
    intimidate: 'Intimidate',
    pivot: 'pivoting'
  };

  return labels[tag];
};

const benchNotesFor = (
  recommendation: BringRecommendation,
  team: PokemonEntry[],
  opponents: PokemonEntry[],
  data: IndexedData
): BenchNote[] => {
  const broughtIds = new Set(recommendation.brought.map((pokemon) => pokemon.id));
  const selectedTags = new Set(recommendation.brought.flatMap((pokemon) => Array.from(entryTags(pokemon, data))));
  const selectedHasMega = recommendation.brought.some((pokemon) => isMegaSpecies(pokemon.species));
  const allVisibleOpponents = filledEntries(opponents).map((opponent) => opponentEntryForScoring(opponent, data));
  const previewOpponents = allVisibleOpponents;

  return filledEntries(team)
    .filter((pokemon) => !broughtIds.has(pokemon.id))
    .map((pokemon) => {
      const tags = entryTags(pokemon, data);
      const overlappingRoles = Array.from(tags)
        .filter((tag) => selectedTags.has(tag))
        .map(roleLabelForTag)
        .filter((label): label is string => Boolean(label));
      const bestPressure = previewOpponents.length
        ? Math.max(...previewOpponents.map((opponent) => bestDamagePressure(pokemon, opponent, data).score))
        : 0;
      const threat = previewOpponents
        .map((opponent) => ({ opponent, pressure: bestDamagePressure(opponent, pokemon, data).score }))
        .sort((first, second) => second.pressure - first.pressure)[0];

      if (selectedHasMega && isMegaSpecies(pokemon.species)) {
        const regularForm = demoteMegaEntry(pokemon, data);
        if (regularFormViability(regularForm, data) >= 0.55) {
          return { pokemon, reason: `${regularForm.species} can still be brought as a regular form, but this four scored higher.` };
        }
        return { pokemon, reason: 'Mostly competes for the active Mega slot in this four.' };
      }
      if (bestPressure < 0.75) {
        return { pokemon, reason: 'Low immediate damage pressure into the opposing preview.' };
      }
      if (overlappingRoles.length > 0) {
        return { pokemon, reason: `Selected four already covers ${uniqueStrings(overlappingRoles).slice(0, 2).join(' and ')}.` };
      }
      if (threat && threat.pressure >= 2.4) {
        return { pokemon, reason: `Takes heavy pressure from opposing ${threat.opponent.species}.` };
      }

      return { pokemon, reason: 'Lower matchup fit than the selected four after matchup and mode checks.' };
    });
};

export const recommendPlans = (
  team: PokemonEntry[],
  opponents: PokemonEntry[],
  data: IndexedData = indexedData
): Recommendation[] => {
  return enumerateBattlePlans(team)
    .map((plan) => scoreBattlePlan(plan, opponents, data))
    .sort((a, b) => b.score - a.score)
    .map((recommendation, index, all) => ({
      ...recommendation,
      confidence: clamp(recommendation.confidence - index * 0.002 + (recommendation.score - (all.at(-1)?.score ?? 0)) / 1000, 0.2, 0.86)
    }));
};

export const recommendBringFours = (
  team: PokemonEntry[],
  opponents: PokemonEntry[],
  data: IndexedData = indexedData
): BringRecommendation[] => {
  const available = filledEntries(team);
  return enumerateBringFours(team)
    .map((plan) => scoreBringFour(plan, opponents, data))
    .sort((a, b) => b.score - a.score)
    .map((recommendation, index, all) => ({
      ...recommendation,
      benchNotes: benchNotesFor(recommendation, available, opponents, data),
      confidence: clamp(recommendation.confidence - index * 0.002 + (recommendation.score - (all.at(-1)?.score ?? 0)) / 1000, 0.2, 0.86)
    }));
};
