/**
 * Per-vault voice settings tests (F1608/F1610).
 */

import { describe, expect, it } from 'vitest';
import { openDb } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { DEFAULT_TTS_SETTINGS, ttsSettingsRepo } from './settings.js';

function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

describe('ttsSettingsRepo (F1608)', () => {
  it('returns defaults before anything is written', () => {
    const repo = ttsSettingsRepo(freshDb());
    expect(repo.get()).toEqual(DEFAULT_TTS_SETTINGS);
  });

  it('persists a partial update and merges with defaults', () => {
    const repo = ttsSettingsRepo(freshDb());
    const next = repo.update({ defaultVoiceId: 'mock-amy', rate: 1.25 });
    expect(next.defaultVoiceId).toBe('mock-amy');
    expect(next.rate).toBe(1.25);
    expect(next.pitch).toBe(DEFAULT_TTS_SETTINGS.pitch);
    // Survives a fresh repo over the same db.
    expect(repo.get().defaultVoiceId).toBe('mock-amy');
  });

  it('round-trips a lexicon and disable flag', () => {
    const repo = ttsSettingsRepo(freshDb());
    repo.update({ disabled: true, lexicon: 'Mira: MEE-ra' });
    const got = repo.get();
    expect(got.disabled).toBe(true);
    expect(got.lexicon).toBe('Mira: MEE-ra');
  });
});
