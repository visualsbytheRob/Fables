import { newTagId, notFound, nowIso, type NoteId, type Tag, type TagId } from '@fables/core';
import type { Db } from '../connection.js';

interface Row {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
}

function toTag(row: Row): Tag {
  return {
    id: row.id as TagId,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
  };
}

export interface TagWithCount extends Tag {
  /** Live (non-trashed) notes carrying this tag. */
  noteCount: number;
}

export function tagsRepo(db: Db) {
  return {
    create(input: { name: string; color?: string | null }): Tag {
      const tag: Tag = {
        id: newTagId(),
        name: input.name,
        color: input.color ?? null,
        createdAt: nowIso(),
      };
      db.prepare('INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)').run(
        tag.id,
        tag.name,
        tag.color,
        tag.createdAt,
      );
      return tag;
    },

    get(id: TagId): Tag | null {
      const row = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as Row | undefined;
      return row ? toTag(row) : null;
    },

    getByName(name: string): Tag | null {
      const row = db.prepare('SELECT * FROM tags WHERE name = ?').get(name) as Row | undefined;
      return row ? toTag(row) : null;
    },

    /** Fetch-or-create by normalized name. */
    ensure(name: string): Tag {
      return this.getByName(name) ?? this.create({ name });
    },

    listWithCounts(): TagWithCount[] {
      const rows = db
        .prepare(
          `SELECT t.*, (
             SELECT COUNT(*) FROM note_tags nt
             JOIN notes n ON n.id = nt.note_id AND n.trashed_at IS NULL
             WHERE nt.tag_id = t.id
           ) AS note_count
           FROM tags t ORDER BY t.name`,
        )
        .all() as (Row & { note_count: number })[];
      return rows.map((row) => ({ ...toTag(row), noteCount: row.note_count }));
    },

    update(id: TagId, patch: { name?: string; color?: string | null }): Tag {
      const current = this.get(id);
      if (!current) throw notFound('Tag', id);
      const next: Tag = {
        ...current,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.color !== undefined ? { color: patch.color } : {}),
      };
      db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').run(next.name, next.color, id);
      return next;
    },

    remove(id: TagId): boolean {
      // note_tags rows cascade via FK.
      return db.prepare('DELETE FROM tags WHERE id = ?').run(id).changes > 0;
    },

    /** Links a note to a tag; body-sourced links upgrade manual ones in place. */
    linkNote(noteId: NoteId, tagId: TagId, viaBody: boolean): void {
      db.prepare(
        `INSERT INTO note_tags (note_id, tag_id, via_body) VALUES (?, ?, ?)
         ON CONFLICT(note_id, tag_id) DO UPDATE SET
           via_body = CASE WHEN excluded.via_body = 1 THEN 1 ELSE note_tags.via_body END`,
      ).run(noteId, tagId, viaBody ? 1 : 0);
    },

    tagsForNote(noteId: NoteId): Tag[] {
      const rows = db
        .prepare(
          `SELECT t.* FROM tags t JOIN note_tags nt ON nt.tag_id = t.id
           WHERE nt.note_id = ? ORDER BY t.name`,
        )
        .all(noteId) as Row[];
      return rows.map(toTag);
    },

    noteIdsForTag(tagId: TagId): NoteId[] {
      const rows = db.prepare('SELECT note_id FROM note_tags WHERE tag_id = ?').all(tagId) as {
        note_id: string;
      }[];
      return rows.map((r) => r.note_id as NoteId);
    },

    /**
     * Reconciles body-sourced links: removes `via_body` links no longer in the
     * parsed set, then (re-)links the parsed set.
     */
    syncBodyTags(noteId: NoteId, tagIds: TagId[]): void {
      if (tagIds.length === 0) {
        db.prepare('DELETE FROM note_tags WHERE note_id = ? AND via_body = 1').run(noteId);
        return;
      }
      const placeholders = tagIds.map(() => '?').join(', ');
      db.prepare(
        `DELETE FROM note_tags WHERE note_id = ? AND via_body = 1 AND tag_id NOT IN (${placeholders})`,
      ).run(noteId, ...tagIds);
      for (const tagId of tagIds) this.linkNote(noteId, tagId, true);
    },

    /** Copies all tag links from one note to another (note duplication, F108). */
    copyNoteTags(fromNoteId: NoteId, toNoteId: NoteId): void {
      db.prepare(
        `INSERT OR IGNORE INTO note_tags (note_id, tag_id, via_body)
         SELECT ?, tag_id, via_body FROM note_tags WHERE note_id = ?`,
      ).run(toNoteId, fromNoteId);
    },

    /** Moves every link from one tag to another (merge, F158). */
    repointLinks(fromTagId: TagId, toTagId: TagId): void {
      db.prepare(
        `INSERT INTO note_tags (note_id, tag_id, via_body)
         SELECT note_id, ?, via_body FROM note_tags WHERE tag_id = ?
         ON CONFLICT(note_id, tag_id) DO UPDATE SET
           via_body = CASE WHEN excluded.via_body = 1 THEN 1 ELSE note_tags.via_body END`,
      ).run(toTagId, fromTagId);
      db.prepare('DELETE FROM note_tags WHERE tag_id = ?').run(fromTagId);
    },

    /** Deletes tags with no remaining note links (F159). Returns the removed count. */
    cleanupOrphans(): number {
      return db
        .prepare('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM note_tags)')
        .run().changes;
    },
  };
}

export type TagsRepo = ReturnType<typeof tagsRepo>;
