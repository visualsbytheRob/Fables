/**
 * LocalStore interface — the sync engine never calls a real database directly.
 * It operates on this injected abstraction, keeping the engine pure and
 * independently testable (F834).
 *
 * Implementations:
 *   - In tests: an in-memory map.
 *   - In the web client: a Dexie/IndexedDB adapter (F821).
 *   - In the server: a SQLite adapter used for convergence property tests.
 */

import type { SyncOp } from './types.js';

export interface NoteRow {
  id: string;
  notebookId: string;
  title: string;
  body: string;
  pinned: boolean;
  trashedAt: string | null;
  updatedAt: string;
  rev: number;
}

export interface EntityRow {
  id: string;
  type: string;
  name: string;
  fields: Record<string, unknown>;
  body: string;
  deletedAt: string | null;
  updatedAt: string;
}

export interface SaveSlotRow {
  id: string;
  storyId: string;
  slotName: string;
  state: Record<string, unknown>;
  deviceLabel: string | null;
  deletedAt: string | null;
  updatedAt: string;
}

/** Abstract local key-value store for the sync engine. */
export interface LocalStore {
  // Notes
  getNote(id: string): NoteRow | null;
  upsertNote(row: NoteRow): void;
  deleteNote(id: string, hard: boolean): void;

  // Entities
  getEntity(id: string): EntityRow | null;
  upsertEntity(row: EntityRow): void;
  deleteEntity(id: string): void;

  // Save slots
  getSaveSlot(id: string): SaveSlotRow | null;
  upsertSaveSlot(row: SaveSlotRow): void;
  deleteSaveSlot(id: string): void;

  /** Raw table access for checksum computation (F867). */
  allNoteIds(): string[];
  allEntityIds(): string[];
  allSaveSlotIds(): string[];
}

/** Cursor storage — separate interface so tests can inject in-memory versions. */
export interface CursorStorage {
  load(): number; // returns serverSeq, 0 if not set
  save(serverSeq: number): void;
}

/** Outbox: local ops not yet pushed to the server. */
export interface Outbox {
  /** Add a new local op to the outbox. */
  enqueue(op: SyncOp): void;
  /** Return all pending ops in creation order. */
  pending(): SyncOp[];
  /** Remove ops that the server acknowledged. */
  acknowledge(opIds: string[]): void;
  /** Move a corrupt op to quarantine instead of retrying it (F864). */
  quarantine(opId: string, reason: string): void;
  /** Return quarantined ops for inspection. */
  quarantined(): Array<{ op: SyncOp; reason: string }>;
}

// ── In-memory implementations for tests ───────────────────────────────────────

export class MemoryStore implements LocalStore {
  private notes = new Map<string, NoteRow>();
  private entities = new Map<string, EntityRow>();
  private saveSlots = new Map<string, SaveSlotRow>();

  getNote(id: string): NoteRow | null {
    return this.notes.get(id) ?? null;
  }
  upsertNote(row: NoteRow): void {
    this.notes.set(row.id, row);
  }
  deleteNote(id: string, hard: boolean): void {
    if (hard) {
      this.notes.delete(id);
    } else {
      const n = this.notes.get(id);
      if (n) this.notes.set(id, { ...n, trashedAt: new Date().toISOString() });
    }
  }

  getEntity(id: string): EntityRow | null {
    return this.entities.get(id) ?? null;
  }
  upsertEntity(row: EntityRow): void {
    this.entities.set(row.id, row);
  }
  deleteEntity(id: string): void {
    const e = this.entities.get(id);
    if (e) this.entities.set(id, { ...e, deletedAt: new Date().toISOString() });
  }

  getSaveSlot(id: string): SaveSlotRow | null {
    return this.saveSlots.get(id) ?? null;
  }
  upsertSaveSlot(row: SaveSlotRow): void {
    this.saveSlots.set(row.id, row);
  }
  deleteSaveSlot(id: string): void {
    const s = this.saveSlots.get(id);
    if (s) this.saveSlots.set(id, { ...s, deletedAt: new Date().toISOString() });
  }

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

export class MemoryCursorStorage implements CursorStorage {
  private seq = 0;
  load(): number {
    return this.seq;
  }
  save(serverSeq: number): void {
    this.seq = serverSeq;
  }
}

export class MemoryOutbox implements Outbox {
  private ops: SyncOp[] = [];
  private quarantined_: Array<{ op: SyncOp; reason: string }> = [];
  private quarantinedIds = new Set<string>();

  enqueue(op: SyncOp): void {
    if (!this.quarantinedIds.has(op.id)) {
      this.ops.push(op);
    }
  }

  pending(): SyncOp[] {
    return this.ops.filter((o) => !this.quarantinedIds.has(o.id));
  }

  acknowledge(opIds: string[]): void {
    const ids = new Set(opIds);
    this.ops = this.ops.filter((o) => !ids.has(o.id));
  }

  quarantine(opId: string, reason: string): void {
    const idx = this.ops.findIndex((o) => o.id === opId);
    if (idx !== -1) {
      const op = this.ops[idx];
      if (op) {
        this.quarantined_.push({ op, reason });
        this.quarantinedIds.add(opId);
        this.ops.splice(idx, 1);
      }
    }
  }

  quarantined(): Array<{ op: SyncOp; reason: string }> {
    return this.quarantined_;
  }
}
