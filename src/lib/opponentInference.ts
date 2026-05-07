import { combinations, filledEntries } from './candidates';
import { baseSpeciesForMega, findPair, findSpecies, indexedData, isMegaSpecies, normalizeKey } from './data';
import type {
  IndexedData,
  LikelyLeadPair,
  OpponentBringFour,
  OpponentFormGuess,
  OpponentInference,
  OpponentSetGuess,
  PokemonEntry,
  PublicTeamSet,
  PublicTeam,
  SimilarPublicTeam
} from './types';

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const visibleSpeciesNames = (opponents: PokemonEntry[], data: IndexedData): string[] =>
  filledEntries(opponents)
    .map((pokemon) => findSpecies(pokemon.species, data)?.displayName ?? pokemon.species)
    .filter(Boolean);

const uniqueStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalizeKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const previewKeyFor = (species: string, data: IndexedData): string => {
  const meta = findSpecies(species, data);
  const displayName = meta?.displayName ?? species;
  return normalizeKey(isMegaSpecies(displayName) ? baseSpeciesForMega(displayName, data) : displayName);
};

const derivePreviewArchetypes = (speciesNames: string[]): string[] => {
  const text = normalizeKey(speciesNames.join(' '));
  const archetypes: string[] = [];

  if (/(pelipper|politoed|archaludon|basculegion)/.test(text)) archetypes.push('Rain');
  if (/(charizard|ninetales|venusaur|torkoal|typhlosion)/.test(text)) archetypes.push('Sun');
  if (/(tyranitar|excadrill|hippowdon)/.test(text)) archetypes.push('Sand');
  if (/(ninetalesalolanform|froslass|abomasnow)/.test(text)) archetypes.push('Snow');
  if (/(whimsicott|talonflame|aerodactyl|pelipper|charizard)/.test(text)) archetypes.push('Tailwind');
  if (/(farigiraf|sinistcha|hatterene|aromatisse|slowbro|slowking|oranguru)/.test(text)) archetypes.push('Trick Room');

  return uniqueStrings(archetypes);
};

const sourceWeight = (team: PublicTeam): number => {
  if (team.source === 'tournament') return 1.2 + clamp((6 - (team.rank ?? 6)) / 10, 0, 0.5);
  return 0.7 + clamp((12 - (team.rank ?? 12)) / 20, 0, 0.35);
};

const scoreSimilarTeam = (team: PublicTeam, previewNames: string[], data: IndexedData): SimilarPublicTeam | null => {
  const previewKeys = new Set(previewNames.map((name) => previewKeyFor(name, data)));
  const overlap = team.members.filter((member) => previewKeys.has(previewKeyFor(member, data)));
  if (overlap.length === 0) return null;

  const unionSize = new Set([...team.members.map((member) => previewKeyFor(member, data)), ...previewKeys]).size;
  const jaccard = overlap.length / Math.max(unionSize, 1);
  const strictEnough = previewNames.length <= 2 ? overlap.length >= 1 : overlap.length >= 2;
  if (!strictEnough) return null;

  const score = overlap.length * 2.2 + jaccard * 4 + sourceWeight(team);
  return { ...team, overlap, score };
};

const setTagsFrom = (moves: string[], abilities: string[], items: string[]): string[] => {
  const moveKeys = moves.map(normalizeKey);
  const abilityKeys = abilities.map(normalizeKey);
  const itemKeys = items.map(normalizeKey);
  const tags: string[] = [];

  if (moveKeys.includes('fakeout')) tags.push('fake-out', 'support');
  if (moveKeys.includes('tailwind')) tags.push('tailwind', 'speed-control', 'support');
  if (moveKeys.includes('trickroom')) tags.push('trick-room', 'speed-control', 'support');
  if (moveKeys.includes('wideguard')) tags.push('wide-guard', 'support');
  if (moveKeys.some((move) => ['followme', 'ragepowder'].includes(move))) tags.push('redirection', 'support');
  if (moveKeys.some((move) => ['icywind', 'electroweb', 'scaryface', 'rocktomb'].includes(move))) tags.push('speed-control');
  if (moveKeys.some((move) => ['mortalspin', 'toxicspikes', 'stealthrock', 'spikes'].includes(move))) tags.push('hazard');
  if (moveKeys.some((move) => ['rockslide', 'heatwave', 'muddywater', 'hypervoice', 'dazzlinggleam', 'eruption'].includes(move))) tags.push('spread');
  if (moveKeys.some((move) => ['suckerpunch', 'bulletpunch', 'iceshard', 'aquajet', 'extremespeed', 'shadowsneak'].includes(move))) tags.push('priority');
  if (moveKeys.some((move) => ['partingshot', 'uturn', 'voltswitch', 'flipturn'].includes(move))) tags.push('pivot');
  if (moveKeys.some((move) => ['lastrespects', 'supremeoverlord'].includes(move))) tags.push('late-game');
  if (abilityKeys.includes('intimidate')) tags.push('intimidate', 'pivot', 'support');
  if (abilityKeys.includes('prankster')) tags.push('support', 'speed-control');
  if (abilityKeys.includes('toxicdebris')) tags.push('hazard');
  if (abilityKeys.includes('drought') || abilityKeys.includes('drizzle') || abilityKeys.includes('sandstream') || abilityKeys.includes('snowwarning')) tags.push('weather');
  if (itemKeys.some((item) => ['focussash', 'mentalherb', 'whiteherb'].includes(item))) tags.push('lead-pressure');

  return uniqueStrings(tags);
};

