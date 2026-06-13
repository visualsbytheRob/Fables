import { AppError, notFound, type NoteId } from '@fables/core';
import type { Db } from '../db/connection.js';
import { notesRepo } from '../db/repos/notes.js';

/**
 * Transclusion source resolution (F671/F672/F679). Extracts a referenced block
 * or section from a note body, and inlines `![[note]]` transclusions in `.fable`
 * sources at compile time with provenance comments (F679). Stale references
 * throw a NOT_FOUND carrying structured details.
 */

const BLOCK_ID_SUFFIX_RE = /\s\^([A-Za-z0-9-]+)\s*$/;

export interface BlockContent {
  noteId: NoteId;
  blockId: string;
  line: number;
  /** The block text with the trailing `^id` marker stripped. */
  content: string;
}

/** The single line carrying `^blockId` in a note (F671). */
export function noteBlock(db: Db, noteId: NoteId, blockId: string): BlockContent {
  const note = notesRepo(db).get(noteId);
  if (!note || note.trashedAt !== null) throw notFound('Note', noteId);
  const lines = note.body.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const match = BLOCK_ID_SUFFIX_RE.exec(lines[i]!);
    if (match && match[1] === blockId) {
      return {
        noteId,
        blockId,
        line: i,
        content: lines[i]!.replace(BLOCK_ID_SUFFIX_RE, '').trimEnd(),
      };
    }
  }
  throw new AppError('NOT_FOUND', `block "^${blockId}" not found in note`, {
    details: { noteId, blockId },
  });
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;

export interface SectionContent {
  noteId: NoteId;
  heading: string;
  level: number;
  startLine: number;
  endLine: number;
  /** Section body, heading line included, up to the next same-or-higher heading. */
  content: string;
}

/**
 * The section under a heading (F672): from the matching heading line up to the
 * next heading at the same or shallower level (exclusive).
 */
export function noteSection(db: Db, noteId: NoteId, heading: string): SectionContent {
  const note = notesRepo(db).get(noteId);
  if (!note || note.trashedAt !== null) throw notFound('Note', noteId);
  const lines = note.body.split('\n');
  const wanted = heading.trim().toLowerCase();

  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const m = HEADING_RE.exec(lines[i]!);
    if (m && m[2]!.trim().toLowerCase() === wanted) {
      start = i;
      level = m[1]!.length;
      break;
    }
  }
  if (start === -1) {
    throw new AppError('NOT_FOUND', `section "${heading}" not found in note`, {
      details: { noteId, heading },
    });
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const m = HEADING_RE.exec(lines[i]!);
    if (m && m[1]!.length <= level) {
      end = i;
      break;
    }
  }
  return {
    noteId,
    heading: lines[start]!.replace(HEADING_RE, '$2').trim(),
    level,
    startLine: start,
    endLine: end,
    content: lines.slice(start, end).join('\n').trimEnd(),
  };
}

// ── compile-time inlining (F679) ────────────────────────────────────────────

/** Matches a whole-line `![[Title]]`, `![[Title#Heading]]`, or `![[Title^block]]`. */
const TRANSCLUDE_LINE_RE = /^[ \t]*!\[\[([^\]\n]+)\]\][ \t]*$/gm;

export interface TransclusionError {
  ref: string;
  reason: 'missing-note' | 'missing-block' | 'missing-section';
}

export interface InlineResult {
  source: string;
  /** Resolved transclusions, for provenance/debugging. */
  resolved: { ref: string; noteId: NoteId }[];
  errors: TransclusionError[];
}

function findNoteByTitle(db: Db, titleLc: string): NoteId | null {
  const hit = notesRepo(db)
    .listTitles()
    .find((n) => n.title.toLowerCase() === titleLc);
  return hit ? hit.id : null;
}

/**
 * Inline `![[note]]` lines in a `.fable` source with provenance comments before
 * compilation (F679). Each resolved transclusion is wrapped in
 * `// <<< transcluded from [[…]]` / `// >>> end transclusion` markers so the
 * provenance survives into the compiled artifact. Unresolved references are
 * collected and the line is left untouched (the compiler then flags it stale).
 */
export function inlineTransclusions(db: Db, source: string): InlineResult {
  const resolved: { ref: string; noteId: NoteId }[] = [];
  const errors: TransclusionError[] = [];

  const out = source.replace(TRANSCLUDE_LINE_RE, (whole, refRaw: string) => {
    const ref = refRaw.trim();
    const hashIdx = ref.indexOf('#');
    const caretIdx = ref.indexOf('^');
    let title = ref;
    let heading: string | null = null;
    let blockId: string | null = null;
    if (caretIdx !== -1) {
      title = ref.slice(0, caretIdx).trim();
      blockId = ref.slice(caretIdx + 1).trim();
    } else if (hashIdx !== -1) {
      title = ref.slice(0, hashIdx).trim();
      heading = ref.slice(hashIdx + 1).trim();
    }

    const noteId = findNoteByTitle(db, title.toLowerCase());
    if (noteId === null) {
      errors.push({ ref, reason: 'missing-note' });
      return whole;
    }
    try {
      let content: string;
      if (blockId !== null) content = noteBlock(db, noteId, blockId).content;
      else if (heading !== null) content = noteSection(db, noteId, heading).content;
      else {
        const note = notesRepo(db).get(noteId)!;
        content = note.body.trimEnd();
      }
      resolved.push({ ref, noteId });
      return `// <<< transcluded from [[${ref}]]\n${content}\n// >>> end transclusion`;
    } catch {
      errors.push({ ref, reason: blockId !== null ? 'missing-block' : 'missing-section' });
      return whole;
    }
  });

  return { source: out, resolved, errors };
}
