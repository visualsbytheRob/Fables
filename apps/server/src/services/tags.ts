import { conflict, notFound, validation, type Tag, type TagId } from '@fables/core';
import { withTransaction, type Db } from '../db/connection.js';
import { notesRepo } from '../db/repos/notes.js';
import { tagsRepo } from '../db/repos/tags.js';
import { isValidTagName, normalizeTagName, rewriteHashtag } from '../lib/hashtags.js';
import { applyServerEdit } from './notes.js';

/** Normalizes and validates user tag input, or throws VALIDATION. */
export function parseTagName(raw: string): string {
  const name = normalizeTagName(raw);
  if (!isValidTagName(name)) {
    throw validation(
      'invalid tag name — use lowercase letters, digits, “_”, “-”, nested with “/”',
      { name: raw },
    );
  }
  return name;
}

/** Rewrites `#from` → `#to` in every linked note body, bumping revs as it goes. */
function propagateRename(db: Db, tagId: TagId, from: string, to: string): number {
  const tags = tagsRepo(db);
  const notes = notesRepo(db);
  let rewritten = 0;
  for (const noteId of tags.noteIdsForTag(tagId)) {
    const note = notes.get(noteId);
    if (!note) continue;
    const next = rewriteHashtag(note.body, from, to);
    if (next !== note.body) {
      applyServerEdit(db, noteId, { body: next });
      rewritten += 1;
    }
  }
  return rewritten;
}

/** Tag rename with propagation into note bodies (F151). */
export function renameTag(db: Db, id: TagId, rawName: string): Tag {
  const name = parseTagName(rawName);
  return withTransaction(db, () => {
    const tags = tagsRepo(db);
    const tag = tags.get(id);
    if (!tag) throw notFound('Tag', id);
    if (tag.name === name) return tag;
    const existing = tags.getByName(name);
    if (existing && existing.id !== id) {
      throw conflict('a tag with that name already exists — merge instead', {
        name,
        existingId: existing.id,
      });
    }
    const renamed = tags.update(id, { name });
    propagateRename(db, id, tag.name, name);
    return renamed;
  });
}

/** Merges `sourceId` into `targetId` (F158): links re-point, bodies rewrite, source dies. */
export function mergeTags(
  db: Db,
  sourceId: TagId,
  targetId: TagId,
): { target: Tag; mergedNotes: number } {
  return withTransaction(db, () => {
    const tags = tagsRepo(db);
    const source = tags.get(sourceId);
    if (!source) throw notFound('Tag', sourceId);
    const target = tags.get(targetId);
    if (!target) throw notFound('Tag', targetId);
    if (sourceId === targetId) throw validation('cannot merge a tag into itself');

    const noteIds = tags.noteIdsForTag(sourceId);
    tags.repointLinks(sourceId, targetId);
    tags.remove(sourceId);
    for (const noteId of noteIds) {
      const note = notesRepo(db).get(noteId);
      if (!note) continue;
      const next = rewriteHashtag(note.body, source.name, target.name);
      if (next !== note.body) applyServerEdit(db, noteId, { body: next });
    }
    return { target: tags.get(targetId)!, mergedNotes: noteIds.length };
  });
}