const matchingPublicSets = (previewName: string, similarTeams: SimilarPublicTeam[], data: IndexedData): PublicTeamSet[] =>
  similarTeams
    .flatMap((team) => team.teamSheet ?? [])
    .filter((set) => previewKeyFor(set.species, data) === previewKeyFor(previewName, data));

const setGuessesFor = (previewNames: string[], similarTeams: SimilarPublicTeam[], data: IndexedData): OpponentSetGuess[] =>
  previewNames
    .map((species) => {
      const meta = findSpecies(species, data);
      if (!meta) return undefined;
      const matchedSets = matchingPublicSets(species, similarTeams, data);
      const sheetMoves = matchedSets.flatMap((set) => set.moves);
      const sheetItems = matchedSets.map((set) => set.item).filter((item): item is string => Boolean(item));
      const sheetAbilities = matchedSets.map((set) => set.ability).filter((ability): ability is string => Boolean(ability));
      return {
        species: meta.displayName,
        moves: uniqueStrings([...sheetMoves, ...meta.commonMoves]).slice(0, 5),
        items: uniqueStrings([...sheetItems, ...(meta.commonItems ?? [])]).slice(0, 4),
        abilities: uniqueStrings([...sheetAbilities, ...meta.abilities]).slice(0, 3),
        tags: uniqueStrings([...setTagsFrom(sheetMoves, sheetAbilities, sheetItems), ...meta.roleTags]).slice(0, 5)
      };
    })
    .filter((guess): guess is OpponentSetGuess => Boolean(guess));

const isLikelyMegaStoneFor = (item: string, previewSpecies: string, megaSpecies: string, data: IndexedData): boolean => {
  const itemKey = normalizeKey(item);
  const baseKey = previewKeyFor(previewSpecies, data);
  const megaKey = normalizeKey(megaSpecies.replace(/^Mega\s+/, ''));

  if (!/ite[xy]?$/.test(itemKey) || baseKey.length < 4) return false;
  if (megaSpecies === 'Mega Charizard X') return itemKey === 'charizarditex';
  if (megaSpecies === 'Mega Charizard Y') return itemKey === 'charizarditey';

  return itemKey.includes(baseKey.slice(0, Math.min(6, baseKey.length))) || itemKey.includes(megaKey.slice(0, Math.min(6, megaKey.length)));
};

const megaCandidatesFor = (previewSpecies: string, data: IndexedData): string[] =>
  data.species
    .filter((species) => isMegaSpecies(species.displayName) && previewKeyFor(species.displayName, data) === previewKeyFor(previewSpecies, data))
    .map((species) => species.displayName);

