import type { Migration } from './index.js';

/** Saved FQL queries — sidebar smart folders and pinned top-bar shortcuts (F281, F287). */
export const migration006SavedQueries: Migration = {
  id: 6,
  name: 'saved-queries',
  sql: /* sql */ `
    CREATE TABLE saved_queries (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      fql        TEXT NOT NULL,
      icon       TEXT,
      pinned     INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `,
};
