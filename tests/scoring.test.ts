import { describe, expect, it } from 'vitest';
import { recommendPlans, selectRecommendationHighlights } from '../src/lib/scoring';
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

  it('highlights distinct bring-4 groups before duplicate arrangements', () => {
    const recommendations = recommendPlans(samplePlayerTeam, sampleOpponentTeam);
    const highlights = selectRecommendationHighlights(recommendations, 8);
    const bringKeys = highlights.map((recommendation) =>
      recommendation.brought
        .map((pokemon) => pokemon.id)
        .sort()
        .join('|')
    );

    expect(highlights).toHaveLength(8);
    expect(highlights[0]).toBe(recommendations[0]);
    expect(new Set(bringKeys).size).toBe(highlights.length);
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

  it('changes the top bring-4 when the preview calls for different specialists', () => {
    const specialistTeam = [
      member('team-1', 'Fire Specialist', ['Fire'], ['Heat Wave']),
      member('team-2', 'Water Specialist', ['Water'], ['Muddy Water']),
      member('team-3', 'Grass Specialist', ['Grass'], ['Energy Ball']),
      member('team-4', 'Electric Specialist', ['Electric'], ['Thunderbolt']),
      member('team-5', 'Ground Specialist', ['Ground'], ['Earthquake']),
      member('team-6', 'Support Specialist', ['Normal'], ['Fake Out', 'Tailwind'])
    ];
    const firePreview = ['Charizard', 'Torkoal', 'Incineroar', 'Hisuian Arcanine', 'Delphox', 'Scovillain'].map((species) =>
      opponent(species, [])
    );
    const waterPreview = ['Primarina', 'Milotic', 'Pelipper', 'Basculegion (Male)', 'Blastoise', 'Gyarados'].map((species) =>
      opponent(species, [])
    );

    const fireTop = recommendPlans(specialistTeam, firePreview)[0].brought.map((pokemon) => pokemon.species);
    const waterTop = recommendPlans(specialistTeam, waterPreview)[0].brought.map((pokemon) => pokemon.species);

    expect(fireTop).toContain('Water Specialist');
    expect(fireTop).not.toContain('Grass Specialist');
    expect(waterTop).toContain('Grass Specialist');
    expect(waterTop).toContain('Electric Specialist');
    expect(fireTop.join('|')).not.toBe(waterTop.join('|'));
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

  it('does not reward Glimmora from hazard pressure', () => {
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
    const glimmoraPlans = recommendations.filter((recommendation) =>
      recommendation.brought.some((pokemon) => pokemon.species === 'Glimmora')
    );

    expect(glimmoraPlans.length).toBeGreaterThan(0);
    expect(glimmoraPlans.flatMap((recommendation) => recommendation.tags)).not.toContain('Hazard Pressure');
    expect(glimmoraPlans.flatMap((recommendation) => recommendation.reasons.map((reason) => reason.detail)).join(' ')).not.toMatch(/hazard/i);
  });

  it('does not force Mega Glimmora into the top plan against water-heavy previews', () => {
    const glimmoraTeam = [
      member('team-1', 'Mega Glimmora', [], ['Mortal Spin', 'Power Gem', 'Earth Power', 'Spiky Shield']),
      member('team-2', 'Weavile', [], ['Fake Out', 'Triple Axel', 'Knock Off', 'Beat Up']),
      member('team-3', 'Mega Charizard Y', [], ['Heat Wave', 'Solar Beam', 'Tailwind', 'Protect']),
      member('team-4', 'Incineroar', [], ['Fake Out', 'Parting Shot', 'Flare Blitz', 'Throat Chop']),
      member('team-5', 'Garchomp', [], ['Earthquake', 'Dragon Claw', 'Rock Slide', 'Protect']),
      member('team-6', 'Primarina', [], ['Hyper Voice', 'Moonblast', 'Icy Wind', 'Protect'])
    ];
    const waterPreview = ['Primarina', 'Milotic', 'Pelipper', 'Basculegion (Male)', 'Blastoise', 'Gyarados'].map((species) =>
      opponent(species, [])
    );

    const recommendations = recommendPlans(glimmoraTeam, waterPreview);

    expect(recommendations[0].brought.map((pokemon) => pokemon.species)).not.toContain('Mega Glimmora');
    expect(recommendations[0].warnings.some((warning) => warning.includes('weak to Water'))).toBe(true);
  });

  it('anchors Perish Trap plans around leading the trapper', () => {
    const perishTeam = [
      member('team-1', 'Mega Gengar', [], ['Perish Song', 'Shadow Ball', 'Sludge Bomb', 'Protect']),
      member('team-2', 'Politoed', [], ['Perish Song', 'Icy Wind', 'Muddy Water', 'Protect']),
      member('team-3', 'Incineroar', [], ['Fake Out', 'Parting Shot', 'Flare Blitz', 'Throat Chop']),
      member('team-4', 'Whimsicott', [], ['Encore', 'Tailwind', 'Moonblast', 'Protect']),
      member('team-5', 'Primarina', [], ['Hyper Voice', 'Moonblast', 'Icy Wind', 'Protect']),
      member('team-6', 'Garchomp', [], ['Earthquake', 'Dragon Claw', 'Rock Slide', 'Protect'])
    ];
    const opponentPreview = ['Sneasler', 'Garchomp', 'Kingambit', 'Incineroar', 'Aerodactyl', 'Charizard'].map((species) =>
      opponent(species, [])
    );

    const recommendations = recommendPlans(perishTeam, opponentPreview);
    const topLeads = recommendations.slice(0, 8).map((recommendation) => recommendation.leads.map((pokemon) => pokemon.species));

    expect(recommendations[0].leads.map((pokemon) => pokemon.species)).toContain('Mega Gengar');
    expect(topLeads.every((leadNames) => leadNames.includes('Mega Gengar'))).toBe(true);
    expect(recommendations[0].reasons.some((reason) => reason.label === 'Perish Trap lead')).toBe(true);
  });

  it('warns on passive leads and rewards counterplay into enemy Perish Trap', () => {
    const antiPerishTeam = [
      member('team-1', 'Primarina', [], ['Hyper Voice', 'Moonblast', 'Icy Wind', 'Protect']),
      member('team-2', 'Milotic', [], ['Muddy Water', 'Icy Wind', 'Recover', 'Protect']),
      member('team-3', 'Incineroar', [], ['Fake Out', 'Parting Shot', 'Flare Blitz', 'Throat Chop']),
      member('team-4', 'Whimsicott', [], ['Encore', 'Tailwind', 'Moonblast', 'Protect']),
      member('team-5', 'Garchomp', [], ['Earthquake', 'Dragon Claw', 'Rock Slide', 'Protect']),
      member('team-6', 'Aegislash', [], ['Shadow Sneak', 'Iron Head', 'Poltergeist', 'Protect'])
    ];
    const perishPreview = ['Gengar', 'Politoed', 'Whimsicott', 'Incineroar', 'Dragonite', 'Archaludon'].map((species) =>
      opponent(species, [])
    );

    const recommendations = recommendPlans(antiPerishTeam, perishPreview);
    const passiveLead = recommendations.find((recommendation) => {
      const leadIds = new Set(recommendation.leads.map((pokemon) => pokemon.id));
      return leadIds.has('team-1') && leadIds.has('team-2');
    });

    expect(recommendations[0].reasons.some((reason) => reason.label === 'Perish counterplay')).toBe(true);
    expect(recommendations[0].warnings.some((warning) => warning.includes('Enemy Perish Trap risk'))).toBe(false);
    expect(passiveLead?.warnings.some((warning) => warning.includes('Enemy Perish Trap risk'))).toBe(true);
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
