# Fables Sync Protocol

Version: 1 (`SYNC_SCHEMA_VERSION = 1`)

## Overview

Fables uses an **operation log** (op-log) for offline-first sync. Every mutation
is represented as an immutable op. Devices maintain a local outbox of ops not yet
pushed, and a cursor tracking which server ops they have applied.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Client (PWA / browser, IndexedDB)                              │
│                                                                 │
│  ┌─────────┐    ┌──────────┐    ┌────────────────────────────┐ │
│  │ UI layer│───▶│SyncEngine│───▶│ Outbox (pending local ops) │ │
│  └─────────┘    └──────────┘    └────────────────────────────┘ │
│                      │                                          │
│                 CursorStorage (IDB)                             │
│                      │                                          │
└──────────────────────┼──────────────────────────────────────────┘
                       │  HTTP
┌──────────────────────┼──────────────────────────────────────────┐
│  Server (Fastify + SQLite)       │                              │
│                                  ▼                              │
│  POST /sync/push ──▶ ops table ──▶ notes / entities / saves    │
│  GET  /sync/pull ◀── ops table (ordered by seq)                │
└─────────────────────────────────────────────────────────────────┘
```

## Source of Truth

**Ops are the audit trail; real tables are the materialized view.**

When a client pushes an op:

1. The op is written to the `ops` table (append-only, immutable).
2. The op is synchronously applied to the real SQLite tables (`notes`, `entities`, `story_saves`) **in the same transaction**.

This means:

- The REST API always returns current state without consulting the op-log.
- Sync and REST are never inconsistent.
- Re-applying ops (e.g., during re-hydration) is idempotent.

## Lamport Clock

Every op carries a **Lamport clock** — a monotonically increasing integer.

```
tick(local):   local + 1          # generate a local op
advance(l, r): max(l, r) + 1     # receive a remote op
```

**Total ordering**: ops are sorted by `(lamport ASC, deviceId ASC)`. This gives
every pair of concurrent ops from different devices a deterministic, consistent
order across all replicas — the foundation of Last-Writer-Wins (LWW).

## Sync Cursor

The client remembers a **server sequence number** (an integer, not a timestamp).
The server assigns a strictly-monotonic `seq` to every op on ingest.

```
cursor = 0              # initial (never synced)
GET /sync/pull?since=42 # request ops after seq 42
→ { ops: [...], nextCursor: "67" | null }
```

The client persists the cursor after each successfully processed page. If sync
is interrupted mid-pull, the client resumes from its last saved cursor without
re-processing ops.

## Push/Pull Sequence

```
Client                           Server
  │                                │
  │ POST /sync/push                │
  │ { deviceId, ops: [...] }  ─────▶
  │                                │ write to ops table
  │                                │ apply to real tables (same tx)
  │ ◀───── { acks: [...] }         │
  │        accepted/rejected       │
  │        /duplicate per op       │
  │                                │
  │ GET /sync/pull?since=<cursor>  │
  │ ──────────────────────────────▶│
  │                                │ SELECT ops WHERE seq > cursor
  │ ◀───── { ops, nextCursor }     │
  │ apply ops to local store       │
  │ advance cursor, save it        │
```

## Conflict Resolution

### Field-Level LWW (F841)

Each field update carries a `(lamport, deviceId)` pair. The winner is chosen by:

```
compareLamport(a, b) =
  if a.lamport ≠ b.lamport: a.lamport - b.lamport
  else: a.deviceId < b.deviceId ? -1 : 1
