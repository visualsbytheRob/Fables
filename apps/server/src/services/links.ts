import { parseWikilinks, type Entity, type Note, type NoteId } from '@fables/core';
import type { Db } from '../db/connection.js';
import { entitiesRepo } from '../db/repos/entities.js';
import { linksRepo, type NewLink } from '../db/repos/links.js';
import { notesRepo } from '../db/repos/notes.js';
import { detectMentions, MIN_NAME_LENGTH, type MentionCandidate } from '../lib/mentions.js';
import { invalidateGraphCache } from './graph.js';

/**
 * Link-index maintenance (F202, F206, F209, F221, F222, F228).
 *
 * Incremental contract: a plain body save touches only the saved note's rows
 * (one title-index read, zero body scans of other notes). Only a title
 * create/rename additionally re-scans candidate sources found via a single
 * substring prefilter — see `onTitleChanged`.
 */

/** Lowercased title → note id; duplicate titles resolve to the oldest note (lowest ulid). */
export function buildTitlesIndex(db: Db): Map<string, NoteId> {
  const index = new Map<string, NoteId>();
  for (const { id, title } of notesRepo(db).listTitles()) {
    const key = title.toLowerCase();
    if (!index.has(key)) index.set(key, id); // listTitles orders by id (creation order)
  }
  return index;
}

function mentionCandidates(db: Db, excludeId: NoteId): MentionCandidate[] {
  // Notes by title, plus entities by name + aliases (F605/F226).
  const noteCandidates = notesRepo(db)
    .listTitles()
    .filter((n) => n.id !== excludeId)
    .map((n) => ({ id: n.id, names: [n.title] }));
  // An entity's own backing note never "mentions" it — exclude it, like self-titles.
  const entityCandidates = entitiesRepo(db)
    .listAll()
    .filter((e) => e.noteId !== excludeId)
    .map((e) => ({ id: e.id, names: [e.name, ...e.aliases] }));
  return [...noteCandidates, ...entityCandidates];
}

function wikilinkRows(note: Note, titles: Map<string, NoteId>): NewLink[] {
  return parseWikilinks(note.body).map((link) => {
    const titleLc = link.target.toLowerCase();
    const targetId = titles.get(titleLc) ?? null;
    return {
      kind: 'wikilink' as const,
      targetId: targetId ?? '',
      targetTitle: titleLc,
      targetHeading: link.heading,
      targetBlock: link.blockId,
      position: link.start,
      length: link.end - link.start,
      broken: targetId === null,
    };
  });
}

function mentionRows(db: Db, note: Note): NewLink[] {
  return detectMentions(note.body, mentionCandidates(db, note.id)).map((hit) => ({
    kind: 'mention' as const,
    targetType: hit.id.startsWith('ent_') ? ('entity' as const) : ('note' as const),
    targetId: hit.id,
    targetTitle: hit.name.toLowerCase(),
    targetHeading: null,
    targetBlock: null,
    position: hit.position,
    length: hit.length,
    broken: false,
  }));
}

/**
 * Recomputes the saved note's outgoing wikilink and mention rows atomically
 * (delete + reinsert inside the caller's save transaction).
 */
export function syncNoteLinks(db: Db, note: Note): void {
  const links = linksRepo(db);
  links.replaceForSource(note.id, 'wikilink', wikilinkRows(note, buildTitlesIndex(db)));
  links.replaceForSource(note.id, 'mention', note.trashedAt === null ? mentionRows(db, note) : []);
  invalidateGraphCache(db);
}

/**
 * Incoming-side maintenance when a note gains a (new) title — on create and
 * rename, never on body-only saves:
 *  1. broken wikilinks written as the new title re-resolve (F206),
 *  2. stale mentions pointing at the note are dropped, and
 *  3. mention rows are recomputed for candidate sources found via one
 *     substring prefilter over bodies (`idsWithBodyContaining`) — the rare,
 *     bounded exception to the no-body-scan rule (F228).
 */
export function onTitleChanged(db: Db, note: Note): void {
  const links = linksRepo(db);
  const notes = notesRepo(db);
  const titleLc = note.title.toLowerCase();

  links.deleteMentionsTargeting(note.id);
  if (titleLc !== '') links.resolveBrokenByTitle(titleLc, note.id);
  if (titleLc.length >= MIN_NAME_LENGTH) {
    for (const sourceId of notes.idsWithBodyContaining(titleLc)) {
      if (sourceId === note.id) continue;
      const source = notes.get(sourceId);
      if (source) links.replaceForSource(sourceId, 'mention', mentionRows(db, source));
    }
  }
  invalidateGraphCache(db);
}

/**
 * Incoming-side maintenance when an entity is created or its name/aliases
 * change (F605): drop stale mention rows targeting the entity, then recompute
 * mentions for candidate source notes found via the same bounded substring
 * prefilter `onTitleChanged` uses. Pass the pre-change names too so renames
 * clear hits on the old spelling.
 */
export function onEntityNamesChanged(db: Db, entity: Entity, previousNames: string[] = []): void {
  const links = linksRepo(db);
  const notes = notesRepo(db);
  db.prepare(
    `DELETE FROM links WHERE kind = 'mention' AND target_type = 'entity' AND target_id = ?`,
  ).run(entity.id);

  const names = new Set(
    [entity.name, ...entity.aliases, ...previousNames]
      .map((n) => n.toLowerCase())
      .filter((n) => n.length >= MIN_NAME_LENGTH),
  );
  const sourceIds = new Set<NoteId>();
  for (const name of names) {
    for (const sourceId of notes.idsWithBodyContaining(name)) sourceIds.add(sourceId);
  }
  for (const sourceId of sourceIds) {
    const source = notes.get(sourceId);
    if (source && source.trashedAt === null) {
      links.replaceForSource(sourceId, 'mention', mentionRows(db, source));
    }
  }
  invalidateGraphCache(db);
}
