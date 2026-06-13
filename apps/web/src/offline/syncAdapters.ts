/**
 * IDB ↔ SyncEngine adapters (F834/F837).
 *
 * Bridges the gap between:
 *  - IndexedDB outboxStore (OutboxEntry)  ↔  Outbox interface
 *  - IndexedDB notes/entities stores      ↔  LocalStore interface
 *  - IndexedDB kvStore                    ↔  CursorStorage interface
 *
 * DeviceId persistence: stored in the kv store under KV_DEVICE_ID, generated
 * once with makeDeviceId(crypto.randomUUID()) on first use.
 *
 * `pnpm install` creates the workspace symlink these remain valid.
 */

import type {
  CursorStorage,
  LocalStore,
  Outbox,
  NoteRow,
  EntityRow,
  SaveSlotRow,
} from '@fables/sync';
import { makeDeviceId } from '@fables/sync';
import type { SyncOp, DeviceId } from '@fables/sync';
import type { IdbNote, IdbEntity, OutboxResource, OutboxOp } from './idb.js';
import { outboxStore, notesStore, entitiesStore, kvStore } from './idb.js';

export const KV_DEVICE_ID = 'sync:deviceId';
export const KV_SYNC_CURSOR = 'sync:cursor';

// ── Device ID ──────────────────────────────────────────────────────────────────

/** Retrieve (or generate + persist) a stable per-browser deviceId. */
export async function getOrCreateDeviceId(): Promise<DeviceId> {
  const stored = await kvStore.get<string>(KV_DEVICE_ID);
  if (stored) return makeDeviceId(stored);
  const fresh = crypto.randomUUID();
  await kvStore.set(KV_DEVICE_ID, fresh);
  return makeDeviceId(fresh);
}

// ── CursorStorage ──────────────────────────────────────────────────────────────

/**
 * In-memory CursorStorage backed by IDB kv.
 * Call `init()` after construction to hydrate the in-memory value.
 */
export class IdbCursorStorage implements CursorStorage {
  private seq = 0;

  async init(): Promise<void> {
    const stored = await kvStore.get<number>(KV_SYNC_CURSOR);
    if (stored !== undefined && stored !== null) {
      this.seq = stored;
    }
  }

  load(): number {
    return this.seq;
  }

  save(serverSeq: number): void {
    this.seq = serverSeq;
    // Fire-and-forget persist — failure is non-fatal (cursor will re-pull a
    // small window of already-applied ops on next start, which is idempotent).
    void kvStore.set(KV_SYNC_CURSOR, serverSeq);
  }
}

// ── Outbox adapter ─────────────────────────────────────────────────────────────

/**
 * Outbox adapter: bridges IDB outboxStore entries to the sync engine's SyncOp outbox.
 *
 * Sync ops enqueued via this adapter are stored in IDB with:
 *   resource: the op's domain mapped to a resource string
 *   op: 'create'|'patch'|'delete' (from opType)
 *   resourceId: entityId
 *   payload: the full SyncOp serialized under IDB_OP_MARKER
 *
 * The IDB_OP_MARKER distinguishes engine-owned ops from legacy REST outbox entries.
 */
const IDB_OP_MARKER = '__syncOp';

export class IdbOutbox implements Outbox {
  private pending_: SyncOp[] = [];
  private quarantined_: Array<{ op: SyncOp; reason: string }> = [];
  private quarantinedIds = new Set<string>();

  /** Load pending sync ops from IDB into memory. Call before first sync. */
  async hydrate(): Promise<void> {
    const entries = await outboxStore.list('pending');
    this.pending_ = entries
      .filter((e) => hasSyncOpMarker(e.payload))
      .map((e) => (e.payload as { [key: string]: SyncOp })[IDB_OP_MARKER]!);
  }

  enqueue(op: SyncOp): void {
    if (this.quarantinedIds.has(op.id)) return;
    this.pending_.push(op);
    // Persist to IDB (fire-and-forget)
    const domainToResource: Record<string, OutboxResource> = {
      note: 'notes',
      entity: 'entities',
      save_slot: 'stories',
    };
    const opToOutboxOp: Record<string, OutboxOp> = {
      create: 'create',
      update: 'patch',
      delete: 'delete',
      restore: 'patch',
      upsert: 'create',
    };
    void outboxStore.enqueue(
      domainToResource[op.domain] ?? 'notes',
      opToOutboxOp[op.opType] ?? 'patch',
      op.entityId,
      { [IDB_OP_MARKER]: op } as unknown as Record<string, unknown>,
    );
  }

  pending(): SyncOp[] {
    return this.pending_.filter((o) => !this.quarantinedIds.has(o.id));
  }

  acknowledge(opIds: string[]): void {
    const ids = new Set(opIds);
    this.pending_ = this.pending_.filter((o) => !ids.has(o.id));
    void this._deleteAcknowledged(ids);
  }