const inferOpponentForms = (previewNames: string[], similarTeams: SimilarPublicTeam[], data: IndexedData): OpponentFormGuess[] =>
  previewNames.map((previewSpecies) => {
    const meta = findSpecies(previewSpecies, data);
    const baseSpecies = meta?.displayName ?? previewSpecies;
    const megaCandidates = megaCandidatesFor(baseSpecies, data);
    if (megaCandidates.length === 0) {
      return { previewSpecies: baseSpecies, forms: [{ species: baseSpecies, probability: 1, evidence: ['no Mega form in data'] }] };
    }

    const weights = new Map<string, number>([[baseSpecies, 1]]);
    const evidence = new Map<string, string[]>([[baseSpecies, []]]);
    megaCandidates.forEach((candidate) => {
      const candidateMeta = findSpecies(candidate, data);
      weights.set(candidate, 0.35 + (candidateMeta?.usage ?? 0) * 2);
      evidence.set(candidate, []);
    });

    const addWeight = (species: string, amount: number, reason: string) => {
      weights.set(species, (weights.get(species) ?? 0) + amount);
      evidence.set(species, uniqueStrings([...(evidence.get(species) ?? []), reason]));
    };

    (meta?.commonItems ?? []).forEach((item, index, items) => {
      const itemWeight = (items.length - index) / Math.max(items.length, 1);
      const megaMatch = megaCandidates.find((candidate) => isLikelyMegaStoneFor(item, baseSpecies, candidate, data));
      if (megaMatch) addWeight(megaMatch, 2.2 * itemWeight, `species item ${item}`);
      else addWeight(baseSpecies, 1.35 * itemWeight, `species item ${item}`);
    });

    matchingPublicSets(baseSpecies, similarTeams, data).forEach((set) => {
      if (!set.item) return;
      const megaMatch = megaCandidates.find((candidate) => isLikelyMegaStoneFor(set.item ?? '', baseSpecies, candidate, data));
      if (megaMatch) addWeight(megaMatch, 2.8, `matched team item ${set.item}`);
      else addWeight(baseSpecies, 2, `matched team item ${set.item}`);
    });

    const total = Array.from(weights.values()).reduce((sum, value) => sum + value, 0) || 1;
    return {
      previewSpecies: baseSpecies,
      forms: Array.from(weights.entries())
        .map(([species, weight]) => ({
          species,
          probability: weight / total,
          evidence: evidence.get(species) ?? []
        }))
        .sort((first, second) => second.probability - first.probability)
    };
  });

const tagSetFor = (species: string, data: IndexedData): Set<string> =>
  new Set((findSpecies(species, data)?.roleTags ?? []).filter((tag) => tag !== 'hazard'));

const itemLeadScore = (species: string, data: IndexedData): number => {
  const itemKeys = (findSpecies(species, data)?.commonItems ?? []).map(normalizeKey);
  let score = 0;
  if (itemKeys.includes('focussash')) score += 0.65;
  if (itemKeys.includes('mentalherb')) score += 0.45;
  if (itemKeys.includes('whiteherb')) score += 0.35;
  if (itemKeys.includes('covertcloak')) score += 0.25;
  return score;
};

const smoothedRate = (observed = 0, sampleSize = 0, prior = 0.03, priorWeight = 250): number => {
  const sample = Math.max(sampleSize, 0);
  return clamp((clamp(observed, 0, 1) * sample + prior * priorWeight) / (sample + priorWeight), 0, 1);
};

const individualLeadScore = (species: string, data: IndexedData): number => {
  const meta = findSpecies(species, data);
  if (!meta) return 0;
  const tags = tagSetFor(species, data);
  let score = 0.25 + meta.usage * 1.2 + (meta.leadRate ?? 0) * 5 + itemLeadScore(species, data);

  if (tags.has('fake-out')) score += 0.9;
  if (tags.has('tailwind') || tags.has('trick-room')) score += 0.8;
  if (tags.has('speed-control')) score += 0.5;
  if (tags.has('weather')) score += 0.45;
  if (tags.has('intimidate')) score += 0.45;
  if (tags.has('redirection')) score += 0.35;
  if (tags.has('priority')) score += 0.25;
  if (meta.baseStats.speed >= 130) score += 0.35;
  if (meta.baseStats.speed <= 70 && tags.has('trick-room')) score += 0.35;

  return score;
};

const leadProbabilityPrior = (species: string, data: IndexedData): number => {
  const meta = findSpecies(species, data);
  if (!meta) return 0.04;

  const tags = tagSetFor(species, data);
  const usagePrior = smoothedRate(meta.usage, meta.sampleSize, 0.035, 650);
  const roleSignal = clamp((individualLeadScore(species, data) - 0.25 - meta.usage * 1.2) / 4.5, 0, 1);
  const speedSignal = meta.baseStats.speed >= 115 ? 0.08 : meta.baseStats.speed <= 70 && tags.has('trick-room') ? 0.07 : 0;
  const derivedPrior = 0.055 + usagePrior * 0.42 + roleSignal * 0.28 + speedSignal;
  const leadObserved = typeof meta.leadRate === 'number' ? smoothedRate(meta.leadRate, meta.sampleSize, 0.16, 350) : undefined;

  return clamp(leadObserved ?? derivedPrior, 0.035, 0.62);
};

