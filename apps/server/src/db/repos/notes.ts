import {
  conflict,
  newNoteId,
  notFound,
  nowIso,
  type Note,
  type NotebookId,
  type NoteId,
} from '@fables/core';
import type { Db } from '../connection.js';

interface Row {
  id: string;
  notebook_id: string;
  title: string;
  body: string;
  pinned: number;
  trashed_at: string | null;
  created_at: string;
  updated_at: string;
  rev: number;
}

function toNote(row: Row): Note {
  return {
    id: row.id as NoteId,
    notebookId: row.notebook_id as NotebookId,
    title: row.title,
    body: row.body,
    pinned: row.pinned === 1,
    trashedAt: row.trashed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rev: row.rev,
  };
}

export function notesRepo(db: Db) {
  return {
    create(input: { notebookId: NotebookId; title?: string; body?: string }): Note {
      const now = nowIso();
      const note: Note = {
        id: newNoteId(),
        notebookId: input.notebookId,
        title: input.title ?? '',
        body: input.body ?? '',
        pinned: false,
        trashedAt: null,
        createdAt: now,
        updatedAt: now,
        rev: 0,
      };
      db.prepare(
        `INSERT INTO notes (id, notebook_id, title, body, pinned, trashed_at, created_at, updated_at, rev)
         VALUES (?, ?, ?, ?, 0, NULL, ?, ?, 0)`,
      ).run(note.id, note.notebookId, note.title, note.body, note.createdAt, note.updatedAt);
      return note;
    },

    get(id: NoteId): Note | null {
      const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as Row | undefined;
      return row ? toNote(row) : null;
    },

    /**
     * Optimistic-concurrency update: fails with CONFLICT if `expectedRev`
     * doesn't match the stored revision.
     */
    update(
      id: NoteId,
      expectedRev: number,
      patch: Partial<Pick<Note, 'title' | 'body' | 'pinned' | 'notebookId'>>,
    ): Note {
      const current = this.get(id);
      if (!current) throw notFound('Note', id);
      if (current.rev !== expectedRev) {
        throw conflict('note was modified by another writer', {
          expectedRev,
          actualRev: current.rev,
        });
      }
      const next = { ...current, ...patch, updatedAt: nowIso(), rev: current.rev + 1 };
      db.prepare(
        `UPDATE notes SET notebook_id = ?, title = ?, body = ?, pinned = ?, updated_at = ?, rev = ?
         WHERE id = ? AND rev = ?`,
      ).run(
        next.notebookId,
        next.title,
        next.body,
        next.pinned ? 1 : 0,
        next.updatedAt,
        next.rev,
        id,
        expectedRev,
      );
      return next;
    },

    trash(id: NoteId): void {
      const changed = db
        .prepare('UPDATE notes SET trashed_at = ?, rev = rev + 1 WHERE id = ? AND trashed_at IS NULL')
        .run(nowIso(), id).changes;
      if (changed === 0) throw notFound('Note', id);
    },

    restore(id: NoteId): void {
      const changed = db
        .prepare('UPDATE notes SET trashed_at = NULL, rev = rev + 1 WHERE id = ? AND trashed_at IS NOT NULL')
        .run(id).changes;
      if (changed === 0) throw notFound('Note', id);
    },

    listByNotebook(notebookId: NotebookId, opts: { includeTrashed?: boolean } = {}): Note[] {
      const sql = opts.includeTrashed
        ? 'SELECT * FROM notes WHERE notebook_id = ? ORDER BY updated_at DESC'
        : 'SELECT * FROM notes WHERE notebook_id = ? AND trashed_at IS NULL ORDER BY updated_at DESC';
      return (db.prepare(sql).all(notebookId) as Row[]).map(toNote);
    },

    count(): number {
      return (db.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }).n;
    },
  };
}

export type NotesRepo = ReturnType<typeof notesRepo>;
