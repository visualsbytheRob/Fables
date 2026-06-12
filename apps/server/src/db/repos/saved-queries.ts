import { notFound, nowIso } from '@fables/core';
import type { Db } from '../connection.js';

/** Saved FQL query (F281). Ids are `sq_<uuid>` — minted here, not in core. */
export interface SavedQuery {
  id: string;
  name: string;
  fql: string;
  icon: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  name: string;
  fql: string;
  icon: string | null;
  pinned: number;
  created_at: string;
  updated_at: string;
}

const toSavedQuery = (row: Row): SavedQuery => ({
  id: row.id,
  name: row.name,
  fql: row.fql,
  icon: row.icon,
  pinned: row.pinned === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const newSavedQueryId = (): string => `sq_${crypto.randomUUID()}`;

export function savedQueriesRepo(db: Db) {
  return {
    create(input: {
      name: string;
      fql: string;
      icon?: string | null;
      pinned?: boolean;
    }): SavedQuery {
      const now = nowIso();
      const saved: SavedQuery = {
        id: newSavedQueryId(),
        name: input.name,
        fql: input.fql,
        icon: input.icon ?? null,
        pinned: input.pinned ?? false,
        createdAt: now,
        updatedAt: now,
      };
      db.prepare(
        `INSERT INTO saved_queries (id, name, fql, icon, pinned, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(saved.id, saved.name, saved.fql, saved.icon, saved.pinned ? 1 : 0, now, now);
      return saved;
    },

    get(id: string): SavedQuery | null {
      const row = db.prepare('SELECT * FROM saved_queries WHERE id = ?').get(id) as Row | undefined;
      return row ? toSavedQuery(row) : null;
    },

    /** Pinned queries first (top-bar shortcuts, F287), then by name. */
    list(): SavedQuery[] {
      const rows = db
        .prepare('SELECT * FROM saved_queries ORDER BY pinned DESC, name, id')
        .all() as Row[];
      return rows.map(toSavedQuery);
    },

    update(
      id: string,
      patch: Partial<Pick<SavedQuery, 'name' | 'fql' | 'icon' | 'pinned'>>,
    ): SavedQuery {
      const current = this.get(id);
      if (!current) throw notFound('Saved query', id);
      const next: SavedQuery = { ...current, ...patch, updatedAt: nowIso() };
      db.prepare(
        `UPDATE saved_queries SET name = ?, fql = ?, icon = ?, pinned = ?, updated_at = ?
         WHERE id = ?`,
      ).run(next.name, next.fql, next.icon, next.pinned ? 1 : 0, next.updatedAt, id);
      return next;
    },

    remove(id: string): boolean {
      return db.prepare('DELETE FROM saved_queries WHERE id = ?').run(id).changes > 0;
    },
  };
}

export type SavedQueriesRepo = ReturnType<typeof savedQueriesRepo>;
