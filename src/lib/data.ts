import rawData from '../data/regma.generated.json';
import metaOverlayData from '../data/regma-meta.generated.json';
import moveOptionData from '../data/regma-move-options.generated.json';
import { MetaDatasetSchema, MetaOverlayDatasetSchema } from './schema';
import type { IndexedData, MetaDataset, MetaOverlayDataset, MetaPair, MetaSpecies, MoveData } from './types';

export const normalizeKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w]+/g, '');

const pairKey = (a: string, b: string): string => [normalizeKey(a), normalizeKey(b)].sort().join('|');

const uniqueByKey = <T>(items: T[], keyFor: (item: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizeKey(keyFor(item));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const overlayRoleTags = (species: MetaSpecies, overlayMoves: string[], overlayAbilities: string[], overlayItems: string[]): string[] => {
  const tags = new Set<string>();
  const moveKeys = overlayMoves.map(normalizeKey);
  const abilityKeys = overlayAbilities.map(normalizeKey);
  const itemKeys = overlayItems.map(normalizeKey);

  if (moveKeys.some((move) => move === 'fakeout')) tags.add('fake-out');
  if (moveKeys.some((move) => move === 'tailwind')) {
    tags.add('tailwind');
    tags.add('speed-control');
  }
  if (moveKeys.some((move) => move === 'trickroom')) tags.add('trick-room');
  if (moveKeys.some((move) => move === 'wideguard')) tags.add('wide-guard');
  if (moveKeys.some((move) => ['followme', 'ragepowder'].includes(move))) tags.add('redirection');
  if (moveKeys.some((move) => ['icywind', 'electroweb', 'scaryface'].includes(move))) tags.add('speed-control');
  if (moveKeys.some((move) => ['mortalspin', 'toxicspikes', 'stealthrock', 'spikes'].includes(move))) tags.add('hazard');
  if (moveKeys.some((move) => ['partingshot', 'uturn', 'voltswitch', 'flipturn'].includes(move))) tags.add('pivot');
  if (moveKeys.some((move) => ['lastrespects', 'supremeoverlord'].includes(move))) tags.add('late-game');
  if (abilityKeys.some((ability) => ability === 'intimidate')) {
    tags.add('intimidate');
    tags.add('pivot');
  }
  if (abilityKeys.some((ability) => ability === 'prankster')) {
    tags.add('support');
    tags.add('speed-control');
  }
  if (abilityKeys.some((ability) => ability === 'toxicdebris')) tags.add('hazard');
  if (itemKeys.some((item) => ['focussash', 'mentalherb', 'whiteherb'].includes(item))) tags.add('lead-pressure');
  if (overlayMoves.length >= 3 && species.baseStats.speed >= 110) tags.add('lead-pressure');

  return Array.from(tags);
};

const mergeMetaOverlay = (base: MetaDataset, overlay: MetaOverlayDataset): MetaDataset => {
  const overlayByKey = new Map<string, MetaOverlayDataset['species'][number]>();
  overlay.species.forEach((species) => {
    uniqueByKey([species.species, species.displayName ?? species.species], (name) => name).forEach((name) => {
      overlayByKey.set(normalizeKey(name), species);
    });
  });

  const species = base.species.map((speciesData) => {
    const overlaySpecies = overlayByKey.get(normalizeKey(speciesData.displayName)) ?? overlayByKey.get(normalizeKey(speciesData.species));
    if (!overlaySpecies) return speciesData;

    const overlayMoves = overlaySpecies.commonMoves ?? [];
    const overlayItems = overlaySpecies.commonItems ?? [];
    const overlayAbilities = overlaySpecies.abilities ?? [];
    const commonMoves = uniqueByKey([...overlayMoves, ...speciesData.commonMoves], (move) => move);
    const commonItems = uniqueByKey([...overlayItems, ...(speciesData.commonItems ?? [])], (item) => item);
    const abilities = uniqueByKey([...speciesData.abilities, ...overlayAbilities], (ability) => ability);
    const roleTags = uniqueByKey(
      [
        ...speciesData.roleTags,
        ...(overlaySpecies.roleTags ?? []),
        ...overlayRoleTags({ ...speciesData, baseStats: overlaySpecies.baseStats ?? speciesData.baseStats }, overlayMoves, overlayAbilities, overlayItems)
      ],
      (tag) => tag
    );

    return {
      ...speciesData,
      baseStats: overlaySpecies.baseStats ?? speciesData.baseStats,
      usage: overlaySpecies.usage ?? speciesData.usage,
      winRate: overlaySpecies.winRate ?? speciesData.winRate,
      sampleSize: overlaySpecies.sampleSize ?? speciesData.sampleSize,
      leadRate: overlaySpecies.leadRate ?? speciesData.leadRate,
      commonMoves,
      commonItems,
      abilities,
      roleTags
    };
  });

  const pairByKey = new Map(base.pairs.map((pair) => [pairKey(pair.members[0], pair.members[1]), pair]));
  overlay.pairs.forEach((pair) => {
    const key = pairKey(pair.members[0], pair.members[1]);
    const existing = pairByKey.get(key);
    pairByKey.set(key, {
      members: pair.members,
      frequency: Math.max(existing?.frequency ?? 0, pair.frequency),
      winRate: pair.winRate ?? existing?.winRate,
      sampleSize: Math.max(existing?.sampleSize ?? 0, pair.sampleSize ?? 0) || existing?.sampleSize || pair.sampleSize
    });
  });

  return {
    ...base,
    updatedAt: overlay.updatedAt > base.updatedAt ? overlay.updatedAt : base.updatedAt,
    sourceNotes: uniqueByKey([...base.sourceNotes, ...overlay.sourceNotes], (note) => note),
    species,
    pairs: Array.from(pairByKey.values()),
    publicTeams: overlay.publicTeams ?? base.publicTeams
  };
};

export const buildIndex = (dataset: MetaDataset): IndexedData => {
  const speciesByKey = new Map<string, MetaSpecies>();
  const movesByKey = new Map<string, MoveData>();
  const pairByKey = new Map<string, MetaPair>();

  dataset.species.forEach((species) => {
    speciesByKey.set(normalizeKey(species.species), species);
    speciesByKey.set(normalizeKey(species.displayName), species);
  });

  dataset.moves.forEach((move) => {
    movesByKey.set(normalizeKey(move.name), move);
  });

  dataset.pairs.forEach((pair) => {
    pairByKey.set(pairKey(pair.members[0], pair.members[1]), pair);
  });

  return { ...dataset, speciesByKey, movesByKey, pairByKey };
};

const baseDataset = MetaDatasetSchema.parse(rawData);
const metaOverlay = MetaOverlayDatasetSchema.parse(metaOverlayData);
export const metaDataset = MetaDatasetSchema.parse(mergeMetaOverlay(baseDataset, metaOverlay));
export const indexedData = buildIndex(metaDataset);

export const findSpecies = (species: string, data: IndexedData = indexedData): MetaSpecies | undefined =>
  data.speciesByKey.get(normalizeKey(species));

export const findMove = (move: string, data: IndexedData = indexedData): MoveData | undefined =>
  data.movesByKey.get(normalizeKey(move));

export const findPair = (first: string, second: string, data: IndexedData = indexedData): MetaPair | undefined =>
  data.pairByKey.get(pairKey(first, second));

export const isMegaSpecies = (species: string): boolean => species.trim().startsWith('Mega ');

export const baseSpeciesForMega = (species: string, data: IndexedData = indexedData): string => {
  if (species === 'Mega Charizard X' || species === 'Mega Charizard Y') return 'Charizard';
  if (species === 'Mega Meowstic') return findSpecies('Meowstic (Male)', data)?.displayName ?? 'Meowstic (Male)';

  return species.replace(/^Mega\s+/, '');
};

export const previewSpecies = (species: string, data: IndexedData = indexedData): MetaSpecies | undefined => {
  const meta = findSpecies(species, data);
  if (!meta) return undefined;
  if (!isMegaSpecies(meta.displayName)) return meta;

  return findSpecies(baseSpeciesForMega(meta.displayName, data), data) ?? meta;
};

export const speciesOptions = metaDataset.species.map((species) => species.displayName);
export const opponentSpeciesOptions = speciesOptions.filter((species) => !isMegaSpecies(species));
export const moveOptions = Array.from(
  new Map(
    [
      ...metaDataset.moves.map((move) => move.name),
      ...metaDataset.species.flatMap((species) => species.commonMoves),
      ...moveOptionData.moves
    ].map((move) => [normalizeKey(move), move])
  ).values()
).sort((first, second) => first.localeCompare(second));
export const abilityOptions = Array.from(new Set(metaDataset.species.flatMap((species) => species.abilities)))
  .filter(Boolean)
  .sort((first, second) => first.localeCompare(second));
