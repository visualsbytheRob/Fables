import {
  newAttachmentId,
  nowIso,
  type Attachment,
  type AttachmentId,
  type NoteId,
} from '@fables/core';
import type { Db } from '../connection.js';

interface Row {
  id: string;
  note_id: string | null;
  filename: string;
  mime: string;
  size: number;
  hash: string;
  created_at: string;
}

function toAttachment(row: Row): Attachment {
  return {
    id: row.id as AttachmentId,
    noteId: row.note_id as NoteId | null,
    filename: row.filename,
    mime: row.mime,
    size: row.size,
    hash: row.hash,
    createdAt: row.created_at,
  };
}

export function attachmentsRepo(db: Db) {
  return {
    create(input: {
      noteId: NoteId | null;
      filename: string;
      mime: string;
      size: number;
      hash: string;
    }): Attachment {
      const attachment: Attachment = {
        id: newAttachmentId(),
        noteId: input.noteId,
        filename: input.filename,
        mime: input.mime,
        size: input.size,
        hash: input.hash,
        createdAt: nowIso(),
      };
      db.prepare(
        `INSERT INTO attachments (id, note_id, filename, mime, size, hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        attachment.id,
        attachment.noteId,
        attachment.filename,
        attachment.mime,
        attachment.size,
        attachment.hash,
        attachment.createdAt,
      );
      return attachment;
    },

    get(id: AttachmentId): Attachment | null {
      const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as Row | undefined;
      return row ? toAttachment(row) : null;
    },

    /** Newest-first, keyset-paginated by id (ULIDs sort by creation time). */
    list(opts: { fetch: number; cursor: string | null }): Attachment[] {
      const rows = (
        opts.cursor !== null
          ? db
              .prepare('SELECT * FROM attachments WHERE id < ? ORDER BY id DESC LIMIT ?')
              .all(opts.cursor, opts.fetch)
          : db.prepare('SELECT * FROM attachments ORDER BY id DESC LIMIT ?').all(opts.fetch)
      ) as Row[];
      return rows.map(toAttachment);
    },

    remove(id: AttachmentId): boolean {
      return db.prepare('DELETE FROM attachments WHERE id = ?').run(id).changes > 0;
    },

    /** Other rows sharing the same content hash (dedupe-aware file deletion). */
    countByHash(hash: string): number {
      return (
        db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE hash = ?').get(hash) as {
          n: number;
        }
      ).n;
    },

    /**
     * GC candidates (F164): rows with no owning note (never linked, or the note
     * was purged — the FK nulls note_id) that are older than the grace cutoff.
     */
    unreferenced(createdBefore: string): Attachment[] {
      const rows = db
        .prepare('SELECT * FROM attachments WHERE note_id IS NULL AND created_at < ?')
        .all(createdBefore) as Row[];
      return rows.map(toAttachment);
    },

    allHashes(): Set<string> {
      const rows = db.prepare('SELECT DISTINCT hash FROM attachments').all() as { hash: string }[];
      return new Set(rows.map((r) => r.hash));
    },
  };
}

export type AttachmentsRepo = ReturnType<typeof attachmentsRepo>;
