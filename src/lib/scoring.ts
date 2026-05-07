import { combinations, enumerateBattlePlans, filledEntries } from './candidates';
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

const abilityTextFor = (pokemon: PokemonEntry, data: IndexedData): string =>
  [pokemon.ability ?? '', ...(speciesMeta(pokemon, data)?.abilities ?? [])].join(' ').toLowerCase();

const entryTags = (pokemon: PokemonEntry, data: IndexedData): Set<string> => {
  const tags = new Set<string>(speciesMeta(pokemon, data)?.roleTags ?? []);
  nonEmptyMoves(pokemon).forEach((moveName) => {
    findMove(moveName, data)?.tags.forEach((tag) => tags.add(tag));
    const moveKey = normalizeKey(moveName);
    if (moveKey === 'perishsong') tags.add('perish');
    if (['encore', 'disable', 'taunt'].includes(moveKey)) tags.add('disruption');
    if (['swordsdance', 'nastyplot', 'calmmind', 'clangoroussoul', 'quiverdance', 'bulkup', 'dragondance', 'shellsmash', 'irondefense'].includes(moveKey)) {
      tags.add('setup');
    }
  });
  const abilityText = abilityTextFor(pokemon, data);
  if (abilityText.includes('intimidate')) tags.add('intimidate');
  if (abilityText.includes('prankster')) tags.add('speed-control');
  if (abilityText.includes('drizzle') || abilityText.includes('drought')) tags.add('weather');
  if (abilityText.includes('friend guard')) tags.add('support');
  if (abilityText.includes('shadow tag')) tags.add('trap');
  tags.delete('hazard');
  return tags;
};

const hasTrapSignal = (pokemon: PokemonEntry, data: IndexedData): boolean => {
  const abilityText = abilityTextFor(pokemon, data);
  return abilityText.includes('shadow tag') || (speciesMeta(pokemon, data)?.roleTags ?? []).includes('trap');
};

const hasPriorityBlockSignal = (pokemon: PokemonEntry, data: IndexedData): boolean => {
  const abilityText = abilityTextFor(pokemon, data);
  return (
    entryTags(pokemon, data).has('priority-block') ||
    abilityText.includes('armor tail') ||
    abilityText.includes('queenly majesty') ||
    abilityText.includes('dazzling')
  );
};

const pranksterBlockedMoveKeys = new Set([
  'babydolleyes',
  'charm',
  'confide',
  'cottonspore',
  'disable',
  'encore',
  'faketears',
  'growl',
  'leechseed',
  'memento',
  'scaryface',
  'spore',
  'stunspore',
  'swagger',
  'tailwhip',
  'taunt',
  'thunderwave',
  'tickle',
  'torment',
  'trick',
  'worryseed'
]);

