import type { Migration } from './index.js';

/**
 * Sync protocol tables (F831–F870).
 *
 * `devices`: registry of known sync clients.
 *   - id: device ID (client-generated, e.g. a ULID prefixed 'dev_')
 *   - name: human-readable label (e.g. "iPhone 15", "MacBook Pro")
 *   - last_sync_at: ISO timestamp of last successful sync
 *   - last_seen_at: ISO timestamp of last contact (push or pull)
 *   - schema_version: last reported client schema version
 *
 * `ops`: the immutable operation log.
 *   - id: client-generated idempotency key (deviceId_lamport)
 *   - device_id: FK → devices.id
 *   - lamport: client-side Lamport clock value at creation
 *   - seq: server-assigned strictly-monotonic sequence number (for pull cursors)
 *   - domain: 'note' | 'entity' | 'save_slot'
 *   - op_type: 'create' | 'update' | 'delete' | 'restore' | 'upsert'
 *   - entity_id: the ID of the note/entity/slot being operated on
 *   - payload: JSON blob of the op payload
 *   - schema_version: client's schema version at time of push
 *   - created_at: server receive time (for housekeeping; ordering uses seq)
 *
 * `op_snapshots`: compacted per-entity state for old ops (F836).
 *   - entity_id: the entity this snapshot covers
 *   - domain: 'note' | 'entity' | 'save_slot'
 *   - through_lamport: highest lamport included
 *   - through_seq: server seq through which ops were compacted
 *   - payload: JSON folded state
 *
 * Source of truth choice (for documentation — see PROTOCOL.md):
 *   Ops are written to the op-log first, then SYNCHRONOUSLY applied to the
 *   real tables (notes, entities, story_saves) inside the same transaction.
 *   This keeps the REST API and sync in sync: reads always see the latest
 *   state regardless of whether the caller used REST or sync push.
 */
export const migration014Sync: Migration = {
  id: 14,
  name: 'sync',
  sql: /* sql */ `
    CREATE TABLE devices (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL DEFAULT '',
      last_sync_at     TEXT,
      last_seen_at     TEXT,
      schema_version   INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE ops (
      id               TEXT PRIMARY KEY,
      device_id        TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      lamport          INTEGER NOT NULL,
      seq              INTEGER NOT NULL,
      domain           TEXT NOT NULL CHECK (domain IN ('note','entity','save_slot')),
      op_type          TEXT NOT NULL CHECK (op_type IN ('create','update','delete','restore','upsert')),
      entity_id        TEXT NOT NULL,
      payload          TEXT NOT NULL DEFAULT '{}',
      schema_version   INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE UNIQUE INDEX idx_ops_seq ON ops (seq);
    CREATE INDEX idx_ops_device ON ops (device_id, lamport);
    CREATE INDEX idx_ops_entity ON ops (entity_id, domain);
    CREATE INDEX idx_ops_domain_seq ON ops (domain, seq);

    -- Strictly-monotonic seq counter (one row).
    CREATE TABLE op_seq_counter (
      id    INTEGER PRIMARY KEY CHECK (id = 1),
      value INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO op_seq_counter (id, value) VALUES (1, 0);

    CREATE TABLE op_snapshots (
      entity_id        TEXT NOT NULL,
      domain           TEXT NOT NULL CHECK (domain IN ('note','entity','save_slot')),
      through_lamport  INTEGER NOT NULL,
      through_seq      INTEGER NOT NULL,
      payload          TEXT NOT NULL DEFAULT '{}',
      created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (entity_id, domain)
    );
  `,
};
