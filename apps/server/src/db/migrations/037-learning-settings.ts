import type { Migration } from './index.js';

/**
 * Learning settings (Epic 18, F1764/F1765/F1766/F1767/F1768).
 *
 * One JSON row: vacation mode, daily new/review caps for catch-up, relearning
 * steps, the global max-interval cap + request retention, and per-card priority
 * overrides. Stored as a document so the shape can grow without further
 * migrations.
 */
export const migration037LearningSettings: Migration = {
  id: 37,
  name: 'learning-settings',
  sql: /* sql */ `
    CREATE TABLE learning_settings (
      id   INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    );
  `,
};
