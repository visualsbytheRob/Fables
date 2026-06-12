import {
  conflict,
  newNotebookId,
  notFound,
  nowIso,
  validation,
  type Notebook,
  type NotebookId,
} from '@fables/core';
import type { Db } from '../connection.js';

interface Row {
  id: string;
  parent_id: string | null;
  name: string;
  icon: string | null;
  color: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
}

function toNotebook(row: Row): Notebook {
  return {
    id: row.id as NotebookId,
    parentId: row.parent_id as NotebookId | null,
    name: row.name,
    icon: row.icon,
    color: row.color,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function notebooksRepo(db: Db) {
  /** Walks the parent chain from `startId`; true when `targetId` appears (cycle guard, F150). */
  function chainContains(startId: NotebookId, targetId: NotebookId): boolean {
    let cursor: string | null = startId;
    const seen = new Set<string>();
    while (cursor !== null && !seen.has(cursor)) {
      if (cursor === targetId) return true;
      seen.add(cursor);
      const row = db.prepare('SELECT parent_id FROM notebooks WHERE id = ?').get(cursor) as
        | { parent_id: string | null }
        | undefined;
      cursor = row?.parent_id ?? null;
    }
    return false;
  }

  return {
    create(input: {
      name: string;
      parentId?: NotebookId | null;
      icon?: string | null;
      color?: string | null;
    }): Notebook {
      const parentId = input.parentId ?? null;
      if (parentId !== null && !this.get(parentId)) throw notFound('Notebook', parentId);
      const now = nowIso();
      const notebook: Notebook = {
        id: newNotebookId(),
        parentId,
        name: input.name,
        icon: input.icon ?? null,
        color: input.color ?? null,
        archived: false,
        createdAt: now,
        updatedAt: now,
      };
      db.prepare(
        `INSERT INTO notebooks (id, parent_id, name, icon, color, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        notebook.id,
        notebook.parentId,
        notebook.name,
        notebook.icon,
        notebook.color,
        0,
        notebook.createdAt,
        notebook.updatedAt,
      );
      return notebook;
    },

    get(id: NotebookId): Notebook | null {
      const row = db.prepare('SELECT * FROM notebooks WHERE id = ?').get(id) as Row | undefined;
      return row ? toNotebook(row) : null;
    },

    /** Archived notebooks are hidden from default views (F147). */
    list(opts: { includeArchived?: boolean } = {}): Notebook[] {
      const sql = opts.includeArchived
        ? 'SELECT * FROM notebooks ORDER BY name'
        : 'SELECT * FROM notebooks WHERE archived = 0 ORDER BY name';
      return (db.prepare(sql).all() as Row[]).map(toNotebook);
    },

    /** Re-parenting validates existence and refuses cycles (F141, F150). */
    update(
      id: NotebookId,
      patch: Partial<Pick<Notebook, 'name' | 'parentId' | 'icon' | 'color' | 'archived'>>,
    ): Notebook {
      const current = this.get(id);
      if (!current) throw notFound('Notebook', id);
      if (patch.parentId !== undefined && patch.parentId !== null) {
        if (patch.parentId === id) throw conflict('notebook cannot be its own parent', { id });
        if (!this.get(patch.parentId)) throw notFound('Notebook', patch.parentId);
        if (chainContains(patch.parentId, id)) {
          throw conflict('move would create a notebook cycle', { id, parentId: patch.parentId });
        }
      }
      const next: Notebook = { ...current, ...patch, updatedAt: nowIso() };
      db.prepare(
        `UPDATE notebooks SET parent_id = ?, name = ?, icon = ?, color = ?, archived = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        next.parentId,
        next.name,
        next.icon,
        next.color,
        next.archived ? 1 : 0,
        next.updatedAt,
        id,
      );
      return next;
    },

    /**
     * Deletes a notebook (F149). Its notes (including trashed ones) move to
     * `moveNotesTo`, which is required when notes exist; child notebooks are
     * re-parented to the deleted notebook's parent.
     */
    remove(
      id: NotebookId,
      opts: { moveNotesTo?: NotebookId } = {},
    ): { movedNotes: number; reparentedChildren: number } {
      const notebook = this.get(id);
      if (!notebook) throw notFound('Notebook', id);
      const noteCount = (
        db.prepare('SELECT COUNT(*) AS n FROM notes WHERE notebook_id = ?').get(id) as { n: number }
      ).n;

      let movedNotes = 0;
      if (noteCount > 0) {
        const target = opts.moveNotesTo;
        if (target === undefined) {
          throw validation('notebook still contains notes — pass ?moveNotesTo=<notebookId>', {
            id,
            noteCount,
          });
        }
        if (target === id) throw validation('cannot re-home notes into the notebook being deleted');
        if (!this.get(target)) throw notFound('Notebook', target);
        movedNotes = db
          .prepare(
            'UPDATE notes SET notebook_id = ?, updated_at = ?, rev = rev + 1 WHERE notebook_id = ?',
          )
          .run(target, nowIso(), id).changes;
      }

      const reparentedChildren = db
        .prepare('UPDATE notebooks SET parent_id = ?, updated_at = ? WHERE parent_id = ?')
        .run(notebook.parentId, nowIso(), id).changes;
      db.prepare('DELETE FROM notebooks WHERE id = ?').run(id);
      return { movedNotes, reparentedChildren };
    },

    /** Live-note counts per notebook (tree badges, F146). */
    noteCounts(): Map<string, number> {
      const rows = db
        .prepare(
          'SELECT notebook_id, COUNT(*) AS n FROM notes WHERE trashed_at IS NULL GROUP BY notebook_id',
        )
        .all() as { notebook_id: string; n: number }[];
      return new Map(rows.map((r) => [r.notebook_id, r.n]));
    },
  };
}

export type NotebooksRepo = ReturnType<typeof notebooksRepo>;
