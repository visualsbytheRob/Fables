import type { Migration } from './index.js';

/**
 * Playback state (Epic 17, F1673 position, F1674 queue, F1675 pins, F1678 stats).
 *
 *   playback_state   per-item resume position + duration + completion + the
 *                    actual listened-ms accumulator that feeds listening stats.
 *   listening_queue  an ordered chain of stories/notes to play next (F1674).
 *   audio_pins       items pinned for offline caching (F1675) — the pin state is
 *                    server-side; the bytes are cached by the web layer.
 *
 * Items are addressed by (item_type, item_id), where item_type is 'story' or
 * 'note', so playback works uniformly across both.
 */
export const migration034Playback: Migration = {
  id: 34,
  name: 'playback',
  sql: /* sql */ `
    CREATE TABLE playback_state (
      item_type   TEXT NOT NULL,
      item_id     TEXT NOT NULL,
      position_ms INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      listened_ms INTEGER NOT NULL DEFAULT 0,
      completed   INTEGER NOT NULL DEFAULT 0,
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (item_type, item_id)
    );

    CREATE TABLE listening_queue (
      id         TEXT PRIMARY KEY,
      ord        INTEGER NOT NULL,
      item_type  TEXT NOT NULL,
      item_id    TEXT NOT NULL,
      title      TEXT NOT NULL DEFAULT '',
      added_at   TEXT NOT NULL
    );

    CREATE INDEX idx_listening_queue_ord ON listening_queue (ord);

    CREATE TABLE audio_pins (
      item_type TEXT NOT NULL,
      item_id   TEXT NOT NULL,
      title     TEXT NOT NULL DEFAULT '',
      pinned_at TEXT NOT NULL,
      PRIMARY KEY (item_type, item_id)
    );
  `,
};
