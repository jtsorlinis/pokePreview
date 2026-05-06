import { SavedTeamSchema } from './schema';
import { BLANK_ENTRY, type PokemonEntry } from './types';

export const STORAGE_KEY = 'pokemon-champions-advisor-team-v1';

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export const createMemoryStorage = (): StorageLike => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
};

const fallbackStorage = createMemoryStorage();

const defaultStorage = (): StorageLike => {
  if (
    typeof window !== 'undefined' &&
    window.localStorage &&
    typeof window.localStorage.getItem === 'function' &&
    typeof window.localStorage.setItem === 'function' &&
    typeof window.localStorage.removeItem === 'function'
  ) {
    return window.localStorage;
  }

  return fallbackStorage;
};

export const createBlankTeam = (): PokemonEntry[] =>
  Array.from({ length: 6 }, (_, index) => BLANK_ENTRY(`team-${index + 1}`));

export const createBlankOpponentTeam = (): PokemonEntry[] =>
  Array.from({ length: 6 }, (_, index) => BLANK_ENTRY(`opponent-${index + 1}`));

export interface LoadTeamResult {
  team: PokemonEntry[];
  error?: string;
}

export const loadSavedTeam = (storage: StorageLike = defaultStorage()): LoadTeamResult => {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return { team: createBlankTeam() };

  try {
    const parsed = SavedTeamSchema.parse(JSON.parse(raw));
    return { team: parsed.team };
  } catch {
    return {
      team: createBlankTeam(),
      error: 'Saved team data was invalid, so a blank team was loaded.'
    };
  }
};

export const saveTeam = (team: PokemonEntry[], storage: StorageLike = defaultStorage()): void => {
  const payload = SavedTeamSchema.parse({ version: 1, team });
  storage.setItem(STORAGE_KEY, JSON.stringify(payload));
};

export const clearSavedTeam = (storage: StorageLike = defaultStorage()): void => {
  storage.removeItem(STORAGE_KEY);
};

export const importTeamJson = (raw: string): PokemonEntry[] => {
  const parsed = SavedTeamSchema.parse(JSON.parse(raw));
  return parsed.team;
};

export const exportTeamJson = (team: PokemonEntry[]): string =>
  JSON.stringify(SavedTeamSchema.parse({ version: 1, team }), null, 2);
