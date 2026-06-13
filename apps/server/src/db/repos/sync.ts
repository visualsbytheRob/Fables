/**
 * Sync repos: ops table, devices table, op_snapshots, seq counter (F832–F833, F836, F838).
 */

import type { Db } from '../connection.js';
import { withTransaction } from '../connection.js';
import type { SyncOp, DeviceInfo, EntitySnapshot, OpAck } from '@fables/sync';

// ── Row types ─────────────────────────────────────────────────────────────────

interface OpRow {
  id: string;
  device_id: string;
  lamport: number;
  seq: number;
  domain: string;
  op_type: string;
  entity_id: string;
  payload: string;
  schema_version: number;
  created_at: string;
}

interface DeviceRow {
  id: string;
  name: string;
  last_sync_at: string | null;
  last_seen_at: string | null;
  schema_version: number;
  created_at: string;
}

interface SnapshotRow {
  entity_id: string;
  domain: string;
  through_lamport: number;
  through_seq: number;
  payload: string;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toSyncOp(row: OpRow): SyncOp & { serverSeq: number } {
  const payload = JSON.parse(row.payload) as Record<string, unknown>;
  return {
    id: row.id,
    deviceId: row.device_id,
    lamport: row.lamport,
    schemaVersion: row.schema_version,
    clientCreatedAt: row.created_at,
    domain: row.domain as SyncOp['domain'],
    opType: row.op_type as SyncOp['opType'],
    entityId: row.entity_id,
    payload,
    serverSeq: row.seq,
  } as SyncOp & { serverSeq: number };
}

function toDeviceInfo(row: DeviceRow): DeviceInfo {
  return {
    deviceId: row.id as DeviceInfo['deviceId'],
    name: row.name,
    lastSyncAt: row.last_sync_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  };
}

function toSnapshot(row: SnapshotRow): EntitySnapshot {
  return {
    domain: row.domain as EntitySnapshot['domain'],
    entityId: row.entity_id,
    throughLamport: row.through_lamport,
    throughSeq: row.through_seq,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

// ── Repo ──────────────────────────────────────────────────────────────────────

export function syncRepo(db: Db) {
  const nextSeq = db.prepare<[], { value: number }>(
    'UPDATE op_seq_counter SET value = value + 1 WHERE id = 1 RETURNING value',
  );

  const insertOp = db.prepare<
    [string, string, number, number, string, string, string, string, number, string],
    void
  >(
    `INSERT OR IGNORE INTO ops
       (id, device_id, lamport, seq, domain, op_type, entity_id, payload, schema_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const checkOpExists = db.prepare<[string], { id: string }>('SELECT id FROM ops WHERE id = ?');

  const queryOpsSince = db.prepare<[number, number], OpRow>(
    `SELECT * FROM ops WHERE seq > ? ORDER BY seq ASC LIMIT ?`,
  );

  const upsertDevice = db.prepare<[string, string, string], void>(
    `INSERT INTO devices (id, name, last_seen_at, schema_version)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET
       last_seen_at = excluded.last_seen_at`,
  );

  const updateDeviceSyncTime = db.prepare<[string, string, string], void>(
    `UPDATE devices SET last_sync_at = ?, last_seen_at = ? WHERE id = ?`,
  );

  const getDevice = db.prepare<[string], DeviceRow>('SELECT * FROM devices WHERE id = ?');

  const listDevices = db.prepare<[], DeviceRow>('SELECT * FROM devices ORDER BY last_seen_at DESC');

  const upsertDeviceNamed = db.prepare<[string, string, string], void>(
    `INSERT INTO devices (id, name, last_seen_at, schema_version)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       last_seen_at = excluded.last_seen_at`,
  );

  const getSnapshot = db.prepare<[string, string], SnapshotRow>(
    'SELECT * FROM op_snapshots WHERE entity_id = ? AND domain = ?',
  );

  const upsertSnapshot = db.prepare<[string, string, number, number, string, string], void>(
    `INSERT INTO op_snapshots (entity_id, domain, through_lamport, through_seq, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(entity_id, domain) DO UPDATE SET
       through_lamport = excluded.through_lamport,
       through_seq = excluded.through_seq,
       payload = excluded.payload,
       created_at = excluded.created_at`,
  );

  const deleteOpsBeforeSeq = db.prepare<[number, string], void>(
    'DELETE FROM ops WHERE seq <= ? AND entity_id = ?',
  );

  return {
    /**
     * Ingest a batch of ops, assigning server-seq numbers.
     * Idempotent: ops whose id already exists are treated as duplicates.
     * Returns per-op acks (F862).
     */
    ingestOps(ops: SyncOp[], deviceId: string, now = new Date().toISOString()): OpAck[] {
      return withTransaction(db, () => {
        // Register device
        upsertDevice.run(deviceId, '', now);

        const acks: OpAck[] = [];
        for (const op of ops) {
          const existing = checkOpExists.get(op.id);
          if (existing) {
            acks.push({ opId: op.id, status: 'duplicate' });
            continue;
          }

          const seqRow = nextSeq.get();
          if (!seqRow) throw new Error('seq counter missing');
          const seq = seqRow.value;

          try {
            insertOp.run(
              op.id,
              op.deviceId,
              op.lamport,
              seq,
              op.domain,
              op.opType,
              op.entityId,
              JSON.stringify(op.payload),
              op.schemaVersion ?? 1,
              now,
            );
            acks.push({ opId: op.id, status: 'accepted', serverSeq: seq });
          } catch (e) {
            acks.push({
              opId: op.id,
              status: 'rejected',
              reason: e instanceof Error ? e.message : String(e),
            });
          }
        }

        // Update device last-seen
        updateDeviceSyncTime.run(now, now, deviceId);
        return acks;
      });
    },

    /**
     * Pull ops after a cursor (server seq), up to `limit`.
     * Returns ops with their serverSeq attached.
     */
    pullOpsSince(sinceSeq: number, limit: number): Array<SyncOp & { serverSeq: number }> {
      const rows = queryOpsSince.all(sinceSeq, limit + 1) as OpRow[];
      return rows.map(toSyncOp);
    },

    /** Register or update a device by name. */
    registerDevice(deviceId: string, name: string, now = new Date().toISOString()): DeviceInfo {
      upsertDeviceNamed.run(deviceId, name, now);
      const row = getDevice.get(deviceId) as DeviceRow;
      return toDeviceInfo(row);
    },

    /** Update device last-sync timestamp after a successful sync cycle. */
    markDeviceSynced(deviceId: string, now = new Date().toISOString()): void {
      updateDeviceSyncTime.run(now, now, deviceId);
    },

    /** Get a single device. */
    getDevice(deviceId: string): DeviceInfo | null {
      const row = getDevice.get(deviceId) as DeviceRow | undefined;
      return row ? toDeviceInfo(row) : null;
    },

    /** List all devices (F838). */
    listDevices(): DeviceInfo[] {
      const rows = listDevices.all() as DeviceRow[];
      return rows.map(toDeviceInfo);
    },

    /** Get a compaction snapshot for an entity. */
    getSnapshot(entityId: string, domain: string): EntitySnapshot | null {
      const row = getSnapshot.get(entityId, domain) as SnapshotRow | undefined;
      return row ? toSnapshot(row) : null;
    },

    /** Save a compaction snapshot and delete the compacted ops (F836). */
    saveSnapshot(snapshot: EntitySnapshot): void {
      withTransaction(db, () => {
        upsertSnapshot.run(
          snapshot.entityId,
          snapshot.domain,
          snapshot.throughLamport,
          snapshot.throughSeq,
          JSON.stringify(snapshot.payload),
          snapshot.createdAt,
        );
        deleteOpsBeforeSeq.run(snapshot.throughSeq, snapshot.entityId);
      });
    },

    /** Count ops that have not been compacted yet. */
    pendingOpCount(): number {
      const row = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM ops').get() as {
        n: number;
      };
      return row.n;
    },

    /** Ops eligible for compaction: entities with ≥ threshold ops, all before olderThanSeq. */
    compactionCandidates(
      threshold: number,
      olderThanSeq: number,
    ): Array<{ entityId: string; domain: string; count: number }> {
      const rows = db
        .prepare<[number, number], { entity_id: string; domain: string; count: number }>(
          `SELECT entity_id, domain, COUNT(*) as count
           FROM ops
           WHERE seq < ?
           GROUP BY entity_id, domain
           HAVING COUNT(*) >= ?`,
        )
        .all(olderThanSeq, threshold) as Array<{
        entity_id: string;
        domain: string;
        count: number;
      }>;
      return rows.map((r) => ({ entityId: r.entity_id, domain: r.domain, count: r.count }));
    },

    /** All ops for a given entity (for compaction). */
    opsForEntity(entityId: string, domain: string): Array<SyncOp & { serverSeq: number }> {
      const rows = db
        .prepare<
          [string, string],
          OpRow
        >('SELECT * FROM ops WHERE entity_id = ? AND domain = ? ORDER BY seq ASC')
        .all(entityId, domain) as OpRow[];
      return rows.map(toSyncOp);
    },

    /** Checksum data for data-integrity comparison (F867). */
    checksumData(): Array<{ table: string; ids: string[] }> {
      const noteIds = (
        db.prepare<[], { id: string }>('SELECT id FROM notes').all() as { id: string }[]
      ).map((r) => r.id);
      const entityIds = (
        db.prepare<[], { id: string }>('SELECT id FROM entities').all() as { id: string }[]
      ).map((r) => r.id);
      const slotIds = (
        db.prepare<[], { id: string }>('SELECT id FROM story_saves').all() as { id: string }[]
      ).map((r) => r.id);
      return [
        { table: 'notes', ids: noteIds },
        { table: 'entities', ids: entityIds },
        { table: 'story_saves', ids: slotIds },
      ];
    },
  };
}