```

Higher lamport wins. On a tie, higher `deviceId` (lexicographic) wins. This
tiebreak is arbitrary but deterministic — all replicas choose the same winner.

### Note Body Conflicts (F842, F843)

When both local and remote have changed the note body since a common ancestor:

1. **3-way line-diff merge**: if the edit regions don't overlap → clean merge.
2. **Conflict copy**: if edits overlap and differ → create a conflict copy note
   with a `(conflict-DEVICE)` suffix. Both versions are preserved.

### Tombstone Handling (F846)

Delete-vs-concurrent-update policy:

- If `delete.lamport >= update.lamport` → tombstone wins (note stays deleted).
- If `update.lamport > delete.lamport` → update wins (note is un-deleted with conflict banner).

### Save-Slot Conflicts (F847)

When two devices write to the same save slot name for the same story with
conflicting states → keep both, tagged with device labels:

- `autosave (iPhone)`
- `autosave (MacBook)`

## Op Compaction (F836)

Old ops are periodically squashed into **per-entity snapshots**:

```sql
INSERT INTO op_snapshots (entity_id, domain, through_lamport, through_seq, payload)
VALUES (?, ?, ?, ?, ?);
DELETE FROM ops WHERE entity_id = ? AND seq <= ?;
```

**Compaction threshold**: entities with ≥ 10 ops, all older than 1000 seqs behind
the current head, are candidates.

After compaction, a fresh client re-hydratin uses:

1. The snapshot as the initial state.
2. Any ops after `through_seq` as incremental updates.

## Resumable Syncs (F837)

The client saves the cursor **after each successful pull page**. If the connection
drops mid-pull, the next sync cycle resumes from the last saved cursor. No op is
applied twice; no op is lost.

## Exponential Backoff (F861)

On failure, the client waits:

```
delay = min(base * 2^(attempt-1), maxMs) * (1 ± jitter)
```

Default: base=1s, max=60s, jitter=30%. With 3 consecutive failures:

- attempt 1: ~1s
- attempt 2: ~2s
- attempt 3: ~4s

## Corrupt Op Quarantine (F864)

An op that is rejected 3+ times by the server is moved to a quarantine list and
never retried. It remains inspectable in the sync health panel.

## Schema Version Negotiation (F865)

Every push/pull includes `serverSchemaVersion` (from server) and `schemaVersion`
(from client). The server rejects clients below `MIN_SUPPORTED_CLIENT_VERSION = 1`.

```
GET /sync/schema → { serverSchemaVersion: 1, minSupportedClientVersion: 1, compatible: true }
```

## Data Integrity Checksums (F867)

```
GET /sync/checksum → { checksums: [{ table, rowCount, checksum }] }
```

The checksum is an XOR-folded FNV-32 hash of all entity IDs (order-independent).
Clients compute the same locally and diff to detect divergence requiring re-hydration.

## Forced Re-Hydration (F868)

When local state is corrupt or missing:

```
POST /sync/rehydrate { deviceId, tables: ["notes", "entities", "story_saves"] }
→ { ops: [...all ops for those domains...], count, rehydratedAt }
```

The client clears its local store and replays the full op-log from seq=0.

## Device Registry (F838)

Every `push` auto-registers the `deviceId`. Devices can be named:

```
PUT /sync/devices/:id { name: "iPhone 15" }
GET /sync/devices → [{ deviceId, name, lastSyncAt, lastSeenAt, createdAt }]
```

## Op Schema (F835)

Every op has:

```typescript
interface SyncOp {
  id: string; // idempotency key: `${deviceId}_${lamport}`
  deviceId: string;
  lamport: number;
  schemaVersion: number;
  clientCreatedAt: string; // ISO timestamp (display only)
  domain: 'note' | 'entity' | 'save_slot';
  opType: 'create' | 'update' | 'delete' | 'restore' | 'upsert';
  entityId: string; // the note/entity/slot being operated on
  payload: object; // domain+opType specific fields
}
```

Per-domain payloads:

| Domain    | opType  | Payload fields                         |
| --------- | ------- | -------------------------------------- |
| note      | create  | notebookId, title, body, pinned?       |
| note      | update  | title?, body?, pinned?, notebookId?    |
| note      | delete  | noteId, hard                           |
| note      | restore | noteId                                 |
| entity    | create  | type, name, fields, body?              |
| entity    | update  | type?, name?, fields?, body?           |
| entity    | delete  | entityId                               |
| save_slot | upsert  | storyId, slotName, state, deviceLabel? |
| save_slot | delete  | slotId                                 |

## API Endpoints

| Method | Path              | Description              |
| ------ | ----------------- | ------------------------ |
| GET    | /sync/pull        | Pull ops since cursor    |
| POST   | /sync/push        | Push op batch            |
| POST   | /sync/compact     | Trigger compaction       |
| GET    | /sync/devices     | List devices             |
| PUT    | /sync/devices/:id | Register/rename device   |
| GET    | /sync/health      | Sync health summary      |
| GET    | /sync/checksum    | Per-table checksums      |
| POST   | /sync/rehydrate   | Forced full re-hydration |
| GET    | /sync/schema      | Schema version info      |
