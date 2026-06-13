/**
 * Plugin registry persistence (F1009).
 *
 * All plugin state — installed, enabled, settings, status — lives in SQLite.
 * This repo is the only place that writes these tables.
 */

import { nowIso } from '@fables/core';
import type { PluginManifest } from '@fables/plugin-sdk';
import type { Db } from '../connection.js';

export interface PluginRow {
  id: string;
  version: string;
  name: string;
  description: string;
  author: string | null;
  entry: string;
  permissions: string; // JSON array
  manifest_json: string;
  enabled: number; // 0|1
  status: 'active' | 'quarantined' | 'disabled' | 'error';
  quarantine_reason: string | null;
  installed_at: string;
  updated_at: string;
}

export interface PluginRecord {
  id: string;
  version: string;
  name: string;
  description: string;
  author: string | null;
  entry: string;
  permissions: string[];
  manifest: PluginManifest;
  enabled: boolean;
  status: 'active' | 'quarantined' | 'disabled' | 'error';
  quarantineReason: string | null;
  installedAt: string;
  updatedAt: string;
}

function toRecord(row: PluginRow): PluginRecord {
  return {
    id: row.id,
    version: row.version,
    name: row.name,
    description: row.description,
    author: row.author,
    entry: row.entry,
    permissions: JSON.parse(row.permissions) as string[],
    manifest: JSON.parse(row.manifest_json) as PluginManifest,
    enabled: row.enabled === 1,
    status: row.status,
    quarantineReason: row.quarantine_reason,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  };
}

export type PluginAuditRow = {
  id: string;
  plugin_id: string;
  cap: string;
  params_json: string;
  ok: number;
  error_msg: string | null;
  created_at: string;
};

export interface PluginAuditEntry {
  id: string;
  pluginId: string;
  cap: string;
  params: unknown;
  ok: boolean;
  errorMsg: string | null;
  createdAt: string;
}