  quarantine(opId: string, reason: string): void {
    const idx = this.pending_.findIndex((o) => o.id === opId);
    if (idx !== -1) {
      const op = this.pending_[idx];
      if (op) {
        this.quarantined_.push({ op, reason });
        this.quarantinedIds.add(opId);
        this.pending_.splice(idx, 1);
      }
    }
  }

  quarantined(): Array<{ op: SyncOp; reason: string }> {
    return this.quarantined_;
  }

  private async _deleteAcknowledged(ids: Set<string>): Promise<void> {
    const entries = await outboxStore.list('pending');
    for (const e of entries) {
      if (hasSyncOpMarker(e.payload)) {
        const op = (e.payload as { [key: string]: SyncOp })[IDB_OP_MARKER];
        if (op && ids.has(op.id)) {
          await outboxStore.delete(e.id);
        }
      }
    }
  }
}

function hasSyncOpMarker(payload: unknown): boolean {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    IDB_OP_MARKER in (payload as Record<string, unknown>)
  );
}

// ── LocalStore adapter ─────────────────────────────────────────────────────────

/**
 * LocalStore adapter: wraps IDB note/entity stores.
 *
 * Keeps an in-memory snapshot for synchronous reads (as required by LocalStore).
 * Writes are flushed to IDB asynchronously (fire-and-forget).
 *
 * Call `hydrate()` before first sync to warm the memory snapshot.
 */
export class IdbLocalStore implements LocalStore {
  private notes = new Map<string, NoteRow>();
  private entities = new Map<string, EntityRow>();
  private saveSlots = new Map<string, SaveSlotRow>();

  async hydrate(): Promise<void> {
    const [notes, entities] = await Promise.all([notesStore.list(), entitiesStore.list()]);
    for (const n of notes) {
      this.notes.set(n.id, idbNoteToRow(n));
    }
    for (const e of entities) {
      this.entities.set(e.id, idbEntityToRow(e));
    }
  }

  // Notes
  getNote(id: string): NoteRow | null {
    return this.notes.get(id) ?? null;
  }

  upsertNote(row: NoteRow): void {
    this.notes.set(row.id, row);
    void notesStore.put(noteRowToIdb(row));
  }

  deleteNote(id: string, hard: boolean): void {
    if (hard) {
      this.notes.delete(id);
      void notesStore.delete(id);
    } else {
      const n = this.notes.get(id);
      if (n) {
        const updated = { ...n, trashedAt: new Date().toISOString() };
        this.notes.set(id, updated);
        void notesStore.put(noteRowToIdb(updated));
      }
    }
  }

  // Entities
  getEntity(id: string): EntityRow | null {
    return this.entities.get(id) ?? null;
  }

  upsertEntity(row: EntityRow): void {
    this.entities.set(row.id, row);
    void entitiesStore.put(entityRowToIdb(row));
  }

  deleteEntity(id: string): void {
    const e = this.entities.get(id);
    if (e) {
      const updated = { ...e, deletedAt: new Date().toISOString() };
      this.entities.set(id, updated);
      void entitiesStore.put(entityRowToIdb(updated));
    }
  }

  // Save slots (no IDB store yet — in-memory only)
  getSaveSlot(id: string): SaveSlotRow | null {
    return this.saveSlots.get(id) ?? null;
  }

  upsertSaveSlot(row: SaveSlotRow): void {
    this.saveSlots.set(row.id, row);
  }

  deleteSaveSlot(id: string): void {
    const s = this.saveSlots.get(id);
    if (s) {
      this.saveSlots.set(id, { ...s, deletedAt: new Date().toISOString() });
    }
  }

  // Checksum support
  allNoteIds(): string[] {
    return [...this.notes.keys()];
  }
  allEntityIds(): string[] {
    return [...this.entities.keys()];
  }
  allSaveSlotIds(): string[] {
    return [...this.saveSlots.keys()];
  }
}

// ── IDB ↔ store row conversions ───────────────────────────────────────────────

function idbNoteToRow(n: IdbNote): NoteRow {
  return {
    id: n.id,
    notebookId: n.notebookId,
    title: n.title,
    body: n.body,
    pinned: n.pinned,
    trashedAt: n.trashedAt,
    updatedAt: n.updatedAt,
    rev: n.rev,
  };
}

function noteRowToIdb(row: NoteRow): IdbNote {
  return {
    id: row.id,
    notebookId: row.notebookId,
    title: row.title,
    body: row.body,
    pinned: row.pinned,
    trashedAt: row.trashedAt,
    createdAt: row.updatedAt, // approximation — create not tracked in NoteRow
    updatedAt: row.updatedAt,
    rev: row.rev,
    _syncedAt: Date.now(),
  };
}

function idbEntityToRow(e: IdbEntity): EntityRow {
  return {
    id: e.id,
    type: e.type,
    name: e.name,
    fields: e.fields,
    body: '',
    deletedAt: null,
    updatedAt: e.updatedAt,
  };
}

function entityRowToIdb(row: EntityRow): IdbEntity {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    aliases: [],
    fields: row.fields,
    noteId: null,
    createdAt: row.updatedAt,
    updatedAt: row.updatedAt,
    _syncedAt: Date.now(),
  };
}
