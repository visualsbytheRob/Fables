import {
  AppError,
  notFound,
  validation,
  type Note,
  type NotebookId,
  type NoteId,
} from '@fables/core';
import { withTransaction, type Db } from '../db/connection.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import { revisionsRepo } from '../db/repos/revisions.js';
import { tagsRepo } from '../db/repos/tags.js';
import { extractHashtags } from '../lib/hashtags.js';

/** Note size guard (F118): bodies past this are rejected with PAYLOAD_TOO_LARGE. */
export const MAX_NOTE_BODY_BYTES = 1024 * 1024;

export function guardBodySize(body: string | undefined): void {
  if (body === undefined) return;
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes > MAX_NOTE_BODY_BYTES) {
    throw new AppError('PAYLOAD_TOO_LARGE', 'note body exceeds the 1 MB limit', {
      details: { limitBytes: MAX_NOTE_BODY_BYTES, actualBytes: bytes },
    });
  }
}

/** Re-indexes inline #tags from the note body into note_tags (F152). */
export function syncNoteTags(db: Db, note: Note): void {
  const tags = tagsRepo(db);
  const ids = extractHashtags(note.body).map((name) => tags.ensure(name).id);
  tags.syncBodyTags(note.id, ids);
}

/** Snapshots the new head (skipping no-ops via content hash) and prunes old revisions. */
function snapshotHead(db: Db, note: Note): void {
  const revisions = revisionsRepo(db);
  if (revisions.snapshot(note)) revisions.prune(note.id);
}

export function createNote(
  db: Db,
  input: { notebookId: NotebookId; title?: string; body?: string },
): Note {
  guardBodySize(input.body);
  return withTransaction(db, () => {
    if (!notebooksRepo(db).get(input.notebookId)) throw notFound('Notebook', input.notebookId);
    const note = notesRepo(db).create(input);
    snapshotHead(db, note);
    syncNoteTags(db, note);
    return note;
  });
}

export function updateNote(
  db: Db,
  id: NoteId,
  expectedRev: number,
  patch: Partial<Pick<Note, 'title' | 'body' | 'pinned' | 'notebookId'>>,
): Note {
  guardBodySize(patch.body);
  return withTransaction(db, () => {
    if (patch.notebookId !== undefined && !notebooksRepo(db).get(patch.notebookId)) {
      throw notFound('Notebook', patch.notebookId);
    }
    const note = notesRepo(db).update(id, expectedRev, patch);
    snapshotHead(db, note);
    syncNoteTags(db, note);
    return note;
  });
}

/** Server-initiated edit (tag rename/merge rewrites) — no client rev to check. */
export function applyServerEdit(
  db: Db,
  id: NoteId,
  patch: Partial<Pick<Note, 'title' | 'body'>>,
): Note {
  return withTransaction(db, () => {
    const current = notesRepo(db).get(id);
    if (!current) throw notFound('Note', id);
    return updateNote(db, id, current.rev, patch);
  });
}

/** Duplicates a note into the same notebook, copying its tag links (F108). */
export function duplicateNote(db: Db, id: NoteId): Note {
  return withTransaction(db, () => {
    const source = notesRepo(db).get(id);
    if (!source) throw notFound('Note', id);
    const copy = notesRepo(db).create({
      notebookId: source.notebookId,
      title: `${source.title} (copy)`,
      body: source.body,
    });
    tagsRepo(db).copyNoteTags(source.id, copy.id);
    snapshotHead(db, copy);
    return copy;
  });
}

/** Restores a snapshot by writing its content as a brand-new head revision (F115). */
export function restoreRevision(db: Db, id: NoteId, rev: number): Note {
  return withTransaction(db, () => {
    const note = notesRepo(db).get(id);
    if (!note) throw notFound('Note', id);
    const snapshot = revisionsRepo(db).get(id, rev);
    if (!snapshot) throw notFound('Revision', String(rev));
    return updateNote(db, id, note.rev, { title: snapshot.title, body: snapshot.body });
  });
}

export interface BulkInput {
  action: 'move' | 'tag' | 'delete';
  noteIds: NoteId[];
  notebookId?: NotebookId;
  tagName?: string;
}

/** Bulk move/tag/delete (F109). All-or-nothing: any missing note rolls everything back. */
export function bulkNotes(db: Db, input: BulkInput): { affected: number } {
  return withTransaction(db, () => {
    const notes = notesRepo(db);
    const tags = tagsRepo(db);
    let affected = 0;

    const { notebookId, tagName } = input;
    if (input.action === 'move' && notebookId === undefined) {
      throw validation('notebookId is required for the move action');
    }
    if (input.action === 'tag' && tagName === undefined) {
      throw validation('tag is required for the tag action');
    }
    const targetTag = input.action === 'tag' ? tags.ensure(tagName!) : null;
    if (input.action === 'move' && !notebooksRepo(db).get(notebookId!)) {
      throw notFound('Notebook', notebookId);
    }

    for (const id of input.noteIds) {
      const note = notes.get(id);
      if (!note) throw notFound('Note', id);
      switch (input.action) {
        case 'move':
          if (note.notebookId !== notebookId) {
            notes.update(id, note.rev, { notebookId: notebookId! });
            affected += 1;
          }
          break;
        case 'tag':
          tags.linkNote(id, targetTag!.id, false);
          affected += 1;
          break;
        case 'delete':
          if (note.trashedAt === null) {
            notes.trash(id);
            affected += 1;
          }
          break;
      }
    }
    return { affected };
  });
}
