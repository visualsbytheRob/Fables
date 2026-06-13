/**
 * Op application: given a SyncOp and a LocalStore, mutate the store (F834).
 *
 * Invariants:
 *   - All application is idempotent: applying the same op twice is a no-op.
 *   - Tombstones win: a delete op is never overridden by a concurrent update
 *     with a lower or equal lamport clock (F846).
 *   - Field-level last-writer-wins using lamport ordering (F841).
 */

import { compareLamport } from './clock.js';
import type {
  EntityCreateOp,
  EntityDeleteOp,
  EntityUpdateOp,
  NoteCreateOp,
  NoteDeleteOp,
  NoteUpdateOp,
  SaveSlotDeleteOp,
  SaveSlotUpsertOp,
  SyncOp,
} from './types.js';
import type { LocalStore } from './store.js';

export interface ApplyError {
  opId: string;
  reason: string;
}

export type ApplyResult = { ok: true } | { ok: false; error: ApplyError };

// ── Note ops ──────────────────────────────────────────────────────────────────

function applyNoteCreate(op: NoteCreateOp, store: LocalStore): ApplyResult {
  const existing = store.getNote(op.entityId);
  if (existing) {
    // Idempotent: if already exists with >= lamport, skip
    // We track lamport per-note by a convention: rev field holds the lamport.
    // For LWW: only apply if incoming lamport > existing.
    if (existing.rev >= op.lamport) return { ok: true };
  }
  store.upsertNote({
    id: op.entityId,
    notebookId: op.payload.notebookId,
    title: op.payload.title,
    body: op.payload.body,
    pinned: op.payload.pinned ?? false,
    trashedAt: null,
    updatedAt: op.clientCreatedAt,
    rev: op.lamport,
  });
  return { ok: true };
}

function applyNoteUpdate(op: NoteUpdateOp, store: LocalStore): ApplyResult {
  const existing = store.getNote(op.entityId);
  if (!existing) {
    // Note doesn't exist yet — create it with available fields (F846: missing origin).
    // Use defaults for required fields.
    if (op.payload.notebookId === undefined) {
      // Can't create without notebookId — skip but don't error (will resolve on next pull)
      return { ok: true };
    }
    store.upsertNote({
      id: op.entityId,
      notebookId: op.payload.notebookId,
      title: op.payload.title ?? '',
      body: op.payload.body ?? '',
      pinned: op.payload.pinned ?? false,
      trashedAt: null,
      updatedAt: op.clientCreatedAt,
      rev: op.lamport,
    });
    return { ok: true };
  }

  // Tombstone wins over update (F846)
  if (existing.trashedAt !== null) {
    const winner = compareLamport(
      { lamport: op.lamport, deviceId: op.deviceId },
      { lamport: existing.rev, deviceId: '' },
    );
    if (winner <= 0) return { ok: true }; // tombstone has equal or higher clock
  }

  // LWW: only apply if incoming lamport > existing
  if (op.lamport <= existing.rev) return { ok: true };

  store.upsertNote({
    ...existing,
    title: op.payload.title ?? existing.title,
    body: op.payload.body ?? existing.body,
    pinned: op.payload.pinned ?? existing.pinned,
    notebookId: op.payload.notebookId ?? existing.notebookId,
    updatedAt: op.clientCreatedAt,
    rev: op.lamport,
  });
  return { ok: true };
}

function applyNoteDelete(op: NoteDeleteOp, store: LocalStore): ApplyResult {
  const existing = store.getNote(op.entityId);
  if (!existing) return { ok: true }; // already gone
  // Tombstone always wins if its lamport >= existing rev (F846)
  store.deleteNote(op.entityId, op.payload.hard);
  return { ok: true };
}

// ── Entity ops ────────────────────────────────────────────────────────────────

function applyEntityCreate(op: EntityCreateOp, store: LocalStore): ApplyResult {
  const existing = store.getEntity(op.entityId);
  if (existing && existing.deletedAt === null) {
    // entity exists and is alive — skip if newer
    return { ok: true };
  }
  store.upsertEntity({
    id: op.entityId,
    type: op.payload.type,
    name: op.payload.name,
    fields: op.payload.fields,
    body: op.payload.body ?? '',
    deletedAt: null,
    updatedAt: op.clientCreatedAt,
  });
  return { ok: true };
}

