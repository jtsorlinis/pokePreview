import { describe, expect, it } from 'vitest';
import { inferOpponentPreview } from '../src/lib/opponentInference';
import type { PokemonEntry } from '../src/lib/types';

const preview = (species: string): PokemonEntry => ({
  id: `opponent-${species}`,
  species,
  types: [],
  moves: ['', '', '', ''],
  speedStat: null
});

describe('opponent preview inference', () => {
  it('infers likely sets, archetypes, similar teams, and lead pairs from names only', () => {
    const opponents = ['Incineroar', 'Sneasler', 'Pelipper', 'Archaludon', 'Meganium', 'Basculegion (Male)'].map(preview);
    const intel = inferOpponentPreview(opponents);

    expect(intel.archetypes).toContain('Rain');
    expect(intel.setGuesses.find((guess) => guess.species === 'Sneasler')?.items).toContain('White Herb');
    expect(intel.similarTeams[0].overlap.length).toBeGreaterThanOrEqual(4);
    expect(intel.likelyLeadPairs.length).toBeGreaterThan(0);
    expect(intel.likelyLeadPairs.reduce((total, pair) => total + pair.probability, 0)).toBeCloseTo(1, 5);
    expect(intel.confidence).toBeGreaterThan(0.45);
  });

  it('uses public pair priors when predicting opposing leads', () => {
    const opponents = ['Sneasler', 'Garchomp', 'Kingambit', 'Incineroar', 'Aerodactyl', 'Charizard'].map(preview);
    const intel = inferOpponentPreview(opponents);
    const hasSneaslerGarchomp = intel.likelyLeadPairs.some((pair) => {
      const members = new Set(pair.members);
      return members.has('Sneasler') && members.has('Garchomp');
    });

    expect(hasSneaslerGarchomp).toBe(true);
    expect(intel.likelyLeadPairs[0].probability).toBeGreaterThan(0.1);
    expect(intel.likelyLeadPairs[0].evidence.publicPairSamples).toBeGreaterThan(0);
    expect(intel.likelyLeadPairs[0].confidence).toBeGreaterThan(0.4);
  });

  it('uses matched public team sheets and Mega item evidence for opponent form reads', () => {
    const opponents = ['Kingambit', 'Incineroar', 'Aerodactyl', 'Sneasler', 'Charizard', 'Floette'].map(preview);
    const intel = inferOpponentPreview(opponents);
    const charizardSet = intel.setGuesses.find((guess) => guess.species === 'Charizard');
    const charizardForms = intel.formGuesses.find((guess) => guess.previewSpecies === 'Charizard');

    expect(intel.similarTeams[0].teamSheet?.length).toBeGreaterThanOrEqual(6);
    expect(charizardSet?.moves.slice(0, 4)).toEqual(['Heat Wave', 'Weather Ball', 'Solar Beam', 'Protect']);
    expect(charizardForms?.forms[0].species).toBe('Mega Charizard Y');
    expect(charizardForms?.forms[0].probability).toBeGreaterThan(0.65);
  });

  it('recognizes enemy Perish Trap previews from Gengar plus Politoed evidence', () => {
    const opponents = ['Gengar', 'Politoed', 'Whimsicott', 'Incineroar', 'Dragonite', 'Archaludon'].map(preview);
    const intel = inferOpponentPreview(opponents);
    const gengarSet = intel.setGuesses.find((guess) => guess.species === 'Gengar');
    const gengarForms = intel.formGuesses.find((guess) => guess.previewSpecies === 'Gengar');

    expect(intel.archetypes).toContain('Perish Trap');
    expect(gengarSet?.moves).toContain('Perish Song');
    expect(gengarSet?.tags).toEqual(expect.arrayContaining(['perish', 'trap']));
    expect(gengarForms?.forms[0].species).toBe('Mega Gengar');
  });
});