const pairSynergyScore = (first: string, second: string, data: IndexedData): number => {
  const firstTags = tagSetFor(first, data);
  const secondTags = tagSetFor(second, data);
  const both = new Set([...firstTags, ...secondTags]);
  const pairText = normalizeKey(`${first} ${second}`);
  let score = 0;

  if ((firstTags.has('fake-out') && (secondTags.has('tailwind') || secondTags.has('trick-room'))) ||
      (secondTags.has('fake-out') && (firstTags.has('tailwind') || firstTags.has('trick-room')))) {
    score += 1.2;
  }
  if (both.has('tailwind') && (firstTags.has('physical-attacker') || secondTags.has('physical-attacker') || firstTags.has('special-attacker') || secondTags.has('special-attacker'))) {
    score += 0.7;
  }
  if (both.has('trick-room') && (firstTags.has('support') || secondTags.has('support'))) score += 0.6;
  if (both.has('weather') || /(pelipper|politoed|charizard|ninetales|tyranitar|torkoal).*(archaludon|basculegion|venusaur|excadrill)/.test(pairText)) {
    score += 0.8;
  }
  if (both.has('redirection') || both.has('intimidate')) score += 0.35;

  return score;
};

const similarTeamEvidenceFor = (first: string, second: string, similarTeams: SimilarPublicTeam[]): { score: number; count: number } => {
  const firstKey = normalizeKey(first);
  const secondKey = normalizeKey(second);

  return similarTeams.reduce(
    (evidence, team) => {
      const teamKeys = new Set(team.members.map(normalizeKey));
      if (!teamKeys.has(firstKey) || !teamKeys.has(secondKey)) return evidence;

      const firstTwo = team.members.slice(0, 2).map(normalizeKey);
      const orderBoost = firstTwo.includes(firstKey) && firstTwo.includes(secondKey) ? 1.1 : 0;
      return {
        score: evidence.score + team.score * 0.32 + orderBoost,
        count: evidence.count + 1
      };
    },
    { score: 0, count: 0 }
  );
};

const buildLikelyLeadPairs = (previewNames: string[], similarTeams: SimilarPublicTeam[], data: IndexedData): LikelyLeadPair[] => {
  const weightedCandidates: Array<Omit<LikelyLeadPair, 'probability' | 'score' | 'confidence'> & { weight: number }> = [];

  for (let firstIndex = 0; firstIndex < previewNames.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < previewNames.length; secondIndex += 1) {
      const first = previewNames[firstIndex];
      const second = previewNames[secondIndex];
      const pair = findPair(first, second, data);
      const similarEvidence = similarTeamEvidenceFor(first, second, similarTeams);
      const firstLeadPrior = leadProbabilityPrior(first, data);
      const secondLeadPrior = leadProbabilityPrior(second, data);
      const pairPrior = pair ? smoothedRate(pair.frequency, pair.sampleSize, 0.025, 300) : 0.025;
      const teamPrior = clamp(similarEvidence.score / 10, 0, 1.4);
      const synergy = pairSynergyScore(first, second, data);
      const logWeight =
        Math.log(firstLeadPrior) +
        Math.log(secondLeadPrior) +
        Math.log1p(pairPrior * 8) +
        Math.log1p(teamPrior * 1.7) +
        synergy * 0.22;
      const weight = Math.exp(logWeight);
      const reasons: string[] = [];

      if (pair && (pair.sampleSize ?? 0) >= 120) reasons.push('public core');
      if (similarEvidence.count > 0) reasons.push('similar teams');
      if (synergy > 0.8) reasons.push('lead synergy');
      if (itemLeadScore(first, data) + itemLeadScore(second, data) > 0.6) reasons.push('lead items');
      if (firstLeadPrior + secondLeadPrior > 0.5) reasons.push('usage prior');

      weightedCandidates.push({
        members: [first, second],
        weight,
        reasons: reasons.length ? reasons : ['stat prior'],
        evidence: {
          publicPairFrequency: pair?.frequency,
          publicPairSamples: pair?.sampleSize,
          similarTeams: similarEvidence.count,
          leadPrior: (firstLeadPrior + secondLeadPrior) / 2,
          pairPrior,
          teamPrior
        }
      });
    }
  }

  const totalWeight = weightedCandidates.reduce((total, pair) => total + pair.weight, 0) || 1;
  return weightedCandidates
    .map((pair) => {
      const probability = pair.weight / totalWeight;
      const evidenceConfidence =
        probability * 0.75 +
        clamp((pair.evidence.publicPairSamples ?? 0) / 3500, 0, 0.24) +
        clamp(pair.evidence.similarTeams / 5, 0, 0.2) +
        clamp(pair.evidence.pairPrior * 0.7, 0, 0.16);

      return {
        members: pair.members,
        score: Math.round(probability * 1000) / 10,
        probability,
        confidence: clamp(0.26 + evidenceConfidence, 0.26, 0.9),
        reasons: pair.reasons,
        evidence: pair.evidence
      };
    })
    .sort((first, second) => second.probability - first.probability);
};

