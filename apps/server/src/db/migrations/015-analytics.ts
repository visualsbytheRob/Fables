import type { Migration } from './index.js';

/**
 * Local analytics tables (F971–F980).
 *
 * `analytics_events`: feature-usage counters and timing events.
 *   All data is local-only and never leaves the machine.
 *   - id: ULID
 *   - event_type: 'feature_use' | 'slow_op' | 'error' | 'perf'
 *   - category: feature name or subsystem (e.g. 'notes', 'search', 'vm')
 *   - label: specific action (e.g. 'create', 'search', 'compile')
 *   - value: numeric measurement (count, duration ms, etc.)
 *   - meta: JSON blob for additional context
 *   - created_at: ISO timestamp
 *
 * `analytics_settings`: single-row opt-out flag and retention config.
 */
export const migration015Analytics: Migration = {
  id: 15,
  name: 'analytics',
  sql: /* sql */ `
    CREATE TABLE analytics_events (
      id          TEXT PRIMARY KEY,
      event_type  TEXT NOT NULL CHECK (event_type IN ('feature_use','slow_op','error','perf')),
      category    TEXT NOT NULL,
      label       TEXT NOT NULL DEFAULT '',
      value       REAL NOT NULL DEFAULT 1,
      meta        TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX idx_analytics_type_cat ON analytics_events (event_type, category, created_at);
    CREATE INDEX idx_analytics_created ON analytics_events (created_at);

    CREATE TABLE analytics_settings (
      id              INTEGER PRIMARY KEY CHECK (id = 1),
      enabled         INTEGER NOT NULL DEFAULT 1,
      retention_days  INTEGER NOT NULL DEFAULT 90,
      updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    INSERT INTO analytics_settings (id, enabled, retention_days) VALUES (1, 1, 90);
  `,
};
