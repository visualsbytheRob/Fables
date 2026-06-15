/**
 * Audio settings repo tests (F1638/F1632).
 */

import { describe, expect, it } from 'vitest';
import { openDb } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { DEFAULT_AUDIO_SETTINGS, audioSettingsRepo } from './settings.js';

function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

describe('audioSettingsRepo (F1638)', () => {
  it('returns defaults before anything is written', () => {
    const repo = audioSettingsRepo(freshDb());
    expect(repo.get()).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it('persists and clamps a mix update', () => {
    const repo = audioSettingsRepo(freshDb());
    const next = repo.update({ mix: { ambient: 2 } });
    expect(next.mix.ambient).toBe(1); // clamped
    expect(next.mix.narration).toBe(DEFAULT_AUDIO_SETTINGS.mix.narration);
    expect(repo.get().mix.ambient).toBe(1);
  });

  it('stores scene overrides and duck amount', () => {
    const repo = audioSettingsRepo(freshDb());
    repo.update({ sceneOverrides: { storm: 'rain' }, duckAmount: 0.3 });
    const got = repo.get();
    expect(got.sceneOverrides['storm']).toBe('rain');
    expect(got.duckAmount).toBe(0.3);
  });
});
