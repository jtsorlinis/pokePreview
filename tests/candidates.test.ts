import { describe, expect, it } from 'vitest';
import { enumerateBattlePlans, enumerateBringFours } from '../src/lib/candidates';
import { samplePlayerTeam } from '../src/lib/sampleTeams';

describe('candidate generation', () => {
  it('creates 15 bring-4 groups and 90 lead/back plans from a full team of 6', () => {
    const plans = enumerateBattlePlans(samplePlayerTeam);
    const uniqueBringFours = new Set(plans.map((plan) => plan.brought.map((pokemon) => pokemon.id).sort().join('|')));

    expect(uniqueBringFours.size).toBe(15);
    expect(plans).toHaveLength(90);
    expect(plans.every((plan) => plan.leads.length === 2 && plan.backs.length === 2)).toBe(true);
  });

  it('does not recommend plans until at least four team members are filled', () => {
    expect(enumerateBattlePlans(samplePlayerTeam.slice(0, 3))).toHaveLength(0);
    expect(enumerateBringFours(samplePlayerTeam.slice(0, 3))).toHaveLength(0);
  });

  it('creates one lead-free candidate per bring-4 group', () => {
    const bringFours = enumerateBringFours(samplePlayerTeam);

    expect(bringFours).toHaveLength(15);
    expect(bringFours.every((plan) => plan.brought.length === 4 && plan.leads.length === 0 && plan.backs.length === 0)).toBe(true);
  });
});
