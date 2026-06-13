import type { Migration } from './index.js';

/**
 * Plugin distribution tables (F1091–F1099).
 *
 * `plugin_sources`: tracks install origin for update detection (F1092, F1093).
 * `trusted_origins`: allowlist of trusted install origins (F1097).
 * `plugin_catalog`: local registry of known plugins (F1098).
 */
export const migration017PluginDistribution: Migration = {
  id: 17,
  name: 'plugin-distribution',
  sql: /* sql */ `
    CREATE TABLE plugin_sources (
      plugin_id    TEXT NOT NULL PRIMARY KEY REFERENCES plugins(id) ON DELETE CASCADE,
      source_type  TEXT NOT NULL CHECK (source_type IN ('archive', 'url', 'directory', 'manifest')),
      source_url   TEXT,
      archive_hash TEXT,
      recorded_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE trusted_origins (
      origin       TEXT NOT NULL PRIMARY KEY,
      added_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      note         TEXT
    );

    CREATE TABLE plugin_catalog (
      id           TEXT NOT NULL PRIMARY KEY,
      name         TEXT NOT NULL,
      description  TEXT NOT NULL DEFAULT '',
      author       TEXT,
      version      TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      source_url   TEXT,
      added_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `,
};
