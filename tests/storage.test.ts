import { describe, expect, it } from 'vitest';
import { createMemoryStorage, exportTeamJson, importTeamJson, loadSavedTeam, saveTeam, STORAGE_KEY } from '../src/lib/storage';
import { samplePlayerTeam } from '../src/lib/sampleTeams';

describe('team storage', () => {
  it('saves and loads a team from local storage', () => {
    const storage = createMemoryStorage();
    saveTeam(samplePlayerTeam, storage);
    const loaded = loadSavedTeam(storage);

    expect(loaded.error).toBeUndefined();
    expect(loaded.team[0].species).toBe('Mega Charizard Y');
  });

  it('imports and exports valid team JSON', () => {
    const exported = exportTeamJson(samplePlayerTeam);
    const imported = importTeamJson(exported);

    expect(imported).toHaveLength(6);
    expect(imported[3].species).toBe('Whimsicott');
  });

  it('falls back to a blank team when saved JSON is invalid', () => {
    const storage = createMemoryStorage();
    storage.setItem(STORAGE_KEY, '{ bad json');
    const loaded = loadSavedTeam(storage);

    expect(loaded.error).toMatch(/invalid/i);
    expect(loaded.team).toHaveLength(6);
    expect(loaded.team[0].species).toBe('');
  });
});
