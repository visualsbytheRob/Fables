import type { Migration } from './index.js';

/**
 * Script library (Epic 20, F1942–F1947).
 *
 *   scripts  saved console scripts: source, the capability scopes they declare,
 *            an optional cron for scheduled runs, and an enabled flag. Execution
 *            runs through the plugin sandbox; this stores and scopes them.
 */
export const migration045Scripts: Migration = {
  id: 45,
  name: 'scripts',
  sql: /* sql */ `
    CREATE TABLE scripts (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      source      TEXT NOT NULL,
      scopes      TEXT NOT NULL DEFAULT '[]',
      cron        TEXT,
      enabled     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
  `,
};