export function pluginsRepo(db: Db) {
  return {
    /** Upsert a plugin from a validated manifest. */
    upsert(manifest: PluginManifest): PluginRecord {
      const now = nowIso();
      const existing = db
        .prepare('SELECT id FROM plugins WHERE id = ?')
        .get(manifest.id) as { id: string } | undefined;

      if (existing) {
        db.prepare(
          `UPDATE plugins SET
            version = ?, name = ?, description = ?, author = ?,
            entry = ?, permissions = ?, manifest_json = ?, updated_at = ?
           WHERE id = ?`,
        ).run(
          manifest.version,
          manifest.name,
          manifest.description,
          manifest.author ?? null,
          manifest.entry,
          JSON.stringify(manifest.permissions),
          JSON.stringify(manifest),
          now,
          manifest.id,
        );
      } else {
        db.prepare(
          `INSERT INTO plugins (id, version, name, description, author, entry, permissions, manifest_json, enabled, status, installed_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?)`,
        ).run(
          manifest.id,
          manifest.version,
          manifest.name,
          manifest.description,
          manifest.author ?? null,
          manifest.entry,
          JSON.stringify(manifest.permissions),
          JSON.stringify(manifest),
          now,
          now,
        );
        // Initialize settings row
        db.prepare('INSERT INTO plugin_settings (plugin_id, settings) VALUES (?, ?)').run(
          manifest.id,
          '{}',
        );
      }

      return this.get(manifest.id)!;
    },

    get(id: string): PluginRecord | null {
      const row = db
        .prepare('SELECT * FROM plugins WHERE id = ?')
        .get(id) as PluginRow | undefined;
      return row ? toRecord(row) : null;
    },

    list(): PluginRecord[] {
      return (db.prepare('SELECT * FROM plugins ORDER BY installed_at DESC').all() as PluginRow[]).map(
        toRecord,
      );
    },

    listEnabled(): PluginRecord[] {
      return (
        db
          .prepare("SELECT * FROM plugins WHERE enabled = 1 AND status = 'active' ORDER BY installed_at ASC")
          .all() as PluginRow[]
      ).map(toRecord);
    },

    setEnabled(id: string, enabled: boolean): void {
      const now = nowIso();
      const newStatus = enabled ? 'active' : 'disabled';
      db.prepare('UPDATE plugins SET enabled = ?, status = ?, updated_at = ? WHERE id = ?').run(
        enabled ? 1 : 0,
        newStatus,
        now,
        id,
      );
    },

    quarantine(id: string, reason: string): void {
      const now = nowIso();
      db.prepare(
        "UPDATE plugins SET status = 'quarantined', quarantine_reason = ?, enabled = 0, updated_at = ? WHERE id = ?",
      ).run(reason, now, id);
    },

    delete(id: string): void {
      db.prepare('DELETE FROM plugins WHERE id = ?').run(id);
    },

    getSettings(id: string): Record<string, unknown> {
      const row = db
        .prepare('SELECT settings FROM plugin_settings WHERE plugin_id = ?')
        .get(id) as { settings: string } | undefined;
      return row ? (JSON.parse(row.settings) as Record<string, unknown>) : {};
    },

    setSettings(id: string, settings: Record<string, unknown>): void {
      const now = nowIso();
      db.prepare(
        `INSERT INTO plugin_settings (plugin_id, settings, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(plugin_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`,
      ).run(id, JSON.stringify(settings), now);
    },

    /** Append a capability-use audit entry (F1018). */
    appendAudit(entry: {
      id: string;
      pluginId: string;
      cap: string;
      params: unknown;
      ok: boolean;
      errorMsg?: string;
    }): void {
      db.prepare(
        `INSERT INTO plugin_audit_log (id, plugin_id, cap, params_json, ok, error_msg)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        entry.id,
        entry.pluginId,
        entry.cap,
        JSON.stringify(entry.params),
        entry.ok ? 1 : 0,
        entry.errorMsg ?? null,
      );
    },

    listAudit(pluginId: string, limit = 100): PluginAuditEntry[] {
      return (
        db
          .prepare(
            'SELECT * FROM plugin_audit_log WHERE plugin_id = ? ORDER BY created_at DESC LIMIT ?',
          )
          .all(pluginId, limit) as PluginAuditRow[]
      ).map((r) => ({
        id: r.id,
        pluginId: r.plugin_id,
        cap: r.cap,
        params: JSON.parse(r.params_json) as unknown,
        ok: r.ok === 1,
        errorMsg: r.error_msg,
        createdAt: r.created_at,
      }));
    },

    /** Idempotency check for event replay protection (F1055). */
    hasSeenEvent(pluginId: string, idempotencyKey: string): boolean {
      const row = db
        .prepare(
          'SELECT 1 FROM plugin_events_seen WHERE plugin_id = ? AND idempotency_key = ?',
        )
        .get(pluginId, idempotencyKey);
      return row !== undefined;
    },

    markEventSeen(pluginId: string, eventName: string, idempotencyKey: string): void {
      db.prepare(
        'INSERT OR IGNORE INTO plugin_events_seen (idempotency_key, plugin_id, event_name) VALUES (?, ?, ?)',
      ).run(idempotencyKey, pluginId, eventName);
    },

    /** Plugin-private key-value storage (F1063). */
    storageGet(pluginId: string, key: string): string | null {
      const row = db
        .prepare('SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?')
        .get(pluginId, key) as { value: string } | undefined;
      return row?.value ?? null;
    },

    storageSet(pluginId: string, key: string, value: string): void {
      const now = nowIso();
      db.prepare(
        `INSERT INTO plugin_storage (plugin_id, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).run(pluginId, key, value, now);
    },

    storageDelete(pluginId: string, key: string): void {
      db.prepare('DELETE FROM plugin_storage WHERE plugin_id = ? AND key = ?').run(pluginId, key);
    },

    // ── Distribution methods (F1091–F1099) ─────────────────────────────────────

    /** Record install origin for update detection (F1092, F1093). */
    setSource(
      pluginId: string,
      source: { type: 'archive' | 'url' | 'directory' | 'manifest'; url?: string; archiveHash?: string },
    ): void {
      db.prepare(
        `INSERT INTO plugin_sources (plugin_id, source_type, source_url, archive_hash)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(plugin_id) DO UPDATE SET
           source_type = excluded.source_type,
           source_url = excluded.source_url,
           archive_hash = excluded.archive_hash,
           recorded_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      ).run(pluginId, source.type, source.url ?? null, source.archiveHash ?? null);
    },

    getSource(pluginId: string): { type: string; url: string | null; archiveHash: string | null; recordedAt: string } | null {
      const row = db
        .prepare('SELECT source_type, source_url, archive_hash, recorded_at FROM plugin_sources WHERE plugin_id = ?')
        .get(pluginId) as { source_type: string; source_url: string | null; archive_hash: string | null; recorded_at: string } | undefined;
      if (!row) return null;
      return { type: row.source_type, url: row.source_url, archiveHash: row.archive_hash, recordedAt: row.recorded_at };
    },

    deleteSource(pluginId: string): void {
      db.prepare('DELETE FROM plugin_sources WHERE plugin_id = ?').run(pluginId);
    },

    // ── Trusted origins (F1097) ────────────────────────────────────────────────

    isTrustedOrigin(origin: string): boolean {
      const row = db.prepare('SELECT 1 FROM trusted_origins WHERE origin = ?').get(origin);
      return row !== undefined;
    },

    addTrustedOrigin(origin: string, note?: string): void {
      db.prepare(
        'INSERT OR IGNORE INTO trusted_origins (origin, note) VALUES (?, ?)',
      ).run(origin, note ?? null);
    },

    removeTrustedOrigin(origin: string): void {
      db.prepare('DELETE FROM trusted_origins WHERE origin = ?').run(origin);
    },

    listTrustedOrigins(): { origin: string; addedAt: string; note: string | null }[] {
      return (db.prepare('SELECT origin, added_at, note FROM trusted_origins ORDER BY added_at ASC').all() as { origin: string; added_at: string; note: string | null }[]).map((r) => ({
        origin: r.origin,
        addedAt: r.added_at,
        note: r.note,
      }));
    },

    // ── Catalog (F1098) ────────────────────────────────────────────────────────

    catalogList(): { id: string; name: string; description: string; author: string | null; version: string; manifest: unknown; sourceUrl: string | null }[] {
      return (db.prepare('SELECT * FROM plugin_catalog ORDER BY name ASC').all() as {
        id: string; name: string; description: string; author: string | null; version: string; manifest_json: string; source_url: string | null; added_at: string;
      }[]).map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        author: r.author,
        version: r.version,
        manifest: JSON.parse(r.manifest_json) as unknown,
        sourceUrl: r.source_url,
      }));
    },

    catalogGet(id: string): { id: string; name: string; description: string; author: string | null; version: string; manifest: unknown; sourceUrl: string | null } | null {
      const row = db.prepare('SELECT * FROM plugin_catalog WHERE id = ?').get(id) as {
        id: string; name: string; description: string; author: string | null; version: string; manifest_json: string; source_url: string | null;
      } | undefined;
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        author: row.author,
        version: row.version,
        manifest: JSON.parse(row.manifest_json) as unknown,
        sourceUrl: row.source_url,
      };
    },

    catalogUpsert(entry: { id: string; name: string; description: string; author?: string; version: string; manifest: unknown; sourceUrl?: string }): void {
      db.prepare(
        `INSERT INTO plugin_catalog (id, name, description, author, version, manifest_json, source_url)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           author = excluded.author,
           version = excluded.version,
           manifest_json = excluded.manifest_json,
           source_url = excluded.source_url`,
      ).run(entry.id, entry.name, entry.description, entry.author ?? null, entry.version, JSON.stringify(entry.manifest), entry.sourceUrl ?? null);
    },

    // ── Purge plugin data (F1096) ──────────────────────────────────────────────

    purgePluginData(pluginId: string): void {
      // Cascades on DELETE FROM plugins handle audit_log, events_seen, storage, notebook_grants
      // but we want to keep the plugin row; this explicitly removes all transient data.
      db.prepare('DELETE FROM plugin_storage WHERE plugin_id = ?').run(pluginId);
      db.prepare('DELETE FROM plugin_settings WHERE plugin_id = ?').run(pluginId);
      db.prepare('DELETE FROM plugin_audit_log WHERE plugin_id = ?').run(pluginId);
      db.prepare('DELETE FROM plugin_events_seen WHERE plugin_id = ?').run(pluginId);
      db.prepare('DELETE FROM plugin_notebook_grants WHERE plugin_id = ?').run(pluginId);
      // Re-create a blank settings row so subsequent reads don't fail
      db.prepare('INSERT OR IGNORE INTO plugin_settings (plugin_id, settings) VALUES (?, ?)').run(pluginId, '{}');
    },

    /** Notebook-scoped grants (F1066). */
    grantNotebook(pluginId: string, notebookId: string): void {
      db.prepare(
        'INSERT OR IGNORE INTO plugin_notebook_grants (plugin_id, notebook_id) VALUES (?, ?)',
      ).run(pluginId, notebookId);
    },

    revokeNotebook(pluginId: string, notebookId: string): void {
      db.prepare(
        'DELETE FROM plugin_notebook_grants WHERE plugin_id = ? AND notebook_id = ?',
      ).run(pluginId, notebookId);
    },

    listNotebookGrants(pluginId: string): string[] {
      return (
        db
          .prepare('SELECT notebook_id FROM plugin_notebook_grants WHERE plugin_id = ?')
          .all(pluginId) as { notebook_id: string }[]
      ).map((r) => r.notebook_id);
    },
  };
}
