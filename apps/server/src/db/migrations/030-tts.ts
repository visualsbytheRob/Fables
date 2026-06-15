import type { Migration } from './index.js';

/**
 * Text-to-speech persistence (Epic 17, Audio Fables).
 *
 *   F1603  tts_cache: content-addressed synthesis cache. The key is a hash of
 *          (text, voice, rate, pitch); the value is the rendered audio blob, so
 *          re-reading a passage is instant and offline.
 *   F1608  tts_settings: one JSON row of per-vault voice defaults (voice, rate,
 *          pitch) plus the pronunciation lexicon source.
 */
export const migration030Tts: Migration = {
  id: 30,
  name: 'tts',
  sql: /* sql */ `
    CREATE TABLE tts_cache (
      hash        TEXT PRIMARY KEY,
      voice_id    TEXT NOT NULL,
      format      TEXT NOT NULL,
      sample_rate INTEGER NOT NULL,
      duration_ms INTEGER,
      bytes       INTEGER NOT NULL,
      audio       BLOB NOT NULL,
      created_at  TEXT NOT NULL,
      last_used   TEXT NOT NULL
    );

    CREATE INDEX idx_tts_cache_last_used ON tts_cache (last_used);

    CREATE TABLE tts_settings (
      id   INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    );
  `,
};
