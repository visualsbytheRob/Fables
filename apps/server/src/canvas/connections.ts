/**
 * Canvas connection semantics (F1523 typed connections → real links, F1528 validity).
 *
 * Two layers: a pure rule table for what may connect to what, and the side-effect
 * that makes a "link" connector between two note cards into an actual link in the
 * knowledge graph — drawing the line *is* writing the wikilink.
 */

import type { NoteId } from '@fables/core';
import type { Db } from '../db/connection.js';
import { notesRepo } from '../db/repos/notes.js';
import { updateNote } from '../services/notes.js';
import type { CanvasObject, CanvasObjectKind } from './types.js';

/** Object kinds that carry knowledge a semantic link can connect (F1528). */
const KNOWLEDGE_KINDS = new Set<CanvasObjectKind>(['note', 'entity', 'knot']);

export interface ConnectDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Whether an edge of `edgeKind` may connect a `from` kind to a `to` kind (F1528).
 * Visual lines connect anything; semantic 'link' edges require knowledge objects
 * at both ends.
 */
export function canConnect(
  from: CanvasObjectKind,
  to: CanvasObjectKind,
  edgeKind: string,
): ConnectDecision {
  if (from === 'group' || to === 'group') {
    return { allowed: false, reason: 'groups are containers, not connection endpoints' };
  }
  if (edgeKind === 'link') {
    if (!KNOWLEDGE_KINDS.has(from) || !KNOWLEDGE_KINDS.has(to)) {
      return { allowed: false, reason: 'a link connector needs note/entity cards at both ends' };
    }
  }
  return { allowed: true };
}

/**
 * Materialize a 'link' connector between two note cards as a real graph link
 * (F1523): append a `[[Target Title]]` wikilink to the source note's body, which
 * the links service resolves like any hand-authored link. Returns true when a new
 * link was written, false when it didn't apply or already existed.
 */
export function materializeConnectorLink(db: Db, from: CanvasObject, to: CanvasObject): boolean {
  const fromNoteId = noteIdOf(from);
  const toNoteId = noteIdOf(to);
  if (fromNoteId === null || toNoteId === null || fromNoteId === toNoteId) return false;

  const repo = notesRepo(db);
  const source = repo.get(fromNoteId);
  const target = repo.get(toNoteId);
  if (!source || !target) return false;

  const wikilink = `[[${target.title}]]`;
  if (source.body.includes(wikilink)) return false; // already linked

  const body = source.body.trimEnd();
  const next = body === '' ? wikilink : `${body}\n\n${wikilink}`;
  updateNote(db, fromNoteId, source.rev, { body: next });
  return true;
}

function noteIdOf(obj: CanvasObject): NoteId | null {
  if (obj.kind !== 'note') return null;
  const id = obj.data['noteId'];
  return typeof id === 'string' && id !== '' ? (id as NoteId) : null;
}
