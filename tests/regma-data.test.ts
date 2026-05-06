import { describe, expect, it } from 'vitest';
import generatedData from '../src/data/regma.generated.json';
import metaOverlay from '../src/data/regma-meta.generated.json';
import { REGMA_LEGAL_POKEMON } from '../src/data/regma-roster';
import { findPair, findSpecies, metaDataset, moveOptions, opponentSpeciesOptions, speciesOptions } from '../src/lib/data';

describe('Regulation M-A generated data', () => {
  it('uses the regulation-scoped legal roster as the generated species list', () => {
    const generatedNames = generatedData.species.map((species) => species.displayName);

    expect(generatedNames).toHaveLength(REGMA_LEGAL_POKEMON.length);
    expect(generatedNames).toEqual([...REGMA_LEGAL_POKEMON]);
  });

  it('excludes the old unrestricted VGC seed entries', () => {
    const generatedNames = new Set(generatedData.species.map((species) => species.displayName));

    expect(generatedNames.has('Miraidon')).toBe(false);
    expect(generatedNames.has('Flutter Mane')).toBe(false);
    expect(generatedNames.has('Calyrex-Shadow')).toBe(false);
    expect(generatedNames.has('Urshifu-Rapid-Strike')).toBe(false);
    expect(generatedNames.has('Amoonguss')).toBe(false);
  });

  it('keeps core Reg M-A Mega and non-Mega options available', () => {
    const generatedNames = new Set(generatedData.species.map((species) => species.displayName));

    expect(generatedNames.has('Mega Charizard Y')).toBe(true);
    expect(generatedNames.has('Mega Garchomp')).toBe(true);
    expect(generatedNames.has('Incineroar')).toBe(true);
    expect(generatedNames.has('Archaludon')).toBe(true);
  });

  it('builds a broad move autocomplete list beyond the scored move metadata', () => {
    expect(moveOptions.length).toBeGreaterThan(500);
    expect(moveOptions).toEqual(expect.arrayContaining(['Dragon Dance', 'Nasty Plot', 'Pollen Puff', 'Expanding Force']));
  });

  it('keeps Megas in player setup but removes them from opponent preview options', () => {
    expect(speciesOptions).toContain('Mega Charizard Y');
    expect(opponentSpeciesOptions).toContain('Charizard');
    expect(opponentSpeciesOptions.some((species) => species.startsWith('Mega '))).toBe(false);
  });

  it('merges public Regulation M-A meta and Champions stat overlays', () => {
    expect(metaOverlay.teamCount).toBeGreaterThan(1000);
    expect(metaDataset.sourceNotes.some((note) => note.includes('championsmeta.io'))).toBe(true);

    const sneasler = findSpecies('Sneasler');
    const glimmora = findSpecies('Glimmora');
    const sneaslerGarchomp = findPair('Sneasler', 'Garchomp');

    expect(sneasler?.usage).toBeGreaterThan(0.4);
    expect(sneasler?.commonMoves).toContain('Dire Claw');
    expect(sneasler?.commonItems).toContain('White Herb');
    expect(sneasler?.baseStats.speed).toBe(140);
    expect(glimmora?.baseStats.speed).toBe(106);
    expect(glimmora?.abilities).toContain('Toxic Debris');
    expect(sneaslerGarchomp?.frequency).toBeGreaterThan(0.1);
    expect(metaDataset.publicTeams?.length).toBeGreaterThan(20);
    expect(metaDataset.publicTeams?.every((team) => team.members.length === 6)).toBe(true);
    expect(metaDataset.publicTeams?.some((team) => (team.teamSheet?.length ?? 0) >= 6)).toBe(true);
  });
});
