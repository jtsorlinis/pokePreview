import { describe, expect, it } from 'vitest';
import { recommendPlans } from '../src/lib/scoring';
import { sampleOpponentTeam, samplePlayerTeam } from '../src/lib/sampleTeams';
import type { PokemonEntry } from '../src/lib/types';

const opponent = (species: string, types: PokemonEntry['types']): PokemonEntry => ({
  id: `opponent-${species}`,
  species,
  types,
  moves: ['', '', '', ''],
  teraType: '',
  speedStat: null
});

const member = (id: string, species: string, types: PokemonEntry['types'], moves: string[]): PokemonEntry => ({
  id,
  species,
  types,
  moves: [...moves, '', '', '', ''].slice(0, 4),
  teraType: '',
  speedStat: 100
});

describe('recommendation scoring', () => {
  it('returns all 90 ranked plans and includes explanations', () => {
    const recommendations = recommendPlans(samplePlayerTeam, sampleOpponentTeam);

    expect(recommendations).toHaveLength(90);
    expect(recommendations[0].score).toBeGreaterThanOrEqual(recommendations.at(-1)!.score);
    expect(recommendations[0].reasons.length).toBeGreaterThan(0);
  });

  it('prefers plans that bring clear offensive coverage', () => {
    const coverageTeam = [
      member('team-1', 'Water Specialist', ['Water'], ['Muddy Water']),
      member('team-2', 'Normal A', ['Normal'], ['Protect']),
      member('team-3', 'Normal B', ['Normal'], ['Protect']),
      member('team-4', 'Normal C', ['Normal'], ['Protect']),
      member('team-5', 'Normal D', ['Normal'], ['Protect']),
      member('team-6', 'Normal E', ['Normal'], ['Protect'])
    ];

    const recommendations = recommendPlans(coverageTeam, [opponent('Fire Target', ['Fire'])]);
    const topNames = recommendations[0].brought.map((pokemon) => pokemon.species);

    expect(topNames).toContain('Water Specialist');
  });

  it('keeps confidence lower when the opponent preview is incomplete', () => {
    const incomplete = recommendPlans(samplePlayerTeam, [opponent('Unknown Slot', [])]);
    const detailed = recommendPlans(samplePlayerTeam, sampleOpponentTeam);

    expect(incomplete[0].confidence).toBeLessThan(detailed[0].confidence);
  });

  it('scores bring-4 plans with at most one active Mega', () => {
    const dualMegaTeam = [
      member('team-1', 'Mega Charizard Y', ['Fire', 'Flying'], ['Heat Wave']),
      member('team-2', 'Mega Garchomp', ['Dragon', 'Ground'], ['Earthquake']),
      member('team-3', 'Incineroar', ['Fire', 'Dark'], ['Fake Out']),
      member('team-4', 'Whimsicott', ['Grass', 'Fairy'], ['Tailwind']),
      member('team-5', 'Milotic', ['Water'], ['Muddy Water']),
      member('team-6', 'Primarina', ['Water', 'Fairy'], ['Hyper Voice'])
    ];

    const recommendations = recommendPlans(dualMegaTeam, [opponent('Steel Target', ['Steel'])]);
    const dualMegaPlan = recommendations.find((recommendation) => {
      const broughtIds = new Set(recommendation.brought.map((pokemon) => pokemon.id));
      return broughtIds.has('team-1') && broughtIds.has('team-2');
    });

    expect(recommendations).toHaveLength(90);
    expect(dualMegaPlan).toBeDefined();
    expect(dualMegaPlan!.brought.filter((pokemon) => pokemon.species.startsWith('Mega '))).toHaveLength(1);
    expect(dualMegaPlan!.brought.some((pokemon) => pokemon.species === 'Charizard' || pokemon.species === 'Garchomp')).toBe(true);
    expect(dualMegaPlan!.warnings.some((warning) => warning.includes('Mega limit'))).toBe(true);
  });

  it('values inactive Mega regular forms by public non-Mega evidence', () => {
    const mixedMegaTeam = [
      member('team-1', 'Mega Charizard Y', [], ['Heat Wave', 'Solar Beam', 'Weather Ball', 'Protect']),
      member('team-2', 'Mega Glimmora', [], ['Mortal Spin', 'Power Gem', 'Earth Power', 'Spiky Shield']),
      member('team-3', 'Sneasler', [], ['Close Combat', 'Dire Claw', 'Fake Out', 'Protect']),
      member('team-4', 'Garchomp', [], ['Earthquake', 'Dragon Claw', 'Rock Slide', 'Protect']),
      member('team-5', 'Incineroar', [], ['Fake Out', 'Parting Shot', 'Flare Blitz', 'Throat Chop']),
      member('team-6', 'Primarina', [], ['Hyper Voice', 'Moonblast', 'Icy Wind', 'Protect'])
    ];
    const opponentPreview = ['Meganium', 'Aegislash', 'Kingambit', 'Sneasler', 'Aerodactyl', 'Milotic'].map((species) =>
      opponent(species, [])
    );

    const recommendations = recommendPlans(mixedMegaTeam, opponentPreview);
    const dualMegaPlan = recommendations.find((recommendation) => {
      const broughtIds = new Set(recommendation.brought.map((pokemon) => pokemon.id));
      return broughtIds.has('team-1') && broughtIds.has('team-2');
    });

    expect(dualMegaPlan).toBeDefined();
    expect(dualMegaPlan!.brought.map((pokemon) => pokemon.species)).toContain('Mega Charizard Y');
    expect(dualMegaPlan!.brought.map((pokemon) => pokemon.species)).toContain('Glimmora');
    expect(dualMegaPlan!.brought.map((pokemon) => pokemon.species)).not.toContain('Charizard');
    expect(dualMegaPlan!.warnings.some((warning) => warning.includes('Glimmora is scored as regular'))).toBe(true);
  });

  it('surfaces Weavile plus Glimmora as a strong tempo lead', () => {
    const tempoTeam = [
      { ...member('team-1', 'Weavile', ['Dark', 'Ice'], ['Fake Out', 'Triple Axel', 'Knock Off', 'Beat Up']), speedStat: 172 },
      {
        ...member('team-2', 'Glimmora', ['Rock', 'Poison'], ['Mortal Spin', 'Power Gem', 'Earth Power', 'Spiky Shield']),
        ability: 'Toxic Debris',
        speedStat: 106
      },
      member('team-3', 'Incineroar', ['Fire', 'Dark'], ['Fake Out']),
      member('team-4', 'Whimsicott', ['Grass', 'Fairy'], ['Tailwind']),
      member('team-5', 'Milotic', ['Water'], ['Muddy Water']),
      member('team-6', 'Primarina', ['Water', 'Fairy'], ['Hyper Voice'])
    ];

    const recommendations = recommendPlans(tempoTeam, sampleOpponentTeam);
    const tempoLead = recommendations.slice(0, 8).find((recommendation) => {
      const leadIds = new Set(recommendation.leads.map((pokemon) => pokemon.id));
      return leadIds.has('team-1') && leadIds.has('team-2');
    });

    expect(tempoLead).toBeDefined();
    expect(tempoLead!.reasons.some((reason) => reason.label === 'Lead pressure')).toBe(true);
  });

  it('demotes Basculegion leads when public data expects Kingambit pressure', () => {
    const basculegionTeam = [
      member('team-1', 'Basculegion (Male)', [], ['Last Respects', 'Aqua Jet', 'Wave Crash', 'Protect']),
      member('team-2', 'Incineroar', [], ['Fake Out', 'Parting Shot', 'Flare Blitz', 'Throat Chop']),
      member('team-3', 'Sneasler', [], ['Close Combat', 'Dire Claw', 'Fake Out', 'Protect']),
      member('team-4', 'Garchomp', [], ['Earthquake', 'Dragon Claw', 'Rock Slide', 'Protect']),
      member('team-5', 'Whimsicott', [], ['Tailwind', 'Moonblast', 'Encore', 'Protect']),
      member('team-6', 'Primarina', [], ['Hyper Voice', 'Moonblast', 'Icy Wind', 'Protect'])
    ];
    const kingambitPreview = ['Sneasler', 'Garchomp', 'Kingambit', 'Incineroar', 'Aerodactyl', 'Charizard'].map((species) =>
      opponent(species, [])
    );

    const recommendations = recommendPlans(basculegionTeam, kingambitPreview);
    const topLeadNames = recommendations.slice(0, 8).map((recommendation) => recommendation.leads.map((pokemon) => pokemon.species));
    const firstBasculegionLead = recommendations.find((recommendation) =>
      recommendation.leads.some((pokemon) => pokemon.species === 'Basculegion (Male)')
    );

    expect(topLeadNames.flat()).not.toContain('Basculegion (Male)');
    expect(firstBasculegionLead?.warnings.some((warning) => warning.includes('Basculegion (Male) into Kingambit'))).toBe(true);
  });
});
