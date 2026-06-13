import type { Migration } from './index.js';

/**
 * Plugin registry tables (F1009, F1018, F1063).
 *
 * `plugins`: installed plugins with their status and enabled state.
 * `plugin_settings`: per-plugin settings blobs (schema-driven on client).
 * `plugin_audit_log`: capability-use audit trail (F1018).
 * `plugin_events_seen`: idempotency keys for replay protection (F1055).
 * `plugin_storage`: plugin-private key-value store (F1063).
 * `plugin_notebook_grants`: per-notebook access grants (F1066).
 */
export const migration016Plugins: Migration = {
  id: 16,
  name: 'plugins',
  sql: /* sql */ `
    CREATE TABLE plugins (
      id              TEXT PRIMARY KEY,
      version         TEXT NOT NULL,
      name            TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      author          TEXT,
      entry           TEXT NOT NULL DEFAULT 'entry.js',
      permissions     TEXT NOT NULL DEFAULT '[]',
      manifest_json   TEXT NOT NULL,
      enabled         INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      status          TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'quarantined', 'disabled', 'error')),
      quarantine_reason TEXT,
      installed_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE plugin_settings (
      plugin_id   TEXT NOT NULL PRIMARY KEY REFERENCES plugins(id) ON DELETE CASCADE,
      settings    TEXT NOT NULL DEFAULT '{}',
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE plugin_audit_log (
      id          TEXT NOT NULL,
      plugin_id   TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
      cap         TEXT NOT NULL,
      params_json TEXT NOT NULL DEFAULT '{}',
      ok          INTEGER NOT NULL DEFAULT 1 CHECK (ok IN (0, 1)),
      error_msg   TEXT,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (id)
    );

    CREATE INDEX idx_plugin_audit_plugin ON plugin_audit_log (plugin_id, created_at);
    CREATE INDEX idx_plugin_audit_created ON plugin_audit_log (created_at);

    CREATE TABLE plugin_events_seen (
      idempotency_key TEXT PRIMARY KEY,
      plugin_id       TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
      event_name      TEXT NOT NULL,
      seen_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX idx_plugin_events_seen_plugin ON plugin_events_seen (plugin_id, seen_at);

    CREATE TABLE plugin_storage (
      plugin_id   TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
      key         TEXT NOT NULL,
      value       TEXT NOT NULL,
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (plugin_id, key)
    );

    CREATE TABLE plugin_notebook_grants (
      plugin_id    TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
      notebook_id  TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      granted_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (plugin_id, notebook_id)
    );
  `,
};
