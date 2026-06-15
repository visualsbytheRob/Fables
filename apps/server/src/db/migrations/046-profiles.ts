import type { Migration } from './index.js';

/**
 * Workspace profiles (Epic 20, F1971–F1978).
 *
 *   workspace_profiles  a named UI state (open panes, filters, theme, focus mode,
 *                       notification rules) stored as an opaque JSON blob. A
 *                       profile may be the default for a device (`device` null =
 *                       the global default); at most one default per scope.
 */
export const migration046Profiles: Migration = {
  id: 46,
  name: 'profiles',
  sql: /* sql */ `
    CREATE TABLE workspace_profiles (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      state      TEXT NOT NULL DEFAULT '{}',
      device     TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_workspace_profiles_default ON workspace_profiles (is_default, device);
  `,
};
