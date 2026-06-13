import {
  conflict,
  newNoteId,
  notFound,
  nowIso,
  validation,
  type Note,
  type NotebookId,
  type NoteId,
} from '@fables/core';
import type { Db } from '../connection.js';

export type NoteSort = 'updated' | 'created' | 'title';

const ORDERINGS: Record<NoteSort, { column: keyof Row & string; dir: 'ASC' | 'DESC' }> = {
  updated: { column: 'updated_at', dir: 'DESC' },
  created: { column: 'created_at', dir: 'DESC' },
  title: { column: 'title', dir: 'ASC' },
};

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
        .prepare(
          'UPDATE notes SET trashed_at = ?, rev = rev + 1 WHERE id = ? AND trashed_at IS NULL',
        )
        .run(nowIso(), id).changes;
      if (changed === 0) throw notFound('Note', id);
    },

    restore(id: NoteId): void {
      const changed = db
        .prepare(
          'UPDATE notes SET trashed_at = NULL, rev = rev + 1 WHERE id = ? AND trashed_at IS NOT NULL',
        )
        .run(id).changes;
      if (changed === 0) throw notFound('Note', id);
    },

    /**
     * Keyset-paginated listing of live notes (F103). `fetch` is the row count to
     * return (callers pass `limit + 1` for next-page detection); `cursor` is the
     * id of the last row of the previous page.
     */
    list(opts: {
      sort: NoteSort;
      fetch: number;
      cursor: string | null;
      notebookId?: NotebookId;
    }): Note[] {
      const { column, dir } = ORDERINGS[opts.sort];
      const where: string[] = ['trashed_at IS NULL'];
      const args: unknown[] = [];
      if (opts.notebookId !== undefined) {
        where.push('notebook_id = ?');
        args.push(opts.notebookId);
      }
      if (opts.cursor !== null) {
        const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(opts.cursor) as
          | Row
          | undefined;
        if (!row) throw validation('unknown cursor', { cursor: opts.cursor });
        const cmp = dir === 'DESC' ? '<' : '>';
        where.push(`(${column} ${cmp} ? OR (${column} = ? AND id ${cmp} ?))`);
        args.push(row[column], row[column], row.id);
      }
      const sql = `SELECT * FROM notes WHERE ${where.join(' AND ')}
                   ORDER BY ${column} ${dir}, id ${dir} LIMIT ?`;
      return (db.prepare(sql).all(...args, opts.fetch) as Row[]).map(toNote);
    },

    /** Trash listing (F107), newest-trashed first, same cursor convention as `list`. */
    listTrashed(opts: { fetch: number; cursor: string | null }): Note[] {
      const where: string[] = ['trashed_at IS NOT NULL'];
      const args: unknown[] = [];
      if (opts.cursor !== null) {
        const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(opts.cursor) as
          | Row
          | undefined;
        if (!row || row.trashed_at === null)
          throw validation('unknown cursor', { cursor: opts.cursor });
        where.push('(trashed_at < ? OR (trashed_at = ? AND id < ?))');
        args.push(row.trashed_at, row.trashed_at, row.id);
      }
      const sql = `SELECT * FROM notes WHERE ${where.join(' AND ')}
                   ORDER BY trashed_at DESC, id DESC LIMIT ?`;
      return (db.prepare(sql).all(...args, opts.fetch) as Row[]).map(toNote);
    },

    /**
     * Hard-deletes trashed notes (F107). With `olderThan` only notes trashed
     * before that ISO timestamp are purged; without it the whole trash empties.
     * Revisions and tag links cascade; attachments lose their note link.
     */
    purgeTrashed(opts: { olderThan?: string } = {}): number {
      if (opts.olderThan !== undefined) {
        return db
          .prepare('DELETE FROM notes WHERE trashed_at IS NOT NULL AND trashed_at < ?')
          .run(opts.olderThan).changes;
      }
      return db.prepare('DELETE FROM notes WHERE trashed_at IS NOT NULL').run().changes;
    },

    listByNotebook(notebookId: NotebookId, opts: { includeTrashed?: boolean } = {}): Note[] {
      const sql = opts.includeTrashed
        ? 'SELECT * FROM notes WHERE notebook_id = ? ORDER BY updated_at DESC'
        : 'SELECT * FROM notes WHERE notebook_id = ? AND trashed_at IS NULL ORDER BY updated_at DESC';
      return (db.prepare(sql).all(notebookId) as Row[]).map(toNote);
    },

    /** Oldest live note with this exact title in a notebook — daily-note lookup (F631). */
    findLiveByTitle(notebookId: NotebookId, title: string): Note | null {
      const row = db
        .prepare(
          `SELECT * FROM notes WHERE notebook_id = ? AND title = ? AND trashed_at IS NULL
           ORDER BY id LIMIT 1`,
        )
        .get(notebookId, title) as Row | undefined;
      return row ? toNote(row) : null;
    },

    count(): number {
      return (db.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }).n;
    },

    /**
     * Title index for link resolution and mention detection (F221, F228):
     * every save reads titles only — never note bodies.
     */
    listTitles(): { id: NoteId; title: string }[] {
      const rows = db
        .prepare(`SELECT id, title FROM notes WHERE trashed_at IS NULL AND title != '' ORDER BY id`)
        .all() as { id: string; title: string }[];
      return rows.map((r) => ({ id: r.id as NoteId, title: r.title }));
    },

    /**
     * Candidate sources containing `needleLc` as a substring (ASCII
     * case-folded prefilter; the unicode-aware matcher confirms hits in JS).
     * This is the only body scan in the linking pipeline and runs solely on
     * title create/rename — never on plain body saves (F228).
     */
    idsWithBodyContaining(needleLc: string): NoteId[] {
      const rows = db
        .prepare(
          `SELECT id FROM notes WHERE trashed_at IS NULL AND instr(lower(body), ?) > 0 ORDER BY id`,
        )
        .all(needleLc) as { id: string }[];
      return rows.map((r) => r.id as NoteId);
    },

    /** Graph node metadata for live notes, with optional filters (F231, F232). */
    listGraphMeta(filter: { notebookId?: NotebookId; tagId?: string; since?: string } = {}): {
      id: NoteId;
      title: string;
      notebookId: NotebookId;
      updatedAt: string;
    }[] {
      const where: string[] = ['n.trashed_at IS NULL'];
      const args: unknown[] = [];
      if (filter.notebookId !== undefined) {
        where.push('n.notebook_id = ?');
        args.push(filter.notebookId);
      }
      if (filter.since !== undefined) {
        where.push('n.updated_at >= ?');
        args.push(filter.since);
      }
      if (filter.tagId !== undefined) {
        where.push('EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = n.id AND nt.tag_id = ?)');
        args.push(filter.tagId);
      }
      const rows = db
        .prepare(
          `SELECT n.id, n.title, n.notebook_id, n.updated_at FROM notes n
           WHERE ${where.join(' AND ')} ORDER BY n.id`,
        )
        .all(...args) as { id: string; title: string; notebook_id: string; updated_at: string }[];
      return rows.map((r) => ({
        id: r.id as NoteId,
        title: r.title,
        notebookId: r.notebook_id as NotebookId,
        updatedAt: r.updated_at,
      }));
    },
  };
}

export type NotesRepo = ReturnType<typeof notesRepo>;
