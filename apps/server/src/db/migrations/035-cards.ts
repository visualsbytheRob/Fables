import type { Migration } from './index.js';

/**
 * Spaced-repetition cards + review log (Epic 18, F1701/F1703).
 *
 *   cards       prompt/answer bound to a source note block, carrying FSRS state
 *               (stability/difficulty/due) and a lifecycle state. Deleting the
 *               source note orphans the card (note_id → NULL) rather than
 *               destroying review history (F1718).
 *   review_log  an append-only record of every rating with the pre-review state,
 *               the full history the optimizer (F1704) and insights read.
 */
export const migration035Cards: Migration = {
  id: 35,
  name: 'cards',
  sql: /* sql */ `
    CREATE TABLE cards (
      id          TEXT PRIMARY KEY,
      note_id     TEXT REFERENCES notes(id) ON DELETE SET NULL,
      block_ref   TEXT NOT NULL DEFAULT '',
      kind        TEXT NOT NULL DEFAULT 'basic',
      prompt      TEXT NOT NULL,
      answer      TEXT NOT NULL,
      state       TEXT NOT NULL DEFAULT 'new',
      stability   REAL,
      difficulty  REAL,
      due         TEXT,
      reps        INTEGER NOT NULL DEFAULT 0,
      lapses      INTEGER NOT NULL DEFAULT 0,
      last_review TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE INDEX idx_cards_due ON cards (state, due);
    CREATE INDEX idx_cards_note ON cards (note_id);

    CREATE TABLE review_log (
      id             TEXT PRIMARY KEY,
      card_id        TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      rating         INTEGER NOT NULL,
      state_before   TEXT NOT NULL,
      stability      REAL,
      difficulty     REAL,
      elapsed_days   REAL NOT NULL DEFAULT 0,
      scheduled_days INTEGER NOT NULL DEFAULT 0,
      review_r       REAL,
      reviewed_at    TEXT NOT NULL
    );

    CREATE INDEX idx_review_log_card ON review_log (card_id);
    CREATE INDEX idx_review_log_time ON review_log (reviewed_at);
  `,
};
