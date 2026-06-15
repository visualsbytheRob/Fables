import type { Migration } from './index.js';

/**
 * Decks (Epic 18, F1741/F1742) — saved card filters with per-deck scheduler
 * settings. A deck's membership is dynamic: it's a stored filter evaluated
 * against the cards table, so adding a matching card joins the deck
 * automatically. `settings` carries the deck's FSRS overrides (request
 * retention, new-card limit, max interval).
 */
export const migration036Decks: Migration = {
  id: 36,
  name: 'decks',
  sql: /* sql */ `
    CREATE TABLE decks (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      filter     TEXT NOT NULL DEFAULT '{}',
      settings   TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `,
};
