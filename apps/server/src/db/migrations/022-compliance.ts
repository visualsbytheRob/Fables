import type { Migration } from './index.js';

/**
 * Compliance settings table (F1286).
 *
 * A single-row key-value table for compliance flags that must survive server
 * restarts. Currently used for:
 *   - legal_hold (TEXT 'true'/'false'): when true, destructive operations
 *     (trash purge, hard-delete) are blocked.
 *
 * Adding new compliance keys is a zero-migration operation — just INSERT a new
 * row with a different key.
 */
export const migration022Compliance: Migration = {
  id: 22,
  name: 'compliance',
  sql: /* sql */ `
    CREATE TABLE compliance_settings (
      key        TEXT    NOT NULL PRIMARY KEY,
      value      TEXT    NOT NULL,
      updated_at TEXT    NOT NULL
    );

    INSERT INTO compliance_settings (key, value, updated_at)
    VALUES ('legal_hold', 'false', datetime('now'));
  `,
};
