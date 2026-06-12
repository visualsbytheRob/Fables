import { nowIso, type Note, type NoteId } from '@fables/core';
import { sha256Hex } from '../../lib/hash.js';
import { charCount, wordCount } from '../../lib/text.js';
import type { Db } from '../connection.js';

export interface NoteRevision {
  noteId: NoteId;
  rev: number;
  title: string;
  body: string;
  wordCount: number;
  charCount: number;
  contentHash: string;
  createdAt: string;
}

/** List shape: everything except the (potentially large) body. */
export type NoteRevisionMeta = Omit<NoteRevision, 'body'>;

interface Row {
  note_id: string;
  rev: number;
  title: string;
  body: string;
  word_count: number;
  char_count: number;
  content_hash: string;
  created_at: string;
}

function toRevision(row: Row): NoteRevision {
  return {
    noteId: row.note_id as NoteId,
    rev: row.rev,
    title: row.title,
    body: row.body,
    wordCount: row.word_count,
    charCount: row.char_count,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  };
}

function toMeta(row: Omit<Row, 'body'>): NoteRevisionMeta {
  return {
    noteId: row.note_id as NoteId,
    rev: row.rev,
    title: row.title,
    wordCount: row.word_count,
    charCount: row.char_count,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  };
}

/** Hash of the versioned content; identical hash ⇒ no-op save ⇒ no new snapshot (F116). */
export function contentHash(title: string, body: string): string {
  return sha256Hex(`${title}\u0000${body}`);
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function revisionsRepo(db: Db) {
  return {
    /**
     * Appends a snapshot of the note's current state. Returns false (and writes
     * nothing) when the content hash matches the latest snapshot.
     */
    snapshot(note: Note, opts: { now?: string } = {}): boolean {
      const hash = contentHash(note.title, note.body);
      const latest = this.latest(note.id);
      if (latest && latest.contentHash === hash) return false;
      db.prepare(
        `INSERT INTO note_revisions (note_id, rev, title, body, word_count, char_count, content_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        note.id,
        note.rev,
        note.title,
        note.body,
        wordCount(note.body),
        charCount(note.body),
        hash,
        opts.now ?? nowIso(),
      );
      return true;
    },

    latest(noteId: NoteId): NoteRevision | null {
      const row = db
        .prepare('SELECT * FROM note_revisions WHERE note_id = ? ORDER BY rev DESC LIMIT 1')
        .get(noteId) as Row | undefined;
      return row ? toRevision(row) : null;
    },

    list(noteId: NoteId): NoteRevisionMeta[] {
      const rows = db
        .prepare(
          `SELECT note_id, rev, title, word_count, char_count, content_hash, created_at
           FROM note_revisions WHERE note_id = ? ORDER BY rev DESC`,
        )
        .all(noteId) as Omit<Row, 'body'>[];
      return rows.map(toMeta);
    },

    get(noteId: NoteId, rev: number): NoteRevision | null {
      const row = db
        .prepare('SELECT * FROM note_revisions WHERE note_id = ? AND rev = ?')
        .get(noteId, rev) as Row | undefined;
      return row ? toRevision(row) : null;
    },

    /**
     * Pruning policy (F112): keep every snapshot younger than 24h; for older
     * ones keep only the newest snapshot per UTC calendar day.
     */
    prune(noteId: NoteId, opts: { now?: string } = {}): number {
      const now = opts.now ?? nowIso();
      const cutoff = new Date(new Date(now).getTime() - DAY_MS).toISOString();
      return db
        .prepare(
          `DELETE FROM note_revisions
           WHERE note_id = ? AND created_at < ?
             AND rev NOT IN (
               SELECT MAX(rev) FROM note_revisions
               WHERE note_id = ? AND created_at < ?
               GROUP BY substr(created_at, 1, 10)
             )`,
        )
        .run(noteId, cutoff, noteId, cutoff).changes;
    },
  };
}

export type RevisionsRepo = ReturnType<typeof revisionsRepo>;