const groupHasAny = (members: string[], options: string[]): boolean => {
  const memberKeys = new Set(members.map(normalizeKey));
  return options.some((option) => memberKeys.has(normalizeKey(option)));
};

const modeCoreScore = (members: string[], archetypes: string[], data: IndexedData): { score: number; modes: string[] } => {
  let score = 0;
  const modes: string[] = [];

  archetypes.forEach((archetype) => {
    const key = normalizeKey(archetype);
    if (
      key === 'rain' &&
      groupHasAny(members, ['Pelipper', 'Politoed']) &&
      groupHasAny(members, ['Archaludon', 'Basculegion (Male)', 'Basculegion (Female)', 'Dragonite'])
    ) {
      score += 1.3;
      modes.push('rain core');
    }
    if (
      key === 'sun' &&
      groupHasAny(members, ['Charizard', 'Torkoal', 'Ninetales']) &&
      groupHasAny(members, ['Venusaur', 'Meganium', 'Typhlosion', 'Hatterene'])
    ) {
      score += 1.2;
      modes.push('sun core');
    }
    if (key === 'sand' && groupHasAny(members, ['Tyranitar']) && groupHasAny(members, ['Excadrill'])) {
      score += 1.35;
      modes.push('sand core');
    }
    if (key === 'tailwind' && members.some((member) => tagSetFor(member, data).has('tailwind'))) {
      score += 0.8;
      modes.push('Tailwind');
    }
    if (key === 'trickroom' && members.some((member) => tagSetFor(member, data).has('trick-room'))) {
      score += 0.8;
      modes.push('Trick Room');
    }
  });

  return { score, modes: uniqueStrings(modes) };
};

const similarFourEvidenceFor = (members: string[], similarTeams: SimilarPublicTeam[], data: IndexedData): { score: number; count: number } => {
  const memberKeys = new Set(members.map((member) => previewKeyFor(member, data)));

  return similarTeams.reduce(
    (evidence, team) => {
      const teamKeys = new Set(team.members.map((member) => previewKeyFor(member, data)));
      const overlap = Array.from(memberKeys).filter((member) => teamKeys.has(member)).length;
      if (overlap < Math.min(3, members.length)) return evidence;

      const fullMatchBoost = overlap === members.length ? 2.2 : 0;
      return {
        score: evidence.score + team.score * (overlap / Math.max(members.length, 1)) + fullMatchBoost,
        count: evidence.count + 1
      };
    },
    { score: 0, count: 0 }
  );
};