const blockedPriorityMoves = (pokemon: PokemonEntry, data: IndexedData): string[] => {
  const abilitySources = pokemon.ability?.trim() ? [pokemon.ability] : (speciesMeta(pokemon, data)?.abilities ?? []);
  const hasPrankster = abilitySources.join(' ').toLowerCase().includes('prankster');

  return nonEmptyMoves(pokemon).filter((moveName) => {
    const move = findMove(moveName, data);
    const moveKey = normalizeKey(moveName);
    if (move?.tags.includes('fake-out') || move?.tags.includes('priority')) return true;
    return hasPrankster && pranksterBlockedMoveKeys.has(moveKey);
  });
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

type WeatherKind = 'Sun' | 'Rain' | 'Sand' | 'Snow';

interface OpponentScenario {
  opponents: PokemonEntry[];
  weight: number;
  label: string;
}

const moveKeysFor = (pokemon: PokemonEntry): Set<string> => new Set(nonEmptyMoves(pokemon).map(normalizeKey));

const damagingMovesFor = (pokemon: PokemonEntry, data: IndexedData): MoveData[] =>
  movePoolFor(pokemon, data).filter((move) => move.category !== 'Status' && Boolean(move.power));

const hasSpreadDamage = (pokemon: PokemonEntry, data: IndexedData): boolean =>
  damagingMovesFor(pokemon, data).some((move) => move.tags.includes('spread')) || entryTags(pokemon, data).has('spread');

const isDamageDealer = (pokemon: PokemonEntry, data: IndexedData): boolean => {
  const tags = entryTags(pokemon, data);
  const meta = speciesMeta(pokemon, data);
  return (
    tags.has('physical-attacker') ||
    tags.has('special-attacker') ||
    damagingMovesFor(pokemon, data).length >= 2 ||
    Boolean(meta && Math.max(meta.baseStats.attack, meta.baseStats.specialAttack) >= 120)
  );
};

const offensiveBiasFor = (pokemon: PokemonEntry, data: IndexedData): 'physical' | 'special' | 'mixed' | 'passive' => {
  const moves = damagingMovesFor(pokemon, data);
  const physicalMoves = moves.filter((move) => move.category === 'Physical').length;
  const specialMoves = moves.filter((move) => move.category === 'Special').length;
  const meta = speciesMeta(pokemon, data);

  if (physicalMoves > 0 || specialMoves > 0) {
    if (physicalMoves >= 2 && specialMoves >= 2) return 'mixed';
    if (physicalMoves > specialMoves) return 'physical';
    if (specialMoves > physicalMoves) return 'special';
  }

  if (!meta) return 'passive';
  if (meta.baseStats.attack >= meta.baseStats.specialAttack + 20) return 'physical';
  if (meta.baseStats.specialAttack >= meta.baseStats.attack + 20) return 'special';
  if (Math.max(meta.baseStats.attack, meta.baseStats.specialAttack) >= 115) return 'mixed';
  return 'passive';
};

const weatherKindFor = (pokemon: PokemonEntry, data: IndexedData): WeatherKind | undefined => {
  const abilityText = abilityTextFor(pokemon, data);
  const moveKeys = moveKeysFor(pokemon);
  if (abilityText.includes('drought') || moveKeys.has('sunnyday')) return 'Sun';
  if (abilityText.includes('drizzle') || moveKeys.has('raindance')) return 'Rain';
  if (abilityText.includes('sandstream') || moveKeys.has('sandstorm')) return 'Sand';
  if (abilityText.includes('snowwarning') || moveKeys.has('snowscape') || moveKeys.has('chillyreception')) return 'Snow';
  return undefined;
};

const isWeatherAbuser = (pokemon: PokemonEntry, kind: WeatherKind, data: IndexedData): boolean => {
  const types = entryTypes(pokemon, data);
  const moveKeys = moveKeysFor(pokemon);
  const abilityText = abilityTextFor(pokemon, data);

  if (kind === 'Sun') {
    return (
      types.includes('Fire') ||
      moveKeys.has('solarbeam') ||
      moveKeys.has('weatherball') ||
      abilityText.includes('chlorophyll') ||
      abilityText.includes('solar power')
    );
  }
  if (kind === 'Rain') {
    return types.includes('Water') || abilityText.includes('swift swim') || moveKeys.has('thunder') || moveKeys.has('hurricane');
  }
  if (kind === 'Sand') {
    return types.some((type) => ['Rock', 'Ground', 'Steel'].includes(type)) || abilityText.includes('sand rush') || abilityText.includes('sand veil');
  }
  return types.includes('Ice');
};

const publicPairFor = (first: PokemonEntry, second: PokemonEntry, data: IndexedData) => {
  const direct = findPair(first.species, second.species, data);
  if (direct) return direct;
  return findPair(baseSpeciesForMega(first.species, data), baseSpeciesForMega(second.species, data), data);
};

const maxLeadDamageInto = (plan: BattlePlan, target: PokemonEntry, data: IndexedData): number =>
  Math.max(...plan.leads.map((lead) => bestDamagePressure(lead, target, data).score));

const hasLeadPressureInto = (plan: BattlePlan, targets: PokemonEntry[], data: IndexedData, threshold = 1.35): boolean =>
  targets.some((target) => maxLeadDamageInto(plan, target, data) >= threshold);

const hasFastLeadPressureInto = (plan: BattlePlan, target: PokemonEntry, data: IndexedData, threshold = 1.55): boolean => {
  const targetSpeed = entrySpeed(target, data) ?? 80;
  return plan.leads.some((lead) => {
    const leadSpeed = entrySpeed(lead, data) ?? 80;
    return leadSpeed >= targetSpeed - 5 && bestDamagePressure(lead, target, data).score >= threshold;
  });
};

const hasWorkingFakeOutInto = (
  plan: BattlePlan,
  target: PokemonEntry,
  enemyPriorityBlocker: PokemonEntry | undefined,
  data: IndexedData
): boolean => {
  if (entryTypes(target, data).includes('Ghost')) return false;

  return plan.leads.some((lead) => {
    if (!entryTags(lead, data).has('fake-out')) return false;
    if (!enemyPriorityBlocker) return true;
    return !blockedPriorityMoves(lead, data).some((moveName) => normalizeKey(moveName) === 'fakeout');
  });
};

const hasProtectSignal = (pokemon: PokemonEntry, data: IndexedData): boolean =>
  nonEmptyMoves(pokemon).some((moveName) => findMove(moveName, data)?.tags.includes('protect'));

const isSpeedControlSetter = (pokemon: PokemonEntry, data: IndexedData): boolean => {
  const tags = entryTags(pokemon, data);
  const keys = moveKeysFor(pokemon);
  return tags.has('tailwind') || tags.has('trick-room') || keys.has('icywind') || keys.has('electroweb') || keys.has('scaryface');
};

const isModeLead = (pokemon: PokemonEntry, data: IndexedData): boolean => {
  const tags = entryTags(pokemon, data);
  return (
    isSpeedControlSetter(pokemon, data) ||
    tags.has('weather') ||
    tags.has('trap') ||
    tags.has('perish') ||
    tags.has('setup') ||
    tags.has('redirection')
  );
};

const canStopStatusSetup = (enemy: PokemonEntry, setter: PokemonEntry, data: IndexedData): boolean => {
  const enemyKeys = moveKeysFor(enemy);
  const enemyTags = entryTags(enemy, data);
  const enemySpeed = entrySpeed(enemy, data) ?? 80;
  const setterSpeed = entrySpeed(setter, data) ?? 80;
  const fakeOutStops = enemyTags.has('fake-out') && !entryTypes(setter, data).includes('Ghost');
  const fastTauntStops = enemyKeys.has('taunt') && enemySpeed >= setterSpeed - 5;

  return fakeOutStops || fastTauntStops;
};

const physicalPressureShare = (attacker: PokemonEntry, defender: PokemonEntry, data: IndexedData): number => {
  const moves = damagingMovesFor(attacker, data);
  if (moves.length === 0) return offensiveBiasFor(attacker, data) === 'physical' ? 1 : 0;

  const defenderTypes = entryTypes(defender, data);
  const physicalMoves = moves.filter((move) => move.category === 'Physical' && effectiveness(move.type, defenderTypes) > 0).length;
  return physicalMoves / moves.length;
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

const leadPairWeightFor = (leads: PokemonEntry[], inference: OpponentInference, data: IndexedData): number => {
  const tags = leads.map((pokemon) => entryTags(pokemon, data));
  let weight = 1;

  leads.forEach((pokemon, index) => {
    const pokemonTags = tags[index];
    const meta = speciesMeta(pokemon, data);
    if (pokemonTags.has('lead-pressure')) weight += 0.45;
    if (pokemonTags.has('fake-out')) weight += 0.35;
    if (pokemonTags.has('tailwind')) weight += inference.archetypes.includes('Tailwind') ? 0.75 : 0.35;
    if (pokemonTags.has('trick-room')) weight += inference.archetypes.includes('Trick Room') ? 0.9 : 0.45;
    if (pokemonTags.has('redirection')) weight += 0.35;
    if (hasPriorityBlockSignal(pokemon, data)) weight += 0.55;
    if (pokemonTags.has('trap') || pokemonTags.has('perish')) weight += inference.archetypes.includes('Perish Trap') ? 0.75 : 0.25;
    if ((meta?.baseStats.speed ?? 0) >= 125) weight += 0.2;
  });

  const pair = leads.length >= 2 ? publicPairFor(leads[0], leads[1], data) : undefined;
  if (pair) weight += clamp((pair.frequency ?? 0) * 4 * clamp((pair.sampleSize ?? 0) / 800, 0, 1), 0, 0.75);
  if (tags.some((tagSet) => tagSet.has('fake-out')) && tags.some((tagSet) => tagSet.has('tailwind') || tagSet.has('trick-room'))) weight += 0.45;
  if (tags.some((tagSet) => tagSet.has('redirection')) && tags.some((tagSet) => tagSet.has('setup'))) weight += 0.35;
  if (leads.some((pokemon) => hasSpreadDamage(pokemon, data))) weight += 0.2;

  return weight;
};

const buildOpponentLeadScenarios = (opponents: PokemonEntry[], inference: OpponentInference, data: IndexedData): OpponentScenario[] => {
  const visible = filledEntries(opponents);
  if (visible.length === 0) return [];

  const leadGroups = visible.length === 1 ? [visible] : combinations(visible, 2);
  const weighted = leadGroups.map((leads) => ({
    opponents: leads,
    weight: leadPairWeightFor(leads, inference, data),
    label: leads.map((pokemon) => pokemon.species).join(' + ')
  }));
  const total = weighted.reduce((sum, scenario) => sum + scenario.weight, 0) || 1;
  return weighted
    .map((scenario) => ({ ...scenario, weight: scenario.weight / total }))
    .sort((first, second) => second.weight - first.weight);
};

const fastSpreadThreatsIntoLead = (plan: BattlePlan, enemyLeads: PokemonEntry[], data: IndexedData): PokemonEntry[] => {
  const ourLeadTags = plan.leads.map((pokemon) => entryTags(pokemon, data));
  const hasWideGuardLead = ourLeadTags.some((tags) => tags.has('wide-guard'));
  const enemyPriorityBlocker = enemyLeads.find((pokemon) => hasPriorityBlockSignal(pokemon, data));
  if (hasWideGuardLead) return [];

  return enemyLeads.filter((enemy) => {
    if (hasWorkingFakeOutInto(plan, enemy, enemyPriorityBlocker, data)) return false;

    return plan.leads.some((lead) => {
      const pressure = bestDamagePressure(enemy, lead, data);
      const enemySpeed = entrySpeed(enemy, data) ?? 80;
      const leadSpeed = entrySpeed(lead, data) ?? 80;
      const fastEnough = enemySpeed >= leadSpeed - 20 || enemySpeed >= 120;
      const spreadPressure = pressure.move?.tags.includes('spread') || hasSpreadDamage(enemy, data);
      const majorThreat = pressure.score >= 2.1 || pressure.multiplier >= 4;
      return fastEnough && spreadPressure && majorThreat;
    });
  });
};

const scoreLeadIntoScenario = (plan: BattlePlan, scenario: OpponentScenario, data: IndexedData): number => {
  const enemyLeads = scenario.opponents;
  const ourLeadTags = plan.leads.map((pokemon) => entryTags(pokemon, data));
  const enemyLeadTags = enemyLeads.map((pokemon) => entryTags(pokemon, data));
  const leadAttackers = plan.leads.filter((pokemon) => isDamageDealer(pokemon, data));
  const enemyPriorityBlocker = enemyLeads.find((pokemon) => hasPriorityBlockSignal(pokemon, data));
  const enemyTrickRoomSetters = enemyLeads.filter((pokemon) => entryTags(pokemon, data).has('trick-room'));
  const enemyTailwindSetters = enemyLeads.filter((pokemon) => entryTags(pokemon, data).has('tailwind'));
  const enemyRedirection = enemyLeads.filter((pokemon) => entryTags(pokemon, data).has('redirection'));
  const blockedTools = enemyPriorityBlocker ? plan.leads.flatMap((pokemon) => blockedPriorityMoves(pokemon, data)) : [];
  const ourLeadSpeedAverage =
    plan.leads
      .map((pokemon) => entrySpeed(pokemon, data) ?? 80)
      .reduce((total, speed) => total + speed, 0) / Math.max(plan.leads.length, 1);
  const enemyLeadSpeedAverage =
    enemyLeads
      .map((pokemon) => entrySpeed(pokemon, data) ?? 80)
      .reduce((total, speed) => total + speed, 0) / Math.max(enemyLeads.length, 1);
  const hasLeadSpeedControl = ourLeadTags.some((tags) => tags.has('tailwind') || tags.has('trick-room') || tags.has('speed-control'));
  const hasLeadDisruption = plan.leads.some((pokemon) => {
    const keys = moveKeysFor(pokemon);
    return ['taunt', 'encore', 'disable', 'imprison'].some((key) => keys.has(key)) && blockedPriorityMoves(pokemon, data).length === 0;
  });
  const hasWideGuardLead = ourLeadTags.some((tags) => tags.has('wide-guard'));
  const hasLeadSpread = plan.leads.some((pokemon) => hasSpreadDamage(pokemon, data));
  const fastSpreadThreats = new Set<PokemonEntry>();
  let score = 0;

  plan.leads.forEach((lead) => {
    const bestDamage = Math.max(...enemyLeads.map((enemy) => bestDamagePressure(lead, enemy, data).score));
    if (bestDamage >= 2.2) score += 1.45;
    else if (bestDamage >= 1.45) score += 0.85;
    else if (bestDamage >= 0.85) score += 0.2;
    else score -= 0.85;

    const incomingPressure = Math.max(...enemyLeads.map((enemy) => bestDamagePressure(enemy, lead, data).score));
    if (incomingPressure >= 2.35) score -= 1.35;
    else if (incomingPressure >= 1.55) score -= 0.65;
    if (entryTags(lead, data).has('late-game')) score -= incomingPressure >= 1.35 ? 1.4 : 0.65;

    enemyLeads.forEach((enemy) => {
      const pressure = bestDamagePressure(enemy, lead, data);
      const enemySpeed = entrySpeed(enemy, data) ?? 80;
      const leadSpeed = entrySpeed(lead, data) ?? 80;
      const fastEnough = enemySpeed >= leadSpeed - 20 || enemySpeed >= 120;
      const spreadPressure = pressure.move?.tags.includes('spread') || hasSpreadDamage(enemy, data);
      const majorThreat = pressure.score >= 2.1 || pressure.multiplier >= 4;
      if (!fastEnough || !spreadPressure || !majorThreat) return;

      fastSpreadThreats.add(enemy);
      let liability = 1.35;
      if (pressure.multiplier >= 4) liability += 1.25;
      else if (pressure.multiplier >= 2) liability += 0.45;
      if (pressure.score >= 3.5) liability += 0.75;
      if (entryTags(lead, data).has('weather') || entryTags(lead, data).has('support') || entryTags(lead, data).has('tailwind')) liability += 0.6;
      if (bestDamagePressure(lead, enemy, data).score < 1.25) liability += 0.5;
      if (hasWideGuardLead) liability *= 0.35;
      else if (hasWorkingFakeOutInto(plan, enemy, enemyPriorityBlocker, data)) liability *= 0.55;
      else if (hasFastLeadPressureInto(plan, enemy, data, 1.65)) liability *= 0.9;

      score -= liability;
    });
  });

  enemyLeads.forEach((enemy) => {
    const bestLeadDamage = Math.max(...plan.leads.map((lead) => bestDamagePressure(lead, enemy, data).score));
    if (bestLeadDamage < 0.75) score -= 1;
  });

  fastSpreadThreats.forEach((enemy) => {
    if (hasWideGuardLead || hasWorkingFakeOutInto(plan, enemy, enemyPriorityBlocker, data)) return;
    if (hasFastLeadPressureInto(plan, enemy, data, 1.65)) score -= 1.35;
    else score -= hasLeadDisruption ? 1.6 : 2.4;
  });

  if (leadAttackers.length === 0) score -= 3.2;
  if (leadAttackers.length === 1 && ourLeadTags.every((tags) => tags.has('support') || tags.has('redirection') || tags.has('fake-out'))) score -= 1.1;

  const fakeOutWorks = ourLeadTags.some((tags, index) => {
    if (!tags.has('fake-out')) return false;
    if (!enemyPriorityBlocker) return true;
    return !blockedPriorityMoves(plan.leads[index], data).some((move) => normalizeKey(move) === 'fakeout');
  });
  if (fakeOutWorks && enemyLeadTags.every((tags) => !tags.has('fake-out'))) score += 0.8;
  if (blockedTools.length > 0) score -= Math.min(3.2, blockedTools.length * 1.25);

  if (hasLeadSpeedControl) score += 0.75;
  if (ourLeadSpeedAverage > enemyLeadSpeedAverage + 18) score += 0.7;
  if (ourLeadSpeedAverage < enemyLeadSpeedAverage - 22 && !hasLeadSpeedControl) score -= 1.15;

  if (enemyTrickRoomSetters.length > 0) {
    if (hasLeadDisruption || hasLeadPressureInto(plan, enemyTrickRoomSetters, data, 1.35) || ourLeadTags.some((tags) => tags.has('trick-room'))) score += 1.5;
    else score -= 3.4;
  }
  if (enemyTailwindSetters.length > 0) {
    if (hasLeadSpeedControl || hasLeadDisruption || hasLeadPressureInto(plan, enemyTailwindSetters, data, 1.35)) score += 0.9;
    else score -= 1.8;
  }
  if (enemyRedirection.length > 0) {
    if (hasLeadSpread || hasLeadDisruption) score += 0.75;
    else score -= 1.4;
  }

  if (ourLeadTags.some((tags) => tags.has('tailwind')) && leadAttackers.length >= 1) score += 0.9;
  if (ourLeadTags.some((tags) => tags.has('redirection')) && plan.leads.some((pokemon) => entryTags(pokemon, data).has('setup'))) score += 0.8;
  if (hasLeadSpread && hasLeadSpeedControl) score += 0.65;

  return clamp(score, -12, 12);
};

const scoreTurnOneIntoScenario = (plan: BattlePlan, scenario: OpponentScenario, data: IndexedData): number => {
  const enemyLeads = scenario.opponents;
  const ourLeadTags = plan.leads.map((pokemon) => entryTags(pokemon, data));
  const enemyPriorityBlocker = enemyLeads.find((pokemon) => hasPriorityBlockSignal(pokemon, data));
  const hasWideGuardLead = ourLeadTags.some((tags) => tags.has('wide-guard'));
  const hasRedirectionLead = ourLeadTags.some((tags) => tags.has('redirection'));
  const hasIntimidateLead = ourLeadTags.some((tags) => tags.has('intimidate'));
  const hasFakeOutLead = enemyLeads.some((enemy) => hasWorkingFakeOutInto(plan, enemy, enemyPriorityBlocker, data));
  const enemyHasSpread = enemyLeads.some((enemy) => hasSpreadDamage(enemy, data));
  const ourPressure = enemyLeads.reduce((total, enemy) => total + maxLeadDamageInto(plan, enemy, data), 0);
  const enemyPressure = plan.leads.reduce(
    (total, lead) => total + Math.max(...enemyLeads.map((enemy) => bestDamagePressure(enemy, lead, data).score)),
    0
  );
  let score = clamp((ourPressure - enemyPressure) * 0.7, -3.4, 3.2);

  if (hasWideGuardLead && enemyHasSpread) score += 1.1;
  if (hasFakeOutLead) score += 0.75;
  if (hasRedirectionLead && !enemyHasSpread) score += 0.45;

  plan.leads.forEach((lead, index) => {
    const leadTags = ourLeadTags[index];
    const leadSpeed = entrySpeed(lead, data) ?? 80;
    const partner = plan.leads.find((candidate) => candidate.id !== lead.id);
    const partnerPressure = partner ? Math.max(...enemyLeads.map((enemy) => bestDamagePressure(partner, enemy, data).score)) : 0;
    const incoming = enemyLeads.map((enemy) => ({
      enemy,
      pressure: bestDamagePressure(enemy, lead, data),
      speed: entrySpeed(enemy, data) ?? 80
    }));
    const strongIncoming = incoming.filter((item) => item.pressure.score >= 1.65 || item.pressure.multiplier >= 2);
    const fastIncoming = strongIncoming.filter(
      (item) => item.speed >= leadSpeed - 15 || item.pressure.move?.tags.includes('priority') || item.pressure.move?.tags.includes('fake-out')
    );
    const spreadIncoming = strongIncoming.filter((item) => item.pressure.move?.tags.includes('spread') || hasSpreadDamage(item.enemy, data));
    const worstIncoming = Math.max(0, ...incoming.map((item) => item.pressure.score));
    const bestLeadPressure = Math.max(...enemyLeads.map((enemy) => bestDamagePressure(lead, enemy, data).score));
    const protectedByUtility =
      (hasWideGuardLead && spreadIncoming.length > 0) ||
      fastIncoming.some((item) => hasWorkingFakeOutInto(plan, item.enemy, enemyPriorityBlocker, data)) ||
      (hasRedirectionLead && !leadTags.has('redirection') && spreadIncoming.length === 0) ||
      (hasIntimidateLead && incoming.some((item) => physicalPressureShare(item.enemy, lead, data) >= 0.55));

    if (fastIncoming.length > 0 && !protectedByUtility) {
      const frailtyPenalty = isModeLead(lead, data) ? 1.15 : 0.65;
      score -= frailtyPenalty + (bestLeadPressure < 1.35 ? 0.65 : 0);
    }
    if (strongIncoming.length >= 2 && !protectedByUtility) {
      score -= 1.25 + (partnerPressure < 1.35 ? 0.55 : 0);
    }
    if (isSpeedControlSetter(lead, data)) {
      const stoppers = enemyLeads.filter((enemy) => canStopStatusSetup(enemy, lead, data));
      const stopCovered = stoppers.some(
        (enemy) => hasWorkingFakeOutInto(plan, enemy, enemyPriorityBlocker, data) || hasFastLeadPressureInto(plan, enemy, data, 1.65)
      );
      if (stoppers.length > 0 && !stopCovered && partnerPressure < 1.45) score -= 1.7;
      else if (stoppers.length === 0 && worstIncoming < 1.55) score += 0.55;
    }
    if (hasProtectSignal(lead, data) && partnerPressure >= 1.55 && worstIncoming >= 1.8) score += 0.35;
  });

  if (enemyLeads.every((enemy) => maxLeadDamageInto(plan, enemy, data) < 1.05) && !hasFakeOutLead && !hasRedirectionLead) score -= 1.8;
  if (enemyLeads.some((enemy) => maxLeadDamageInto(plan, enemy, data) >= 2.2) && ourPressure >= enemyPressure - 0.4) score += 0.7;

  return clamp(score, -8, 6);
};

const scoreLeadFloor = (
  plan: BattlePlan,
  opponents: PokemonEntry[],
  data: IndexedData,
  inference: OpponentInference,
  reasons: ScoreReason[],
  warnings: string[]
): number => {
  const scenarios = buildOpponentLeadScenarios(opponents, inference, data);
  if (scenarios.length === 0) return 0;

  const scenarioScores = scenarios.map((scenario) => ({
    scenario,
    score: scoreLeadIntoScenario(plan, scenario, data),
    weight: scenario.weight
  }));
  const weightedAverage = scenarioScores.reduce((total, item) => total + item.score * item.weight, 0);
  const lowerTail = weightedQuantile(scenarioScores, 0.25);
  const worst = scenarioScores.reduce((lowest, item) => (item.score < lowest.score ? item : lowest), scenarioScores[0]);
  const leadFloorScore = clamp(weightedAverage * 0.55 + lowerTail * 0.95 - Math.max(0, weightedAverage - lowerTail) * 0.35, -6, 6);
  const worstFastSpreadThreats = fastSpreadThreatsIntoLead(plan, worst.scenario.opponents, data);

  if (leadFloorScore >= 2) {
    addReason(reasons, 'Lead floor', `${plan.leads.map((pokemon) => pokemon.species).join(' + ')} has a stable opening into plausible opposing leads.`, 1.8, 'neutral');
  } else if (leadFloorScore <= -2) {
    addReason(reasons, 'Fragile lead', `Worst plausible lead: ${worst.scenario.label}.`, -2.6, 'warning');
    warnings.push(`Lead risk: ${worst.scenario.label} is a rough opening for ${plan.leads.map((pokemon) => pokemon.species).join(' + ')}.`);
  } else if (worstFastSpreadThreats.length > 0 && leadFloorScore < 1.6) {
    addReason(
      reasons,
      'Spread lead risk',
      `${worstFastSpreadThreats.map((pokemon) => pokemon.species).join(' + ')} can pressure this lead with fast spread damage.`,
      -2.2,
      'warning'
    );
    warnings.push(`Lead risk: fast spread pressure from ${worstFastSpreadThreats.map((pokemon) => pokemon.species).join(' + ')} can punish this opener.`);
  }

  return leadFloorScore;
};

const scoreTurnOneSafety = (
  plan: BattlePlan,
  opponents: PokemonEntry[],
  data: IndexedData,
  inference: OpponentInference,
  reasons: ScoreReason[],
  warnings: string[]
): number => {
  const scenarios = buildOpponentLeadScenarios(opponents, inference, data);
  if (scenarios.length === 0) return 0;

  const scenarioScores = scenarios.map((scenario) => ({
    scenario,
    score: scoreTurnOneIntoScenario(plan, scenario, data),
    weight: scenario.weight
  }));
  const weightedAverage = scenarioScores.reduce((total, item) => total + item.score * item.weight, 0);
  const lowerTail = weightedQuantile(scenarioScores, 0.25);
  const worst = scenarioScores.reduce((lowest, item) => (item.score < lowest.score ? item : lowest), scenarioScores[0]);
  const safetyScore = clamp(weightedAverage * 0.55 + lowerTail * 0.85, -5.5, 4.5);
  const leadNames = plan.leads.map((pokemon) => pokemon.species).join(' + ');

  if (safetyScore >= 2.2) {
    addReason(reasons, 'Clean first turn', `${leadNames} usually has an active first turn into plausible openings.`, 1.7, 'neutral');
  } else if (safetyScore <= -1.8) {
    addReason(reasons, 'Turn-one risk', `${worst.scenario.label} can force this opener into a defensive first turn.`, -2.7, 'warning');
    warnings.push(`Turn-one risk: ${worst.scenario.label} can make ${leadNames} protect or lose tempo immediately.`);
  }

  return safetyScore;
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
  const priorityBlocker = opponents.find((opponent) => hasPriorityBlockSignal(opponent, data));
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
  const blockedLeadTools = priorityBlocker
    ? plan.leads.flatMap((pokemon) => blockedPriorityMoves(pokemon, data).map((move) => `${pokemon.species} ${move}`))
    : [];
  const blockedBackTools = priorityBlocker
    ? plan.backs.flatMap((pokemon) => blockedPriorityMoves(pokemon, data).map((move) => `${pokemon.species} ${move}`))
    : [];
  const priorityBlockPenalty = priorityBlocker
    ? clamp(blockedLeadTools.length * 2.4 + blockedBackTools.length * 0.65, 0, 6)
    : 0;
  const leadFakeOutWorks = leadTags.some((tags, index) => {
    if (!tags.has('fake-out')) return false;
    if (!priorityBlocker) return true;
    return !blockedPriorityMoves(plan.leads[index], data).some((move) => normalizeKey(move) === 'fakeout');
  });
  const leadScenarioScore = scoreLeadFloor(plan, opponents, data, inference, reasons, warnings);
  const turnOneSafetyScore = scoreTurnOneSafety(plan, opponents, data, inference, reasons, warnings);

  if (leadFakeOutWorks) score += 3;
  if (leadTags.some((tags) => tags.has('redirection'))) score += 2.5;
  if (leadTags.some((tags) => tags.has('intimidate'))) score += 1.5;
  if (leadTags.some((tags) => tags.has('wide-guard'))) score += opponents.some((opponent) => entryTags(opponent, data).has('spread')) ? 2.5 : 0.8;
  if (perishTrapMode && hasTrapLead) score += 6;
  if (perishTrapMode && hasTrapLead && hasPerishLead) score += 1.6;
  if (perishTrapMode && hasTrapLead && hasPerishSupportLead) score += 1.3;
  if (perishTrapMode && !hasTrapInFour) score -= 10;
  else if (perishTrapMode && !hasTrapLead) score -= 10;
  if (enemyPerishThreat) {
    if (perishCounterplay >= 4) score += 2.2;
    else if (perishCounterplay >= 2.5) score += 0.4;
    else score -= 4.8 * enemyPerishThreat.confidence;
  }
  score += publicLeadPrior;
  score += leadScenarioScore;
  score += turnOneSafetyScore;
  score -= priorityBlockPenalty;
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

  if (leadFakeOutWorks || leadTags.some((tags) => tags.has('redirection'))) {
    addReason(reasons, 'Lead shape', `${leadNames} has immediate positioning tools.`, 2);
  }
  if (priorityBlocker && priorityBlockPenalty >= 1.2) {
    const blockedSummary = blockedLeadTools.length ? blockedLeadTools.slice(0, 3).join(', ') : blockedBackTools.slice(0, 2).join(', ');
    addReason(
      reasons,
      'Priority blocked',
      `${priorityBlocker.species} can block priority tools like ${blockedSummary}.`,
      -priorityBlockPenalty,
      'warning'
    );
    warnings.push(`${priorityBlocker.species} priority block: do not lean on ${blockedSummary}.`);
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
        const pair = publicPairFor(first, second, data);
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

const speciesScenarioPrior = (pokemon: PokemonEntry, inference: OpponentInference, data: IndexedData): number => {
  const meta = speciesMeta(pokemon, data);
  const tags = entryTags(pokemon, data);
  const weather = weatherKindFor(pokemon, data);
  let score = 1;

  if (meta) {
    const sampleConfidence = clamp((meta.sampleSize ?? 0) / 600, 0.2, 1);
    score += clamp(meta.usage * 2.8, 0, 1.6) * sampleConfidence;
    score += clamp(((meta.winRate ?? 0.5) - 0.5) * 5, -0.3, 0.75) * sampleConfidence;
  }

  if (tags.has('trick-room') && inference.archetypes.includes('Trick Room')) score += 1.25;
  if (tags.has('tailwind') && inference.archetypes.includes('Tailwind')) score += 0.85;
  if (tags.has('perish') || tags.has('trap')) score += inference.archetypes.includes('Perish Trap') ? 1.1 : 0.25;
  if (hasPriorityBlockSignal(pokemon, data)) score += 0.9;
  if (tags.has('redirection')) score += 0.45;
  if (tags.has('fake-out')) score += 0.4;
  if (tags.has('late-game')) score += 0.35;
  if (weather && inference.archetypes.includes(weather)) score += 0.7;

  return clamp(score, 0.35, 4.5);
};

const scenarioKey = (opponents: PokemonEntry[]): string =>
  opponents
    .map((pokemon) => pokemon.id || pokemon.species)
    .sort()
    .join('|');

const scenarioWeightFor = (opponents: PokemonEntry[], inference: OpponentInference, data: IndexedData): number => {
  const individual = opponents.reduce((total, pokemon) => total * Math.pow(speciesScenarioPrior(pokemon, inference, data), 0.55), 1);
  const pairBoost = opponents.reduce((total, first, index) => {
    return (
      total +
      opponents.slice(index + 1).reduce((pairTotal, second) => {
        const pair = publicPairFor(first, second, data);
        if (!pair) return pairTotal;
        const confidence = clamp((pair.sampleSize ?? 0) / 900, 0, 1);
        return pairTotal + clamp(pair.frequency * 5 * confidence, 0, 1.1);
      }, 0)
    );
  }, 0);
  const teamEvidenceBoost = (inference.similarTeams ?? []).reduce((total, team) => {
    const teamKeys = new Set(team.members.map(normalizeKey));
    const overlap = opponents.filter((pokemon) => teamKeys.has(normalizeKey(baseSpeciesForMega(pokemon.species, data)))).length;
    return total + (overlap >= 3 ? team.score * 0.08 : 0);
  }, 0);
  const tags = opponents.map((pokemon) => entryTags(pokemon, data));
  let modeCompleteness = 0;

  if (inference.archetypes.includes('Trick Room') && tags.some((tagSet) => tagSet.has('trick-room'))) modeCompleteness += 1.2;
  if (inference.archetypes.includes('Tailwind') && tags.some((tagSet) => tagSet.has('tailwind'))) modeCompleteness += 0.8;
  if (inference.archetypes.includes('Perish Trap') && tags.some((tagSet) => tagSet.has('trap')) && tags.some((tagSet) => tagSet.has('perish'))) {
    modeCompleteness += 1.4;
  }
  if (opponents.some((pokemon) => hasPriorityBlockSignal(pokemon, data))) modeCompleteness += 0.7;
  Array.from(new Set(opponents.map((pokemon) => weatherKindFor(pokemon, data)).filter(Boolean))).forEach((kind) => {
    if (kind && opponents.some((pokemon) => isWeatherAbuser(pokemon, kind as WeatherKind, data))) modeCompleteness += 0.65;
  });

  return individual * (1 + pairBoost * 0.22 + teamEvidenceBoost * 0.18 + modeCompleteness * 0.18);
};

const buildOpponentScenarios = (opponents: PokemonEntry[], inference: OpponentInference, data: IndexedData): OpponentScenario[] => {
  const visible = filledEntries(opponents);
  if (visible.length === 0) return [];
  if (visible.length <= 4) return [{ opponents: visible, weight: 1, label: visible.map((pokemon) => pokemon.species).join(' + ') }];

  const candidates = new Map<string, OpponentScenario>();
  combinations(visible, 4).forEach((group) => {
    const key = scenarioKey(group);
    candidates.set(key, {
      opponents: group,
      weight: scenarioWeightFor(group, inference, data),
      label: group.map((pokemon) => pokemon.species).join(' + ')
    });
  });

  const forcedModes = [
    visible.find((pokemon) => hasPriorityBlockSignal(pokemon, data)),
    visible.find((pokemon) => entryTags(pokemon, data).has('trick-room')),
    visible.find((pokemon) => entryTags(pokemon, data).has('tailwind')),
    visible.find((pokemon) => entryTags(pokemon, data).has('trap')),
    visible.find((pokemon) => entryTags(pokemon, data).has('perish'))
  ].filter((pokemon): pokemon is PokemonEntry => Boolean(pokemon));

  forcedModes.forEach((forced) => {
    combinations(visible.filter((pokemon) => pokemon.id !== forced.id), 3).forEach((rest) => {
      const group = [forced, ...rest];
      const key = scenarioKey(group);
      const existing = candidates.get(key);
      if (existing) existing.weight *= 1.08;
    });
  });

  const total = Array.from(candidates.values()).reduce((sum, scenario) => sum + scenario.weight, 0) || 1;
  return Array.from(candidates.values())
    .map((scenario) => ({ ...scenario, weight: scenario.weight / total }))
    .sort((first, second) => second.weight - first.weight)
    .slice(0, 12);
};

const scorePlanIntoScenario = (plan: BattlePlan, scenario: OpponentScenario, data: IndexedData): number => {
  const opponents = scenario.opponents;
  const broughtTags = plan.brought.map((pokemon) => entryTags(pokemon, data));
  const leadTags = plan.leads.map((pokemon) => entryTags(pokemon, data));
  const leadAttackers = plan.leads.filter((pokemon) => isDamageDealer(pokemon, data));
  const spreadAttackers = plan.brought.filter((pokemon) => hasSpreadDamage(pokemon, data));
  const hasSpeedControl = broughtTags.some((tags) => tags.has('tailwind') || tags.has('trick-room') || tags.has('speed-control'));
  const hasLeadSpeedControl = leadTags.some((tags) => tags.has('tailwind') || tags.has('trick-room') || tags.has('speed-control'));
  const hasWideGuard = broughtTags.some((tags) => tags.has('wide-guard'));
  const hasPivot = broughtTags.some((tags) => tags.has('pivot') || tags.has('intimidate'));
  const hasGhost = plan.brought.some((pokemon) => isGhostEntry(pokemon, data));
  const leadDisruption = plan.leads.some((pokemon) => {
    const keys = moveKeysFor(pokemon);
    return ['taunt', 'encore', 'disable', 'imprison'].some((key) => keys.has(key));
  });
  const physicalBiasCount = plan.brought.filter((pokemon) => offensiveBiasFor(pokemon, data) === 'physical').length;
  const hasSpecialPressure = plan.brought.some((pokemon) => {
    const bias = offensiveBiasFor(pokemon, data);
    return bias === 'special' || bias === 'mixed';
  });
  let score = 0;

  opponents.forEach((opponent) => {
    const bestDamage = Math.max(...plan.brought.map((pokemon) => bestDamagePressure(pokemon, opponent, data).score));
    const bestLeadDamage = Math.max(...plan.leads.map((pokemon) => bestDamagePressure(pokemon, opponent, data).score));
    if (bestDamage >= 2.4) score += 1.6;
    else if (bestDamage >= 1.45) score += 0.85;
    else if (bestDamage >= 0.8) score += 0.15;
    else score -= 1.4;

    if (bestLeadDamage >= 1.55) score += 0.45;
    if (plan.brought.every((pokemon) => bestDamagePressure(pokemon, opponent, data).score < 0.75)) score -= 1.2;
  });

  plan.brought.forEach((pokemon) => {
    const threateningOpponents = opponents.filter((opponent) => bestDamagePressure(opponent, pokemon, data).score >= 1.75).length;
    const resistantOpponents = opponents.filter((opponent) => threatMultiplierInto(opponent, pokemon, data, true) <= 0.5).length;
    score -= threateningOpponents * 0.55;
    score += resistantOpponents * 0.25;
    if (threateningOpponents >= 3) score -= 0.8;
  });

  plan.leads.forEach((lead) => {
    const tags = entryTags(lead, data);
    if (!tags.has('late-game')) return;

    const checkedByScenario = opponents.some((opponent) => {
      const opponentPressure = bestDamagePressure(opponent, lead, data).score;
      const leadPressure = bestDamagePressure(lead, opponent, data).score;
      return opponentPressure >= 1.45 && leadPressure <= 1.2;
    });
    score -= checkedByScenario ? 1.6 : 0.7;
  });

  const trickRoomSetters = opponents.filter((opponent) => entryTags(opponent, data).has('trick-room'));
  if (trickRoomSetters.length > 0) {
    if (hasLeadPressureInto(plan, trickRoomSetters, data, 1.35) || leadDisruption || leadTags.some((tags) => tags.has('trick-room'))) score += 1.8;
    else score -= 3.3;
  }

  const priorityBlockers = opponents.filter((opponent) => hasPriorityBlockSignal(opponent, data));
  if (priorityBlockers.length > 0) {
    const blockedLeadTools = plan.leads.flatMap((pokemon) => blockedPriorityMoves(pokemon, data));
    const nonPriorityPressure = leadAttackers.length + plan.leads.filter((pokemon) => hasSpreadDamage(pokemon, data)).length;
    if (blockedLeadTools.length >= 2 && nonPriorityPressure < 2) score -= 3.4;
    else if (nonPriorityPressure >= 2) score += 1.1;
  }

  const tailwindSetters = opponents.filter((opponent) => entryTags(opponent, data).has('tailwind'));
  if (tailwindSetters.length > 0) score += hasSpeedControl || hasWideGuard || spreadAttackers.length >= 2 ? 1 : -1.8;

  const redirectionUsers = opponents.filter((opponent) => entryTags(opponent, data).has('redirection'));
  if (redirectionUsers.length > 0) score += spreadAttackers.length > 0 || leadDisruption ? 0.9 : -1.6;

  const spreadThreats = opponents.filter((opponent) => hasSpreadDamage(opponent, data));
  if (spreadThreats.length >= 2) score += hasWideGuard ? 1.3 : -1;

  const defiantUsers = opponents.filter((opponent) => abilityTextFor(opponent, data).includes('defiant'));
  if (defiantUsers.length > 0 && broughtTags.some((tags) => tags.has('intimidate'))) score += physicalBiasCount >= 3 && !hasSpecialPressure ? -2.6 : -0.7;

  const perishThreat = opponents.some((opponent) => entryTags(opponent, data).has('trap')) && opponents.some((opponent) => entryTags(opponent, data).has('perish'));
  if (perishThreat) score += hasPivot || hasGhost || leadDisruption || hasLeadPressureInto(plan, opponents, data, 1.45) ? 1.2 : -2.8;

  const opponentWeather = Array.from(new Set(opponents.map((pokemon) => weatherKindFor(pokemon, data)).filter((kind): kind is WeatherKind => Boolean(kind))));
  opponentWeather.forEach((kind) => {
    const exposed = plan.brought.filter((pokemon) => {
      if (kind !== 'Rain') return false;
      return entryTypes(pokemon, data).some((type) => ['Fire', 'Rock', 'Ground'].includes(type));
    }).length;
    const answers = plan.brought.filter((pokemon) => isWeatherAbuser(pokemon, kind, data)).length;
    if (answers >= 2) score += 0.7;
    else if (exposed >= 3) score -= 1.3;
  });

  if (leadAttackers.length === 0) score -= 3.2;
  if (!hasLeadSpeedControl && hasSpeedControl && plan.leads.filter((pokemon) => (entrySpeed(pokemon, data) ?? 0) < 95).length >= 2) score -= 1.2;

  return clamp(score, -14, 16);
};

const weightedQuantile = (scores: Array<{ score: number; weight: number }>, quantile: number): number => {
  const sorted = [...scores].sort((first, second) => first.score - second.score);
  const totalWeight = sorted.reduce((total, item) => total + item.weight, 0) || 1;
  let cumulative = 0;
  for (const item of sorted) {
    cumulative += item.weight;
    if (cumulative / totalWeight >= quantile) return item.score;
  }
  return sorted.at(-1)?.score ?? 0;
};

const scoreRobustness = (
  plan: BattlePlan,
  opponents: PokemonEntry[],
  data: IndexedData,
  reasons: ScoreReason[],
  warnings: string[],
  inference: OpponentInference
): number => {
  const scenarios = buildOpponentScenarios(opponents, inference, data);
  if (scenarios.length === 0) return 8;

  const scenarioScores = scenarios.map((scenario) => ({
    scenario,
    score: scorePlanIntoScenario(plan, scenario, data),
    weight: scenario.weight
  }));
  const weightedAverage = scenarioScores.reduce((total, item) => total + item.score * item.weight, 0);
  const lowerTail = weightedQuantile(scenarioScores, 0.25);
  const worst = scenarioScores.reduce((lowest, item) => (item.score < lowest.score ? item : lowest), scenarioScores[0]);
  const regret = Math.max(0, weightedAverage - lowerTail);
  const robustness = clamp(8 + weightedAverage * 0.55 + lowerTail * 0.82 - regret * 0.55, -8, 18);

  if (robustness >= 11.5 && lowerTail >= 0) {
    addReason(reasons, 'Stable across scenarios', `This plan keeps a playable floor across ${scenarios.length} plausible opponent bring-4s.`, 2.2, 'neutral');
  } else if (lowerTail <= -2.5) {
    addReason(reasons, 'Fragile scenario floor', `Worst plausible scenario: ${worst.scenario.label}.`, -3.2, 'warning');
    warnings.push(`Robustness risk: ${worst.scenario.label} is a bad lower-tail matchup for this plan.`);
  } else if (regret >= 3.5) {
    addReason(reasons, 'Swingy plan', 'This plan has a strong average but a lower floor across plausible opponent brings.', -1.8, 'warning');
  }

  return robustness;
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
  const robustness = scoreRobustness(plan, visibleOpponents, data, reasons, warnings, inference);
  const hasOpponentPreview = visibleOpponents.length > 0;
  const score = clamp(
    hasOpponentPreview
      ? offense * 1.05 + defense * 1.16 + speed * 0.68 + lead * 0.86 + roles * 0.56 + meta * 0.45 + robustness * 0.95
      : offense + defense + speed + lead + roles + meta + robustness,
    0,
    100
  );

  const sortedReasons = reasons
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 6);

  return {
    ...plan,
    score: Math.round(score * 10) / 10,
    confidence: confidenceFor(plan, visibleOpponents, data, inference),
    tags: recommendationTags(plan, data),
    reasons: sortedReasons,
    warnings: Array.from(new Set(warnings)).slice(0, 4),
    breakdown: { offense, defense, speed, lead, roles, meta, robustness }
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