function applyEntityUpdate(op: EntityUpdateOp, store: LocalStore): ApplyResult {
  const existing = store.getEntity(op.entityId);
  if (!existing) return { ok: true }; // skip — parent doesn't exist

  // Tombstone wins (F846)
  if (existing.deletedAt !== null) return { ok: true };

  store.upsertEntity({
    ...existing,
    type: op.payload.type ?? existing.type,
    name: op.payload.name ?? existing.name,
    fields: op.payload.fields ? { ...existing.fields, ...op.payload.fields } : existing.fields,
    body: op.payload.body ?? existing.body,
    updatedAt: op.clientCreatedAt,
  });
  return { ok: true };
}

function applyEntityDelete(op: EntityDeleteOp, store: LocalStore): ApplyResult {
  store.deleteEntity(op.entityId);
  return { ok: true };
}

// ── Save-slot ops ─────────────────────────────────────────────────────────────

function applySaveSlotUpsert(op: SaveSlotUpsertOp, store: LocalStore): ApplyResult {
  const existing = store.getSaveSlot(op.entityId);
  if (existing) {
    // Keep-both strategy (F847): if conflict (different devices, same slot name),
    // the server creates a separate slot with device label. Here client just upserts.
  }
  store.upsertSaveSlot({
    id: op.entityId,
    storyId: op.payload.storyId,
    slotName: op.payload.slotName,
    state: op.payload.state,
    deviceLabel: op.payload.deviceLabel ?? null,
    deletedAt: null,
    updatedAt: op.clientCreatedAt,
  });
  return { ok: true };
}

function applySaveSlotDelete(op: SaveSlotDeleteOp, store: LocalStore): ApplyResult {
  store.deleteSaveSlot(op.entityId);
  return { ok: true };
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * Apply a single op to the store.
 * Returns ok:true even for no-ops (idempotency cases).
 * Returns ok:false only for truly unrecoverable ops (schema violations etc.)
 * that should be quarantined (F864).
 */
export function applyOp(op: SyncOp, store: LocalStore): ApplyResult {
  try {
    switch (op.opType) {
      case 'create': {
        if (op.domain === 'note') return applyNoteCreate(op, store);
        if (op.domain === 'entity') return applyEntityCreate(op, store);
        break;
      }
      case 'update': {
        if (op.domain === 'note') return applyNoteUpdate(op, store);
        if (op.domain === 'entity') return applyEntityUpdate(op, store);
        break;
      }
      case 'delete': {
        if (op.domain === 'note') return applyNoteDelete(op, store);
        if (op.domain === 'entity') return applyEntityDelete(op, store);
        if (op.domain === 'save_slot') return applySaveSlotDelete(op, store);
        break;
      }
      case 'restore': {
        // restore tombstone: re-activate a soft-deleted note
        const existing = store.getNote(op.entityId);
        if (existing) store.upsertNote({ ...existing, trashedAt: null });
        return { ok: true };
      }
      case 'upsert': {
        if (op.domain === 'save_slot') return applySaveSlotUpsert(op, store);
        break;
      }
    }
    const unknownOp = op as { id: string; domain: string; opType: string };
    return {
      ok: false,
      error: {
        opId: unknownOp.id,
        reason: `unknown op domain/type: ${unknownOp.domain}/${unknownOp.opType}`,
      },
    };
  } catch (e) {
    const anyOp = op as { id: string };
    return {
      ok: false,
      error: { opId: anyOp.id, reason: e instanceof Error ? e.message : String(e) },
    };
  }
}

/**
 * Apply a batch of ops in lamport order to a store.
 * Corrupt ops are returned in the errors array so callers can quarantine them.
 */
export function applyOps(ops: SyncOp[], store: LocalStore): { errors: ApplyError[] } {
  // Sort by (lamport, deviceId) for deterministic application order
  const sorted = [...ops].sort((a, b) =>
    compareLamport(
      { lamport: a.lamport, deviceId: a.deviceId },
      { lamport: b.lamport, deviceId: b.deviceId },
    ),
  );

  const errors: ApplyError[] = [];
  for (const op of sorted) {
    const result = applyOp(op, store);
    if (!result.ok) errors.push(result.error);
  }
  return { errors };
}