const buildLikelyBringFours = (
  previewNames: string[],
  similarTeams: SimilarPublicTeam[],
  likelyLeadPairs: LikelyLeadPair[],
  archetypes: string[],
  data: IndexedData
): OpponentBringFour[] => {
  if (previewNames.length === 0) return [];

  const groups = previewNames.length <= 4 ? [previewNames] : combinations(previewNames, 4);
  const weightedGroups = groups.map((members) => {
    const publicEvidence = similarFourEvidenceFor(members, similarTeams, data);
    const modeEvidence = modeCoreScore(members, archetypes, data);
    const leadEvidence = likelyLeadPairs
      .filter((pair) => pair.members.every((member) => members.some((candidate) => previewKeyFor(candidate, data) === previewKeyFor(member, data))))
      .reduce((total, pair) => total + pair.probability * clamp(pair.confidence + 0.25, 0.45, 1), 0);
    const usagePrior = members.reduce((total, member) => total + (findSpecies(member, data)?.usage ?? 0.03), 0);
    const roleSpread = new Set(members.flatMap((member) => Array.from(tagSetFor(member, data)))).size;
    const rawScore =
      publicEvidence.score * 0.58 +
      leadEvidence * 6.5 +
      modeEvidence.score * 1.35 +
      usagePrior * 1.6 +
      clamp(roleSpread / 10, 0, 1.3);
    const weight = Math.exp(rawScore / 2.4);
    const reasons: string[] = [];

    if (publicEvidence.count > 0) reasons.push('similar public teams');
    if (leadEvidence >= 0.08) reasons.push('likely lead pair included');
    if (modeEvidence.modes.length) reasons.push(...modeEvidence.modes);
    if (usagePrior >= 0.22) reasons.push('usage prior');

    return {
      members,
      weight,
      publicEvidence,
      leadEvidence,
      reasons: reasons.length ? uniqueStrings(reasons).slice(0, 4) : ['preview balance']
    };
  });

  const totalWeight = weightedGroups.reduce((total, group) => total + group.weight, 0) || 1;

  return weightedGroups
    .map((group) => {
      const probability = group.weight / totalWeight;

      return {
        members: group.members,
        score: Math.round(probability * 1000) / 10,
        probability,
        confidence: clamp(
          0.25 + probability * 0.5 + clamp(group.publicEvidence.score / 14, 0, 0.2) + clamp(group.leadEvidence * 0.45, 0, 0.18),
          0.25,
          0.88
        ),
        reasons: group.reasons
      };
    })
    .sort((first, second) => second.probability - first.probability);
};

export const inferOpponentPreview = (opponents: PokemonEntry[], data: IndexedData = indexedData): OpponentInference => {
  const previewNames = uniqueStrings(visibleSpeciesNames(opponents, data));
  if (previewNames.length === 0) {
    return { setGuesses: [], formGuesses: [], similarTeams: [], likelyLeadPairs: [], likelyBringFours: [], archetypes: [], confidence: 0 };
  }

  const similarTeams = (data.publicTeams ?? [])
    .map((team) => scoreSimilarTeam(team, previewNames, data))
    .filter((team): team is SimilarPublicTeam => Boolean(team))
    .sort((first, second) => second.score - first.score)
    .slice(0, 6);

  const archetypeScores = new Map<string, number>();
  derivePreviewArchetypes(previewNames).forEach((archetype) => archetypeScores.set(archetype, (archetypeScores.get(archetype) ?? 0) + 2.5));
  similarTeams.forEach((team) => {
    team.archetypes.forEach((archetype) => {
      archetypeScores.set(archetype, (archetypeScores.get(archetype) ?? 0) + team.score / 3);
    });
  });

  const archetypes = Array.from(archetypeScores.entries())
    .sort((first, second) => second[1] - first[1])
    .map(([archetype]) => archetype)
    .slice(0, 5);
  const likelyLeadPairs = buildLikelyLeadPairs(previewNames, similarTeams, data);
  const likelyBringFours = buildLikelyBringFours(previewNames, similarTeams, likelyLeadPairs, archetypes, data);
  const setGuesses = setGuessesFor(previewNames, similarTeams, data);
  const formGuesses = inferOpponentForms(previewNames, similarTeams, data);
  const publicSetCoverage = setGuesses.filter((guess) => guess.moves.length || guess.items.length).length / previewNames.length;
  const matchCoverage = similarTeams[0] ? similarTeams[0].overlap.length / previewNames.length : 0;
  const leadProbabilityConcentration = likelyLeadPairs[0]?.probability ?? 0;
  const leadEvidence = likelyLeadPairs[0]?.confidence ?? 0;
  const bringEvidence = likelyBringFours[0]?.confidence ?? 0;

  return {
    setGuesses,
    formGuesses,
    similarTeams,
    likelyLeadPairs,
    likelyBringFours,
    archetypes,
    confidence: clamp(
      0.22 + publicSetCoverage * 0.18 + matchCoverage * 0.2 + leadProbabilityConcentration * 0.18 + leadEvidence * 0.12 + bringEvidence * 0.12,
      0.24,
      0.86
    )
  };
};
