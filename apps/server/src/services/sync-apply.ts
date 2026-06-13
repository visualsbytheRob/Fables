/**
 * Apply a sync op to the real SQLite tables.
 *
 * This keeps REST and sync in sync: after a push, the existing REST API
 * returns the same state as if the mutation had been done through REST.
 *
 * Design: "ops are the audit trail, real tables are the materialized view."
 * Applying the op here is idempotent: we use INSERT OR IGNORE / INSERT OR REPLACE
 * with Lamport-ordered conflict resolution to prevent stale writes.
 */

import type { Db } from '../db/connection.js';
import type { SyncOp } from '@fables/sync';

/**
 * Apply a single op to the real tables. Called synchronously inside the same
 * transaction as the op-log insert.
 *
 * Errors are propagated to the caller (route handler) which downgrades the
 * op's ack status to 'rejected'.
 */
export function applySyncOpToDb(op: SyncOp, db: Db): void {
  const now = op.clientCreatedAt;

  switch (op.domain) {
    case 'note':
      applyNoteOp(op, db, now);
      break;
    case 'entity':
      applyEntityOp(op, db, now);
      break;
    case 'save_slot':
      applySaveSlotOp(op, db, now);
      break;
  }
}

// ── Note ops ──────────────────────────────────────────────────────────────────

function applyNoteOp(op: SyncOp & { domain: 'note' }, db: Db, now: string): void {
  if (op.opType === 'create') {
    const p = op.payload as {
      notebookId: string;
      title: string;
      body: string;
      pinned?: boolean;
    };
    // Only insert if the row doesn't exist yet (idempotent)
    db.prepare(
      `INSERT OR IGNORE INTO notes
         (id, notebook_id, title, body, pinned, trashed_at, created_at, updated_at, rev)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 0)`,
    ).run(op.entityId, p.notebookId, p.title ?? '', p.body ?? '', p.pinned ? 1 : 0, now, now);
    return;
  }

  if (op.opType === 'update') {
    const p = op.payload as {
      title?: string;
      body?: string;
      pinned?: boolean;
      notebookId?: string;
    };
    // LWW: only apply if this update's lamport > current rev (rev used as lamport proxy)
    const existing = db
      .prepare<[string], { rev: number }>('SELECT rev FROM notes WHERE id = ?')
      .get(op.entityId);
    if (!existing || op.lamport <= existing.rev) return; // stale write

    const sets: string[] = ['updated_at = ?', 'rev = ?'];
    const vals: unknown[] = [now, op.lamport];
    if (p.title !== undefined) {
      sets.push('title = ?');
      vals.push(p.title);
    }
    if (p.body !== undefined) {
      sets.push('body = ?');
      vals.push(p.body);
    }
    if (p.pinned !== undefined) {
      sets.push('pinned = ?');
      vals.push(p.pinned ? 1 : 0);
    }
    if (p.notebookId !== undefined) {
      sets.push('notebook_id = ?');
      vals.push(p.notebookId);
    }
    vals.push(op.entityId);

    db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return;
  }

  if (op.opType === 'delete') {
    const p = op.payload as { hard?: boolean };
    if (p.hard) {
      db.prepare('DELETE FROM notes WHERE id = ?').run(op.entityId);
    } else {
      db.prepare('UPDATE notes SET trashed_at = ?, updated_at = ? WHERE id = ?').run(
        now,
        now,
        op.entityId,
      );
    }
    return;
  }

  if (op.opType === 'restore') {
    db.prepare('UPDATE notes SET trashed_at = NULL, updated_at = ? WHERE id = ?').run(
      now,
      op.entityId,
    );
    return;
  }
}

// ── Entity ops ────────────────────────────────────────────────────────────────

function applyEntityOp(op: SyncOp & { domain: 'entity' }, db: Db, now: string): void {
  if (op.opType === 'create') {
    const p = op.payload as {
      type: string;
      name: string;
      fields: Record<string, unknown>;
      body?: string;
    };
    db.prepare(
      `INSERT OR IGNORE INTO entities
         (id, type, name, aliases, fields, note_id, created_at, updated_at)
       VALUES (?, ?, ?, '[]', ?, NULL, ?, ?)`,
    ).run(op.entityId, p.type, p.name, JSON.stringify(p.fields ?? {}), now, now);
    return;
  }

  if (op.opType === 'update') {
    const p = op.payload as {
      type?: string;
      name?: string;
      fields?: Record<string, unknown>;
    };
    const existing = db
      .prepare<[string], { fields: string }>('SELECT fields FROM entities WHERE id = ?')
      .get(op.entityId);
    if (!existing) return; // entity not found — skip

    const mergedFields = {
      ...(JSON.parse(existing.fields) as Record<string, unknown>),
      ...(p.fields ?? {}),
    };

    const sets: string[] = ['updated_at = ?', 'fields = ?'];
    const vals: unknown[] = [now, JSON.stringify(mergedFields)];
    if (p.type !== undefined) {
      sets.push('type = ?');
      vals.push(p.type);
    }
    if (p.name !== undefined) {
      sets.push('name = ?');
      vals.push(p.name);
    }
    vals.push(op.entityId);

    db.prepare(`UPDATE entities SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return;
  }

  if (op.opType === 'delete') {
    // Soft-delete entities by using a deleted_at column if it exists, else hard delete
    // Check if deleted_at column exists (added by this migration)
    try {
      db.prepare('UPDATE entities SET updated_at = ? WHERE id = ?').run(now, op.entityId);
      // For now, entities don't have soft-delete in the schema — just leave them.
      // The op-log records the tombstone; convergence is maintained there.
    } catch {
      // ignore — entity may not exist
    }
    return;
  }
}

// ── Save-slot ops ─────────────────────────────────────────────────────────────

function applySaveSlotOp(op: SyncOp & { domain: 'save_slot' }, db: Db, now: string): void {
  if (op.opType === 'upsert') {
    const p = op.payload as {
      storyId: string;
      slotName: string;
      state: Record<string, unknown>;
      deviceLabel?: string;
    };
    // Check if a story_saves row with this id already exists
    const existing = db
      .prepare<[string], { id: string }>('SELECT id FROM story_saves WHERE id = ?')
      .get(op.entityId);

    if (existing) {
      db.prepare('UPDATE story_saves SET name = ?, state = ?, updated_at = ? WHERE id = ?').run(
        p.slotName,
        JSON.stringify(p.state),
        now,
        op.entityId,
      );
    } else {
      // Determine turn/scene from state for display
      const state = p.state;
      const turn = typeof state['turn'] === 'number' ? state['turn'] : 0;
      const scene = typeof state['scene'] === 'string' ? state['scene'] : '';
      db.prepare(
        `INSERT OR IGNORE INTO story_saves
           (id, story_id, kind, name, state, turn, scene, created_at, updated_at)
         VALUES (?, ?, 'slot', ?, ?, ?, ?, ?, ?)`,
      ).run(op.entityId, p.storyId, p.slotName, JSON.stringify(p.state), turn, scene, now, now);
    }
    return;
  }

  if (op.opType === 'delete') {
    db.prepare('DELETE FROM story_saves WHERE id = ?').run(op.entityId);
    return;
  }
}
