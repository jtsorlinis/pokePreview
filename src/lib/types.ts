export const POKEMON_TYPES = [
  'Normal',
  'Fire',
  'Water',
  'Electric',
  'Grass',
  'Ice',
  'Fighting',
  'Poison',
  'Ground',
  'Flying',
  'Psychic',
  'Bug',
  'Rock',
  'Ghost',
  'Dragon',
  'Dark',
  'Steel',
  'Fairy'
] as const;

export type PokemonType = (typeof POKEMON_TYPES)[number];

export type MoveCategory = 'Physical' | 'Special' | 'Status';

export interface MoveData {
  name: string;
  type: PokemonType;
  category: MoveCategory;
  power?: number;
  tags: string[];
}

export interface PokemonEntry {
  id: string;
  species: string;
  form?: string;
  types: PokemonType[];
  item?: string;
  ability?: string;
  moves: string[];
  teraType?: PokemonType | '';
  speedStat?: number | null;
  notes?: string;
}

export interface MetaSpecies {
  species: string;
  displayName: string;
  types: PokemonType[];
  baseStats: {
    hp: number;
    attack: number;
    defense: number;
    specialAttack: number;
    specialDefense: number;
    speed: number;
  };
  abilities: string[];
  sprite?: string;
  usage: number;
  winRate?: number;
  sampleSize?: number;
  leadRate?: number;
  commonMoves: string[];
  roleTags: string[];
}

export interface MetaPair {
  members: [string, string];
  frequency: number;
  winRate?: number;
  sampleSize?: number;
}

export interface MetaDataset {
  format: string;
  updatedAt: string;
  sourceNotes: string[];
  species: MetaSpecies[];
  moves: MoveData[];
  pairs: MetaPair[];
}

export interface MetaSpeciesOverlay {
  species: string;
  displayName?: string;
  usage?: number;
  usageRank?: number;
  winRate?: number;
  sampleSize?: number;
  leadRate?: number;
  commonMoves?: string[];
  abilities?: string[];
  roleTags?: string[];
  baseStats?: MetaSpecies['baseStats'];
}

export interface MetaPairOverlay {
  members: [string, string];
  frequency: number;
  winRate?: number;
  sampleSize?: number;
}

export interface MetaOverlayDataset {
  format: string;
  updatedAt: string;
  sourceNotes: string[];
  teamCount?: number;
  tournamentCount?: number;
  species: MetaSpeciesOverlay[];
  pairs: MetaPairOverlay[];
}

export interface IndexedData extends MetaDataset {
  speciesByKey: Map<string, MetaSpecies>;
  movesByKey: Map<string, MoveData>;
  pairByKey: Map<string, MetaPair>;
}

export interface BattlePlan {
  brought: PokemonEntry[];
  leads: PokemonEntry[];
  backs: PokemonEntry[];
}

export interface ScoreReason {
  label: string;
  detail: string;
  weight: number;
  tone: 'positive' | 'warning' | 'neutral';
}

export interface Recommendation extends BattlePlan {
  score: number;
  confidence: number;
  tags: string[];
  reasons: ScoreReason[];
  warnings: string[];
  breakdown: {
    offense: number;
    defense: number;
    speed: number;
    lead: number;
    roles: number;
    meta: number;
  };
}

export const BLANK_ENTRY = (id: string): PokemonEntry => ({
  id,
  species: '',
  types: [],
  moves: ['', '', '', ''],
  teraType: '',
  speedStat: null
});
