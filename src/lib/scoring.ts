import { enumerateBattlePlans, enumerateBringFours, filledEntries } from './candidates';
import { baseSpeciesForMega, findMove, findPair, findSpecies, indexedData, isMegaSpecies, normalizeKey } from './data';
import { inferOpponentPreview } from './opponentInference';
import { effectiveness, multiplierLabel } from './typeChart';
import type {
  BattlePlan,
  BenchNote,
  BringRecommendation,
  IndexedData,
  MetaSpecies,
  ModeCheck,
  MoveData,
  OpponentBringFour,
  OpponentInference,
  PokemonEntry,
  PokemonType,
  Recommendation,
  ScoreReason
} from './types';

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const uniqueStrings = (values: string[]): string[] => Array.from(new Set(values));

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

const previewKeyForScoring = (species: string, data: IndexedData): string => {
  const meta = findSpecies(species, data);
  return normalizeKey(baseSpeciesForMega(meta?.displayName ?? species, data));
};

const opponentEntriesForRead = (
  visibleOpponents: PokemonEntry[],
  read: OpponentBringFour | undefined,
  data: IndexedData
): PokemonEntry[] => {
  if (!read || read.members.length === 0) return visibleOpponents;

  const readKeys = new Set(read.members.map((member) => previewKeyForScoring(member, data)));
  const selected = visibleOpponents.filter((opponent) => readKeys.has(previewKeyForScoring(opponent.species, data)));

  return selected.length >= Math.min(read.members.length, visibleOpponents.length) ? selected : visibleOpponents;
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

const scoreModeCoverage = (
  plan: BattlePlan,
  opponents: PokemonEntry[],
  data: IndexedData,
  inference: OpponentInference,
  reasons: ScoreReason[],
  warnings: string[]
): { score: number; checks: ModeCheck[] } => {
  const opponentTags = opponents.flatMap((pokemon) => Array.from(entryTags(pokemon, data)));
  const modeNames = new Map<string, string>();
  inference.archetypes.forEach((mode) => modeNames.set(normalizeKey(mode), displayModeName(mode)));
  if (opponentTags.includes('redirection')) modeNames.set('redirection', 'Redirection');
  if (opponentTags.includes('late-game')) modeNames.set('endgame', 'Endgame');
  if (opponentTags.includes('priority')) modeNames.set('priority', 'Priority');

  const checks: ModeCheck[] = Array.from(modeNames.values()).map((mode) => {
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

const scoreRiskFloor = (
  plan: BattlePlan,
  allOpponents: PokemonEntry[],
  data: IndexedData,
  inference: OpponentInference,
  reasons: ScoreReason[],
  warnings: string[]
): number => {
  const reads = inference.likelyBringFours.filter((read) => read.members.length >= 4).slice(0, 4);
  if (reads.length === 0 || allOpponents.length === 0) return 0;

  const probabilityTotal = reads.reduce((total, read) => total + read.probability, 0) || 1;
  const risks = reads.map((read) => {
    const opponents = opponentEntriesForRead(allOpponents, read, data);
    const scratchReasons: ScoreReason[] = [];
    const scratchWarnings: string[] = [];
    const offense = scoreOffense(plan, opponents, data, scratchReasons);
    const defense = scoreDefense(plan, opponents, data, scratchReasons, scratchWarnings);
    const speed = scoreBringSpeed(plan, opponents, data, scratchReasons, scratchWarnings);
    const mode = scoreModeCoverage(plan, opponents, data, inference, scratchReasons, scratchWarnings).score;
    const coreScore = offense + defense + speed + mode;
    const weakTargets = opponents.filter((opponent) => Math.max(...plan.brought.map((pokemon) => bestDamagePressure(pokemon, opponent, data).score)) < 0.75);
    const pressuredBrought = plan.brought.filter((pokemon) => Math.max(...opponents.map((opponent) => bestDamagePressure(opponent, pokemon, data).score)) >= 2.4);
    const risk =
      Math.max(0, 34 - coreScore) * 0.25 +
      weakTargets.length * 1.1 +
      Math.max(0, pressuredBrought.length - 2) * 0.75;

    return {
      read,
      risk,
      weakTargets,
      pressuredBrought
    };
  });

  const weightedRisk = risks.reduce((total, risk) => total + risk.risk * (risk.read.probability / probabilityTotal), 0);
  const worst = risks.sort((first, second) => second.risk - first.risk)[0];
  const penalty = clamp(weightedRisk + Math.max(0, (worst?.risk ?? 0) - 4) * 0.45, 0, 12);

  if (penalty >= 2.2 && worst) {
    const weakText = worst.weakTargets.length ? `; limited pressure into ${worst.weakTargets.slice(0, 2).map((pokemon) => pokemon.species).join(', ')}` : '';
    addReason(
      reasons,
      'Risk floor',
      `Worst likely opposing four is ${worst.read.members.join(' + ')}${weakText}.`,
      -penalty,
      'warning'
    );
  }
  if (penalty >= 4.5 && worst) {
    warnings.push(`Risk floor: ${worst.read.members.join(' + ')} is the roughest likely opposing four.`);
  }

  return penalty;
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

const scoreLead = (plan: BattlePlan, opponents: PokemonEntry[], data: IndexedData, reasons: ScoreReason[], warnings: string[], inference: OpponentInference): number => {
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
  const predictedMatchup = predictedLeadMatchup(plan, inference, data, warnings);

  if (leadTags.some((tags) => tags.has('fake-out'))) score += 3;
  if (leadTags.some((tags) => tags.has('redirection'))) score += 2.5;
  if (leadTags.some((tags) => tags.has('intimidate'))) score += 1.5;
  if (leadTags.some((tags) => tags.has('wide-guard'))) score += opponents.some((opponent) => entryTags(opponent, data).has('spread')) ? 2.5 : 0.8;
  if (hasWeavileGlimmoraLead) score += 1.2;
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

export const scoreBattlePlan = (
  plan: BattlePlan,
  opponents: PokemonEntry[],
  data: IndexedData = indexedData,
  inference: OpponentInference = inferOpponentPreview(opponents, data)
): Recommendation => {
  const variants = withMegaLimit(plan, data);
  if (variants.length > 1) {
    return variants
      .map((variant) => scoreSingleBattlePlan(variant.plan, opponents, data, inference, variant.warning))
      .sort((a, b) => b.score - a.score)[0];
  }

  return scoreSingleBattlePlan(variants[0].plan, opponents, data, inference, variants[0].warning);
};

const scoreSingleBattlePlan = (
  plan: BattlePlan,
  opponents: PokemonEntry[],
  data: IndexedData,
  inference: OpponentInference,
  megaLimitWarning?: string
): Recommendation => {
  const reasons: ScoreReason[] = [];
  const warnings: string[] = megaLimitWarning ? [megaLimitWarning] : [];
  const visibleOpponents = filledEntries(opponents).map((opponent) => opponentEntryForScoring(opponent, inference, data));

  const offense = scoreOffense(plan, visibleOpponents, data, reasons);
  const defense = scoreDefense(plan, visibleOpponents, data, reasons, warnings);
  const speed = scoreSpeed(plan, visibleOpponents, data, reasons, warnings);
  const lead = scoreLead(plan, visibleOpponents, data, reasons, warnings, inference);
  const roles = scoreRoles(plan, data, reasons, warnings);
  const meta = scoreMeta(plan, data, reasons);
  const score = clamp(offense + defense + speed + lead + roles + meta, 0, 100);

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

export const scoreBringFour = (
  plan: BattlePlan,
  opponents: PokemonEntry[],
  data: IndexedData = indexedData,
  inference: OpponentInference = inferOpponentPreview(opponents, data)
): BringRecommendation => {
  const variants = withMegaLimit(plan, data);
  if (variants.length > 1) {
    return variants
      .map((variant) => scoreSingleBringFour(variant.plan, opponents, data, inference, variant.warning))
      .sort((a, b) => b.score - a.score)[0];
  }

  return scoreSingleBringFour(variants[0].plan, opponents, data, inference, variants[0].warning);
};

const scoreSingleBringFour = (
  plan: BattlePlan,
  opponents: PokemonEntry[],
  data: IndexedData,
  inference: OpponentInference,
  megaLimitWarning?: string
): BringRecommendation => {
  const reasons: ScoreReason[] = [];
  const warnings: string[] = megaLimitWarning ? [megaLimitWarning] : [];
  const allVisibleOpponents = filledEntries(opponents).map((opponent) => opponentEntryForScoring(opponent, inference, data));
  const opponentRead = inference.likelyBringFours[0];
  const visibleOpponents = allVisibleOpponents;

  if (visibleOpponents.length > 0) {
    addReason(reasons, 'Whole preview', `Scored into all ${visibleOpponents.length} opposing preview slots.`, 1.5, 'neutral');
  }

  const offense = scoreOffense(plan, visibleOpponents, data, reasons);
  const defense = scoreDefense(plan, visibleOpponents, data, reasons, warnings);
  const speed = scoreBringSpeed(plan, visibleOpponents, data, reasons, warnings);
  const modeCoverage = scoreModeCoverage(plan, visibleOpponents, data, inference, reasons, warnings);
  const roles = scoreRoles(plan, data, reasons, warnings);
  const meta = scoreMeta(plan, data, reasons);
  const risk = scoreRiskFloor(plan, allVisibleOpponents, data, inference, reasons, warnings) * 0.45;
  const score = clamp(offense + defense + speed + modeCoverage.score + roles + meta - risk, 0, 100);

  const sortedReasons = reasons
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 5);

  return {
    brought: plan.brought,
    score: Math.round(score * 10) / 10,
    confidence: confidenceFor(plan, visibleOpponents, data, inference),
    tags: recommendationTags(plan, data),
    reasons: sortedReasons,
    warnings: Array.from(new Set(warnings)).slice(0, 4),
    opponentRead,
    benchNotes: [],
    modeChecks: modeCoverage.checks,
    breakdown: { offense, defense, speed, modes: modeCoverage.score, risk, roles, meta }
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
  data: IndexedData,
  inference: OpponentInference
): BenchNote[] => {
  const broughtIds = new Set(recommendation.brought.map((pokemon) => pokemon.id));
  const selectedTags = new Set(recommendation.brought.flatMap((pokemon) => Array.from(entryTags(pokemon, data))));
  const selectedHasMega = recommendation.brought.some((pokemon) => isMegaSpecies(pokemon.species));
  const allVisibleOpponents = filledEntries(opponents).map((opponent) => opponentEntryForScoring(opponent, inference, data));
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
        return { pokemon, reason: 'Would compete for the active Mega slot in this four.' };
      }
      if (bestPressure < 0.75) {
        return { pokemon, reason: 'Low immediate damage pressure into the opposing preview.' };
      }
      if (overlappingRoles.length > 0) {
        return { pokemon, reason: `Selected four already covers ${uniqueStrings(overlappingRoles).slice(0, 2).join(' and ')}.` };
      }
      if (threat && threat.pressure >= 2.4) {
        return { pokemon, reason: `Takes heavy pressure from likely ${threat.opponent.species}.` };
      }

      return { pokemon, reason: 'Lower matchup fit than the selected four after mode and risk checks.' };
    });
};

const speciesNameSet = (entries: PokemonEntry[], data: IndexedData): Set<string> =>
  new Set(entries.map((pokemon) => previewKeyForScoring(pokemon.species, data)));

const hasSpecies = (entries: PokemonEntry[], data: IndexedData, species: string[]): boolean => {
  const keys = speciesNameSet(entries, data);
  return species.some((name) => keys.has(previewKeyForScoring(name, data)));
};

const hasAllSpecies = (entries: PokemonEntry[], data: IndexedData, species: string[]): boolean => {
  const keys = speciesNameSet(entries, data);
  return species.every((name) => keys.has(previewKeyForScoring(name, data)));
};

const averageSpeed = (entries: PokemonEntry[], data: IndexedData): number => {
  const speeds = entries.map((pokemon) => entrySpeed(pokemon, data)).filter((speed): speed is number => typeof speed === 'number');
  return speeds.length ? speeds.reduce((total, speed) => total + speed, 0) / speeds.length : 90;
};

const matchupModeResponse = (opponents: PokemonEntry[], players: PokemonEntry[], data: IndexedData): { score: number; reasons: string[] } => {
  const playerTags = players.flatMap((pokemon) => Array.from(entryTags(pokemon, data)));
  const opponentTags = opponents.flatMap((pokemon) => Array.from(entryTags(pokemon, data)));
  const playerNames = speciesNameSet(players, data);
  const reasons: string[] = [];
  let score = 0;

  const playerHasSun =
    playerTags.includes('weather') &&
    (playerNames.has(previewKeyForScoring('Charizard', data)) || playerNames.has(previewKeyForScoring('Torkoal', data)) || playerNames.has(previewKeyForScoring('Venusaur', data)));
  const playerHasTailwind = playerTags.includes('tailwind');
  const playerHasTrickRoom = playerTags.includes('trick-room');
  const playerHasIntimidate = playerTags.includes('intimidate');
  const opponentHasSpeedControl = opponentTags.includes('speed-control') || opponentTags.includes('tailwind') || opponentTags.includes('trick-room');

  if (playerHasSun && (hasAllSpecies(opponents, data, ['Tyranitar', 'Excadrill']) || hasSpecies(opponents, data, ['Primarina', 'Milotic', 'Pelipper']))) {
    score += 2.1;
    reasons.push('answers your sun mode');
  }
  if (playerHasTailwind && opponentHasSpeedControl) {
    score += 1.25;
    reasons.push('contests your speed mode');
  }
  if (playerHasTrickRoom && (opponentTags.includes('trick-room') || opponentTags.includes('fake-out'))) {
    score += 1.1;
    reasons.push('respects your Trick Room');
  }
  if (playerHasIntimidate && opponents.some((pokemon) => entryTags(pokemon, data).has('special-attacker') || pokemon.ability?.toLowerCase().includes('competitive'))) {
    score += 0.7;
    reasons.push('punishes Intimidate lines');
  }
  if (hasAllSpecies(opponents, data, ['Tyranitar', 'Excadrill'])) {
    score += 1.3;
    reasons.push('keeps sand core intact');
  } else if (hasSpecies(opponents, data, ['Tyranitar', 'Excadrill'])) {
    score -= 1.15;
  }

  return { score, reasons };
};

const matchupAdjustedOpponentInference = (
  inference: OpponentInference,
  team: PokemonEntry[],
  opponents: PokemonEntry[],
  data: IndexedData
): OpponentInference => {
  const playerTeam = filledEntries(team);
  const visibleOpponents = filledEntries(opponents).map((opponent) => opponentEntryForScoring(opponent, inference, data));
  const reads = inference.likelyBringFours.filter((read) => read.members.length >= Math.min(4, visibleOpponents.length));
  if (playerTeam.length === 0 || visibleOpponents.length === 0 || reads.length === 0) return inference;

  const playerFastAverage = averageSpeed([...playerTeam].sort((first, second) => (entrySpeed(second, data) ?? 0) - (entrySpeed(first, data) ?? 0)).slice(0, 2), data);
  const weightedReads = reads.map((read) => {
    const readOpponents = opponentEntriesForRead(visibleOpponents, read, data);
    const pressureIntoPlayer = playerTeam.reduce((total, player) => {
      const best = Math.max(...readOpponents.map((opponent) => bestDamagePressure(opponent, player, data).score));
      return total + damagePressureScore(best);
    }, 0);
    const exposedToPlayer = readOpponents.reduce((total, opponent) => {
      const best = Math.max(...playerTeam.map((player) => bestDamagePressure(player, opponent, data).score));
      return total + damagePressureScore(best);
    }, 0);
    const threatenedPlayerCount = playerTeam.filter((player) => Math.max(...readOpponents.map((opponent) => bestDamagePressure(opponent, player, data).score)) >= 1.15).length;
    const modeResponse = matchupModeResponse(readOpponents, playerTeam, data);
    const opponentFastAverage = averageSpeed([...readOpponents].sort((first, second) => (entrySpeed(second, data) ?? 0) - (entrySpeed(first, data) ?? 0)).slice(0, 2), data);
    const hasSpeedControl = readOpponents.some((opponent) => {
      const tags = entryTags(opponent, data);
      return tags.has('speed-control') || tags.has('tailwind') || tags.has('trick-room');
    });
    const speedResponse =
      opponentFastAverage > playerFastAverage + 8 ? 0.8 : hasSpeedControl ? 0.75 : opponentFastAverage < playerFastAverage - 18 ? -0.55 : 0;
    const priorScore = Math.log(clamp(read.probability, 0.002, 1)) * 1.15;
    const matchupScore =
      priorScore +
      pressureIntoPlayer * 0.68 -
      exposedToPlayer * 0.32 +
      threatenedPlayerCount * 0.36 +
      modeResponse.score +
      speedResponse +
      read.confidence * 0.55;
    const weight = Math.exp(matchupScore / 2.45);
    const reasons = uniqueStrings([
      ...modeResponse.reasons,
      ...(threatenedPlayerCount >= 4 ? ['strong into your six'] : []),
      ...(speedResponse > 0.5 ? ['speed matchup'] : []),
      ...read.reasons
    ]).slice(0, 4);

    return { read, weight, reasons, matchupScore };
  });

  const totalWeight = weightedReads.reduce((total, read) => total + read.weight, 0) || 1;
  const likelyBringFours = weightedReads
    .map(({ read, weight, reasons, matchupScore }) => ({
      ...read,
      probability: weight / totalWeight,
      score: Math.round((weight / totalWeight) * 1000) / 10,
      confidence: clamp(read.confidence + clamp((matchupScore + 6) / 28, 0, 0.22), 0.25, 0.9),
      reasons
    }))
    .sort((first, second) => second.probability - first.probability);

  return {
    ...inference,
    likelyBringFours
  };
};

export const recommendPlans = (
  team: PokemonEntry[],
  opponents: PokemonEntry[],
  data: IndexedData = indexedData
): Recommendation[] => {
  const inference = inferOpponentPreview(opponents, data);
  return enumerateBattlePlans(team)
    .map((plan) => scoreBattlePlan(plan, opponents, data, inference))
    .sort((a, b) => b.score - a.score)
    .map((recommendation, index, all) => ({
      ...recommendation,
      confidence: clamp(recommendation.confidence - index * 0.002 + (recommendation.score - (all.at(-1)?.score ?? 0)) / 1000, 0.25, 0.94)
    }));
};

export const recommendBringFours = (
  team: PokemonEntry[],
  opponents: PokemonEntry[],
  data: IndexedData = indexedData
): BringRecommendation[] => {
  const inference = matchupAdjustedOpponentInference(inferOpponentPreview(opponents, data), team, opponents, data);
  const available = filledEntries(team);
  return enumerateBringFours(team)
    .map((plan) => scoreBringFour(plan, opponents, data, inference))
    .sort((a, b) => b.score - a.score)
    .map((recommendation, index, all) => ({
      ...recommendation,
      benchNotes: benchNotesFor(recommendation, available, opponents, data, inference),
      confidence: clamp(recommendation.confidence - index * 0.002 + (recommendation.score - (all.at(-1)?.score ?? 0)) / 1000, 0.25, 0.94)
    }));
};
