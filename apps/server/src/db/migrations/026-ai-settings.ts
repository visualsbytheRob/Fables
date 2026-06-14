import type { Migration } from './index.js';

/**
 * AI settings & trust (F1391–F1394).
 *
 * A single-row JSON document holding the user's AI preferences: the global kill
 * switch (F1392), per-feature toggles (F1391), and per-notebook AI exclusions
 * (F1394). One row (id = 1); the whole document is read/written together since
 * it's tiny and always loaded as a unit.
 */
export const migration026AiSettings: Migration = {
  id: 26,
  name: 'ai-settings',
  sql: /* sql */ `
    CREATE TABLE ai_settings (
      id   INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    );
  `,
};
