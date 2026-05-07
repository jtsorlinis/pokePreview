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
  inactiveMegaSpecies?: string;
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
  commonItems?: string[];
  roleTags: string[];
}

export interface MetaPair {
  members: [string, string];
  frequency: number;
  winRate?: number;
  sampleSize?: number;
}

export interface PublicTeam {
  id: string;
  title: string;
  source: 'community' | 'tournament';
  event?: string;
  rank?: number;
  record?: string;
  archetypes: string[];
  members: string[];
  teamSheet?: PublicTeamSet[];
}

export interface PublicTeamSet {
  species: string;
  item?: string;
  ability?: string;
  moves: string[];
}

export interface MetaDataset {
  format: string;
  updatedAt: string;
  sourceNotes: string[];
  species: MetaSpecies[];
  moves: MoveData[];
  pairs: MetaPair[];
  publicTeams?: PublicTeam[];
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
  commonItems?: string[];
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
  publicTeams?: PublicTeam[];
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
    robustness: number;
  };
}

export interface OpponentSetGuess {
  species: string;
  moves: string[];
  items: string[];
  abilities: string[];
  tags: string[];
}

export interface SimilarPublicTeam {
  id: string;
  title: string;
  source: PublicTeam['source'];
  event?: string;
  rank?: number;
  record?: string;
  archetypes: string[];
  members: string[];
  teamSheet?: PublicTeamSet[];
  overlap: string[];
  score: number;
}

export interface OpponentFormGuess {
  previewSpecies: string;
  forms: Array<{
    species: string;
    probability: number;
    evidence: string[];
  }>;
}

export interface LikelyLeadPair {
  members: [string, string];
  score: number;
  probability: number;
  confidence: number;
  reasons: string[];
  evidence: {
    publicPairFrequency?: number;
    publicPairSamples?: number;
    similarTeams: number;
    leadPrior: number;
    pairPrior: number;
    teamPrior: number;
  };
}

export interface OpponentInference {
  setGuesses: OpponentSetGuess[];
  formGuesses: OpponentFormGuess[];
  similarTeams: SimilarPublicTeam[];
  likelyLeadPairs: LikelyLeadPair[];
  archetypes: string[];
  confidence: number;
}

export const BLANK_ENTRY = (id: string): PokemonEntry => ({
  id,
  species: '',
  types: [],
  moves: ['', '', '', ''],
  teraType: '',
  speedStat: null
});
