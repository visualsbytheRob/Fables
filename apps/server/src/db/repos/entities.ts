import {
  newEntityId,
  newLinkId,
  notFound,
  nowIso,
  type Entity,
  type EntityId,
  type EntityType,
  type NoteId,
} from '@fables/core';
import type { Db } from '../connection.js';

/**
 * Entity storage (F601, F605, F606, F609). Relations are `links` rows with
 * kind='relation', entity endpoints, and the relation name carried in
 * `target_title` (the relation metadata column for entity edges).
 */

/** Relation values as the API exchanges them: relation name → target entity ids. */
export type RelationMap = Record<string, EntityId[]>;

interface Row {
  id: string;
  type: string;
  name: string;
  aliases: string;
  fields: string;
  note_id: string | null;
  created_at: string;
  updated_at: string;
}

function toEntity(row: Row): Entity {
  return {
    id: row.id as EntityId,
    type: row.type as EntityType,
    name: row.name,
    aliases: JSON.parse(row.aliases) as string[],
    fields: JSON.parse(row.fields) as Record<string, unknown>,
    noteId: row.note_id as NoteId | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function entitiesRepo(db: Db) {
  return {
    create(input: {
      type: EntityType;
      name: string;
      aliases: string[];
      fields: Record<string, unknown>;
      noteId?: NoteId | null;
    }): Entity {
      const now = nowIso();
      const id = newEntityId();
      db.prepare(
        `INSERT INTO entities (id, type, name, aliases, fields, note_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.type,
        input.name,
        JSON.stringify(input.aliases),
        JSON.stringify(input.fields),
        input.noteId ?? null,
        now,
        now,
      );
      return this.mustGet(id);
    },

    get(id: EntityId): Entity | null {
      const row = db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as Row | undefined;
      return row ? toEntity(row) : null;
    },

    mustGet(id: EntityId): Entity {
      const entity = this.get(id);
      if (!entity) throw notFound('Entity', id);
      return entity;
    },

    update(
      id: EntityId,
      patch: Partial<Pick<Entity, 'name' | 'aliases' | 'fields' | 'noteId'>>,
    ): Entity {
      const current = this.mustGet(id);
      const next = { ...current, ...patch, updatedAt: nowIso() };
      db.prepare(
        `UPDATE entities SET name = ?, aliases = ?, fields = ?, note_id = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        next.name,
        JSON.stringify(next.aliases),
        JSON.stringify(next.fields),
        next.noteId,
        next.updatedAt,
        id,
      );
      return next;
    },

    remove(id: EntityId): void {
      this.mustGet(id);
      // Relation edges (either direction) and mention rows die with the entity;
      // codex tables cascade via foreign keys.
      db.prepare(
        `DELETE FROM links WHERE kind = 'relation'
         AND ((source_type = 'entity' AND source_id = ?) OR (target_type = 'entity' AND target_id = ?))`,
      ).run(id, id);
      db.prepare(
        `DELETE FROM links WHERE kind = 'mention' AND target_type = 'entity' AND target_id = ?`,
      ).run(id);
      db.prepare('DELETE FROM entities WHERE id = ?').run(id);
    },

    /** Cursor pagination by id, optional type filter and name/alias search (F609). */
    list(opts: { fetch: number; cursor: string | null; type?: EntityType; q?: string }): Entity[] {
      const where: string[] = [];
      const args: unknown[] = [];
      if (opts.cursor !== null) {
        where.push('id > ?');
        args.push(opts.cursor);
      }
      if (opts.type !== undefined) {
        where.push('type = ?');
        args.push(opts.type);
      }
      if (opts.q !== undefined && opts.q !== '') {
        // Name or any alias, case-insensitive substring (aliases are a JSON array).
        where.push(`(instr(lower(name), ?) > 0 OR EXISTS (
          SELECT 1 FROM json_each(entities.aliases) WHERE instr(lower(json_each.value), ?) > 0
        ))`);
        const q = opts.q.toLowerCase();
        args.push(q, q);
      }
      const sql = `SELECT * FROM entities ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
                   ORDER BY id LIMIT ?`;
      return (db.prepare(sql).all(...args, opts.fetch) as Row[]).map(toEntity);
    },

    listAll(): Entity[] {
      return (db.prepare('SELECT * FROM entities ORDER BY id').all() as Row[]).map(toEntity);
    },

    /** Exact name-or-alias lookup, case-insensitive — story binding resolution (F605). */
    getByName(name: string): Entity | null {
      const nameLc = name.toLowerCase();
      const row = db
        .prepare(
          `SELECT * FROM entities WHERE lower(name) = ? OR EXISTS (
             SELECT 1 FROM json_each(entities.aliases) WHERE lower(json_each.value) = ?
           ) ORDER BY id LIMIT 1`,
        )
        .get(nameLc, nameLc) as Row | undefined;
      return row ? toEntity(row) : null;
    },

    /** id + every name (name first, then aliases) — mention candidates (F605). */
    listNames(): { id: EntityId; type: EntityType; names: string[] }[] {
      const rows = db.prepare('SELECT id, type, name, aliases FROM entities ORDER BY id').all() as {
        id: string;
        type: string;
        name: string;
        aliases: string;
      }[];
      return rows.map((r) => ({
        id: r.id as EntityId,
        type: r.type as EntityType,
        names: [r.name, ...(JSON.parse(r.aliases) as string[])],
      }));
    },

    // ── relations (F606) ────────────────────────────────────────────────────

    /** Atomically replaces every outgoing relation edge owned by an entity. */
    replaceRelations(id: EntityId, relations: RelationMap): void {
      db.prepare(
        `DELETE FROM links WHERE kind = 'relation' AND source_type = 'entity' AND source_id = ?`,
      ).run(id);
      const insert = db.prepare(
        `INSERT INTO links (id, kind, source_type, source_id, target_type, target_id,
                            target_title, position, created_at)
         VALUES (?, 'relation', 'entity', ?, 'entity', ?, ?, NULL, ?)`,
      );
      const now = nowIso();
      for (const [name, targets] of Object.entries(relations)) {
        for (const targetId of targets) insert.run(newLinkId(), id, targetId, name, now);
      }
    },

    relations(id: EntityId): RelationMap {
      const rows = db
        .prepare(
          `SELECT target_title, target_id FROM links
           WHERE kind = 'relation' AND source_type = 'entity' AND source_id = ?
           ORDER BY target_title, target_id`,
        )
        .all(id) as { target_title: string; target_id: string }[];
      const map: RelationMap = {};
      for (const row of rows) {
        (map[row.target_title] ??= []).push(row.target_id as EntityId);
      }
      return map;
    },

    /** Incoming relation edges: who points at `id`, and how. */
    incomingRelations(id: EntityId): { name: string; sourceId: EntityId }[] {
      const rows = db
        .prepare(
          `SELECT target_title, source_id FROM links
           WHERE kind = 'relation' AND target_type = 'entity' AND target_id = ?
           ORDER BY target_title, source_id`,
        )
        .all(id) as { target_title: string; source_id: string }[];
      return rows.map((r) => ({ name: r.target_title, sourceId: r.source_id as EntityId }));
    },
  };
}

export type EntitiesRepo = ReturnType<typeof entitiesRepo>;
