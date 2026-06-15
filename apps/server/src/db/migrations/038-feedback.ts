import type { Migration } from './index.js';

/**
 * Reader feedback + playthrough analytics (Epic 19, F1851/F1854).
 *
 *   reader_feedback  per-moment reader reactions/notes anchored to a knot.
 *   play_events      a local event log of knot visits, choices, and endings —
 *                    the raw material for choice statistics, drop-off, and
 *                    ending-distribution analysis. Local-only; export is opt-in.
 */
export const migration038Feedback: Migration = {
  id: 38,
  name: 'feedback',
  sql: /* sql */ `
    CREATE TABLE reader_feedback (
      id         TEXT PRIMARY KEY,
      story_id   TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      knot       TEXT NOT NULL DEFAULT '',
      kind       TEXT NOT NULL DEFAULT 'note',
      text       TEXT NOT NULL DEFAULT '',
      sentiment  TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_reader_feedback_story ON reader_feedback (story_id);

    CREATE TABLE play_events (
      id           TEXT PRIMARY KEY,
      story_id     TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      session_id   TEXT NOT NULL,
      type         TEXT NOT NULL,
      knot         TEXT NOT NULL DEFAULT '',
      choice_index INTEGER,
      label        TEXT NOT NULL DEFAULT '',
      seq          INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX idx_play_events_story ON play_events (story_id, session_id, seq);
  `,
};
