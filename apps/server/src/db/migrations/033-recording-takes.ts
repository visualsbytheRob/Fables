import type { Migration } from './index.js';

/**
 * Recording studio takes (Epic 17, F1651/F1653/F1659).
 *
 * Human narration takes, one row per recording, keyed to a story line
 * (`line_key`, e.g. "knot:3"). Audio is stored content-addressed by
 * `content_hash` (F1659) so identical bytes dedupe; `active` marks the chosen
 * take per line (F1653). Multiple takes per line are kept until pruned (F1652).
 */
export const migration033RecordingTakes: Migration = {
  id: 33,
  name: 'recording-takes',
  sql: /* sql */ `
    CREATE TABLE recording_takes (
      id           TEXT PRIMARY KEY,
      story_id     TEXT NOT NULL,
      line_key     TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      format       TEXT NOT NULL DEFAULT 'opus',
      duration_ms  INTEGER,
      bytes        INTEGER NOT NULL,
      audio        BLOB NOT NULL,
      active       INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL
    );

    CREATE INDEX idx_recording_takes_line ON recording_takes (story_id, line_key);
    CREATE UNIQUE INDEX idx_recording_takes_dedup
      ON recording_takes (story_id, line_key, content_hash);
  `,
};
