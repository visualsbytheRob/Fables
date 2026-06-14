import type { Migration } from './index.js';

/**
 * Per-notebook retention policies (F1283).
 *
 * Adds a `retention_days` column to notebooks: when set, notes in that
 * notebook whose `updated_at` is older than `retention_days` days are
 * eligible for auto-purge (unless a legal hold is active).
 *
 * NULL means "retain forever" (the default).
 */
export const migration023Retention: Migration = {
  id: 23,
  name: 'retention',
  sql: /* sql */ `
    ALTER TABLE notebooks ADD COLUMN retention_days INTEGER;
  `,
};
