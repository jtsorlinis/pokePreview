import type { BattlePlan, PokemonEntry } from './types';

export const filledEntries = (team: PokemonEntry[]): PokemonEntry[] =>
  team.filter((pokemon) => pokemon.species.trim().length > 0);

export const combinations = <T,>(items: T[], size: number): T[][] => {
  if (size === 0) return [[]];
  if (items.length < size) return [];

  const [first, ...rest] = items;
  const withFirst = combinations(rest, size - 1).map((combo) => [first, ...combo]);
  const withoutFirst = combinations(rest, size);
  return [...withFirst, ...withoutFirst];
};

export const enumerateBattlePlans = (team: PokemonEntry[]): BattlePlan[] => {
  const available = filledEntries(team);
  if (available.length < 4) return [];

  const broughtGroups = combinations(available, 4);
  return broughtGroups.flatMap((brought) =>
    combinations(brought, 2).map((leads) => {
      const leadIds = new Set(leads.map((pokemon) => pokemon.id));
      return {
        brought,
        leads,
        backs: brought.filter((pokemon) => !leadIds.has(pokemon.id))
      };
    })
  );
};
