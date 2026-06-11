import { newNotebookId, nowIso, type Notebook, type NotebookId } from '@fables/core';
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
  return {
    create(input: { name: string; parentId?: NotebookId | null }): Notebook {
      const now = nowIso();
      const notebook: Notebook = {
        id: newNotebookId(),
        parentId: input.parentId ?? null,
        name: input.name,
        icon: null,
        color: null,
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

    list(): Notebook[] {
      const rows = db.prepare('SELECT * FROM notebooks ORDER BY name').all() as Row[];
      return rows.map(toNotebook);
    },
  };
}

export type NotebooksRepo = ReturnType<typeof notebooksRepo>;
