import type { PokemonEntry } from './types';

export const samplePlayerTeam: PokemonEntry[] = [
  {
    id: 'team-1',
    species: 'Mega Charizard Y',
    types: ['Fire', 'Flying'],
    ability: 'Drought',
    speedStat: 167,
    moves: ['Heat Wave', 'Solar Beam', 'Tailwind', 'Protect'],
    notes: 'Sun setter and spread pressure.'
  },
  {
    id: 'team-2',
    species: 'Venusaur',
    types: ['Grass', 'Poison'],
    ability: 'Chlorophyll',
    speedStat: 132,
    moves: ['Sleep Powder', 'Giga Drain', 'Sludge Bomb', 'Protect'],
    notes: 'Fast sleep pressure in sun.'
  },
  {
    id: 'team-3',
    species: 'Incineroar',
    types: ['Fire', 'Dark'],
    ability: 'Intimidate',
    speedStat: 80,
    moves: ['Fake Out', 'Flare Blitz', 'Knock Off', 'Parting Shot'],
    notes: 'Pivot and physical damage control.'
  },
  {
    id: 'team-4',
    species: 'Whimsicott',
    types: ['Grass', 'Fairy'],
    ability: 'Prankster',
    speedStat: 184,
    moves: ['Tailwind', 'Encore', 'Moonblast', 'Protect'],
    notes: 'Speed control and disruption.'
  },
  {
    id: 'team-5',
    species: 'Garchomp',
    types: ['Dragon', 'Ground'],
    ability: 'Rough Skin',
    speedStat: 154,
    moves: ['Earthquake', 'Dragon Claw', 'Rock Slide', 'Protect'],
    notes: 'Physical spread damage.'
  },
  {
    id: 'team-6',
    species: 'Milotic',
    types: ['Water'],
    ability: 'Competitive',
    speedStat: 101,
    moves: ['Muddy Water', 'Icy Wind', 'Recover', 'Protect'],
    notes: 'Anti-Intimidate water control.'
  }
];

export const sampleOpponentTeam: PokemonEntry[] = [
  {
    id: 'opponent-1',
    species: 'Garchomp',
    types: ['Dragon', 'Ground'],
    moves: ['', '', '', ''],
    speedStat: null
  },
  {
    id: 'opponent-2',
    species: 'Tyranitar',
    types: ['Rock', 'Dark'],
    moves: ['', '', '', ''],
    speedStat: null
  },
  {
    id: 'opponent-3',
    species: 'Excadrill',
    types: ['Ground', 'Steel'],
    moves: ['', '', '', ''],
    speedStat: null
  },
  {
    id: 'opponent-4',
    species: 'Primarina',
    types: ['Water', 'Fairy'],
    moves: ['', '', '', ''],
    speedStat: null
  },
  {
    id: 'opponent-5',
    species: 'Aegislash',
    types: ['Steel', 'Ghost'],
    moves: ['', '', '', ''],
    speedStat: null
  },
  {
    id: 'opponent-6',
    species: 'Farigiraf',
    types: ['Normal', 'Psychic'],
    moves: ['', '', '', ''],
    speedStat: null
  }
];
