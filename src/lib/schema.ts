import { z } from 'zod';
import { POKEMON_TYPES } from './types';

const PokemonTypeSchema = z.enum(POKEMON_TYPES);

export const PokemonEntrySchema = z.object({
  id: z.string(),
  species: z.string(),
  form: z.string().optional(),
  types: z.array(PokemonTypeSchema).max(2),
  item: z.string().optional(),
  ability: z.string().optional(),
  moves: z.array(z.string()).max(4),
  teraType: z.union([PokemonTypeSchema, z.literal('')]).optional(),
  speedStat: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().optional()
});

export const MoveDataSchema = z.object({
  name: z.string(),
  type: PokemonTypeSchema,
  category: z.enum(['Physical', 'Special', 'Status']),
  power: z.number().optional(),
  tags: z.array(z.string())
});

export const MetaSpeciesSchema = z.object({
  species: z.string(),
  displayName: z.string(),
  types: z.array(PokemonTypeSchema).min(1).max(2),
  baseStats: z.object({
    hp: z.number(),
    attack: z.number(),
    defense: z.number(),
    specialAttack: z.number(),
    specialDefense: z.number(),
    speed: z.number()
  }),
  abilities: z.array(z.string()),
  sprite: z.string().optional(),
  usage: z.number().min(0).max(1),
  winRate: z.number().min(0).max(1).optional(),
  sampleSize: z.number().nonnegative().optional(),
  leadRate: z.number().min(0).max(1).optional(),
  commonMoves: z.array(z.string()),
  roleTags: z.array(z.string())
});

export const MetaPairSchema = z.object({
  members: z.tuple([z.string(), z.string()]),
  frequency: z.number().min(0).max(1),
  winRate: z.number().min(0).max(1).optional(),
  sampleSize: z.number().nonnegative().optional()
});

export const MetaDatasetSchema = z.object({
  format: z.string(),
  updatedAt: z.string(),
  sourceNotes: z.array(z.string()),
  species: z.array(MetaSpeciesSchema),
  moves: z.array(MoveDataSchema),
  pairs: z.array(MetaPairSchema)
});

export const MetaSpeciesOverlaySchema = z.object({
  species: z.string(),
  displayName: z.string().optional(),
  usage: z.number().min(0).max(1).optional(),
  usageRank: z.number().nonnegative().optional(),
  winRate: z.number().min(0).max(1).optional(),
  sampleSize: z.number().nonnegative().optional(),
  leadRate: z.number().min(0).max(1).optional(),
  commonMoves: z.array(z.string()).optional(),
  abilities: z.array(z.string()).optional(),
  roleTags: z.array(z.string()).optional(),
  baseStats: z
    .object({
      hp: z.number(),
      attack: z.number(),
      defense: z.number(),
      specialAttack: z.number(),
      specialDefense: z.number(),
      speed: z.number()
    })
    .optional()
});

export const MetaPairOverlaySchema = z.object({
  members: z.tuple([z.string(), z.string()]),
  frequency: z.number().min(0).max(1),
  winRate: z.number().min(0).max(1).optional(),
  sampleSize: z.number().nonnegative().optional()
});

export const MetaOverlayDatasetSchema = z.object({
  format: z.string(),
  updatedAt: z.string(),
  sourceNotes: z.array(z.string()),
  teamCount: z.number().nonnegative().optional(),
  tournamentCount: z.number().nonnegative().optional(),
  species: z.array(MetaSpeciesOverlaySchema),
  pairs: z.array(MetaPairOverlaySchema)
});

export const SavedTeamSchema = z.object({
  version: z.literal(1),
  team: z.array(PokemonEntrySchema).length(6)
});
