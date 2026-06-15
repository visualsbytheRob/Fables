/**
 * Bulk-operations engine (F1951–F1958).
 *
 * Pure, no I/O. All functions take plain objects and return new plain objects;
 * inputs are never mutated. Plans are fully JSON-serialisable so they can be
 * journaled and replayed by an outer persistence layer.
 *
 * Feature coverage:
 *   F1951 – BulkOp discriminated union, planBulk, applyPlan, invertPlan
 *   F1952 – findAndReplace (literal / regex, case, whole-word, title/body scope)
 *   F1953 – Bulk field editing (frontmatter-style key=value pairs)
 *   F1954 – Bulk wikilink rewriting via rename map
 *   F1955 – Bulk tag operations (add / remove / rename)
 *   F1956 – Batch merge
 *   F1957 – Batch split by heading level
 *   F1958 – Operation journal (plan ↔ journal entry)
 */

import { rewriteWikilinkTargets } from '@fables/core';

// ---------------------------------------------------------------------------
// Core shape
// ---------------------------------------------------------------------------

export interface BulkNote {
  id: string;
  title: string;
  body: string;
  tags: string[];
  notebookId: string;
}

// ---------------------------------------------------------------------------
// F1951 – BulkOp discriminated union
// ---------------------------------------------------------------------------

export type FindAndReplaceScope = 'title' | 'body' | 'both';

export interface FindAndReplaceOptions {
  find: string;
  replace: string;
  /** 'literal' (default) or 'regex' */
  mode?: 'literal' | 'regex' | undefined;
  caseSensitive?: boolean | undefined;
  wholeWord?: boolean | undefined;
  scope?: FindAndReplaceScope | undefined;
}

export interface BulkFieldEdit {
  /** Frontmatter key to set or clear. */
  key: string;
  /** Value to set. Omit (or undefined) to clear the field. */
  value?: string | undefined;
}

export interface WikilinkRenameEntry {
  oldTitle: string;
  newTitle: string;
}

export type BulkTagAction =
  | { action: 'add'; tag: string }
  | { action: 'remove'; tag: string }
  | { action: 'rename'; oldTag: string; newTag: string };

export type BulkOp =
  | { type: 'findAndReplace'; options: FindAndReplaceOptions }
  | { type: 'fieldEdit'; edits: BulkFieldEdit[] }
  | { type: 'wikilinkRename'; renames: WikilinkRenameEntry[] }
  | { type: 'tagOp'; op: BulkTagAction }
  | { type: 'merge'; targetId: string; sourceIds: string[]; separator?: string | undefined }
  | { type: 'split'; noteId: string; headingLevel?: 1 | 2 | 3 | undefined };

// ---------------------------------------------------------------------------
// Plan / Diff types
// ---------------------------------------------------------------------------

export interface NoteDiff {
  noteId: string;
  before: BulkNote;
  after: BulkNote;
  /** Human-readable description of what changed for this note. */
  description: string;
}

export interface BulkPlan {
  op: BulkOp;
  diffs: NoteDiff[];
  /** Notes added (e.g. after a split). */
  added: BulkNote[];
  /** Note IDs that should be deleted (e.g. merged sources). */
  removed: string[];
  /** Total notes examined. */
  totalExamined: number;
  /** Number of notes that will change. */
  totalAffected: number;
  /** Human-readable summary of the whole operation. */
  summary: string;
}

// ---------------------------------------------------------------------------
// F1958 – Journal entry
// ---------------------------------------------------------------------------

export interface BulkJournalEntry {
  id: string;
  createdAt: string; // ISO-8601
  op: BulkOp;
  /** Snapshot of note states before the op for undo. */
  before: BulkNote[];
  /** Snapshot after the op. */
  after: BulkNote[];
  added: BulkNote[];
  removed: string[];
}

// ---------------------------------------------------------------------------
// F1952 – Find-and-replace error type
// ---------------------------------------------------------------------------

export type FindAndReplaceError =
  | { ok: false; error: 'invalid_regex'; message: string }
  | { ok: true };

/** Validate a regex pattern without throwing. */
export function validateRegex(pattern: string, flags: string): FindAndReplaceError {
  try {
    new RegExp(pattern, flags);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: 'invalid_regex',
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type RegexOrError = RegExp | { ok: false; error: 'invalid_regex'; message: string };

function buildRegex(opts: FindAndReplaceOptions): RegexOrError {
  const flags = opts.caseSensitive ? 'g' : 'gi';
  let pattern: string;

  if (opts.mode === 'regex') {
    const validation = validateRegex(opts.find, flags);
    if (!validation.ok) return validation;
    pattern = opts.find;
  } else {
    // Escape literal string for use in a RegExp
    pattern = opts.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  if (opts.wholeWord) {
    pattern = `\\b${pattern}\\b`;
  }

  return new RegExp(pattern, flags);
}

function isRegexError(
  r: RegexOrError,
): r is { ok: false; error: 'invalid_regex'; message: string } {
  return !(r instanceof RegExp);
}

function applyReplaceInText(text: string, re: RegExp, replacement: string): string {
  re.lastIndex = 0;
  return text.replace(re, replacement);
}

function countMatchesInNote(note: BulkNote, re: RegExp, scope: FindAndReplaceScope): number {
  let count = 0;
  if (scope !== 'body') {
    count += (note.title.match(new RegExp(re.source, re.flags)) ?? []).length;
  }
  if (scope !== 'title') {
    count += (note.body.match(new RegExp(re.source, re.flags)) ?? []).length;
  }
  return count;
}

// ---------------------------------------------------------------------------
// F1953 – Frontmatter helpers
// ---------------------------------------------------------------------------

function parseFrontmatter(body: string): {
  fields: Record<string, string>;
  contentStart: number;
} {
  if (!body.startsWith('---\n') && !body.startsWith('---\r\n')) {
    return { fields: {}, contentStart: 0 };
  }

  const after = body.indexOf('\n', 3);
  if (after === -1) return { fields: {}, contentStart: 0 };

  const end = body.indexOf('\n---', after);
  if (end === -1) return { fields: {}, contentStart: 0 };

  const fmBlock = body.slice(after + 1, end);
  const contentStart = end + 4; // past \n---
  const finalStart =
    body[contentStart] === '\n'
      ? contentStart + 1
      : body[contentStart] === '\r' && body[contentStart + 1] === '\n'
        ? contentStart + 2
        : contentStart;

  const fields: Record<string, string> = {};
  for (const line of fmBlock.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    if (key.length > 0) {
      fields[key] = val;
    }
  }

  return { fields, contentStart: finalStart };
}

function serialiseFrontmatter(fields: Record<string, string>): string {
  const keys = Object.keys(fields);
  if (keys.length === 0) return '';
  const lines = keys.map((k) => `${k}: ${fields[k] ?? ''}`);
  return `---\n${lines.join('\n')}\n---\n`;
}

function applyFieldEdits(note: BulkNote, edits: BulkFieldEdit[]): BulkNote {
  const { fields, contentStart } = parseFrontmatter(note.body);
  const content = note.body.slice(contentStart);

  const newFields = { ...fields };
  for (const edit of edits) {
    if (edit.value !== undefined) {
      newFields[edit.key] = edit.value;
    } else {
      delete newFields[edit.key];
    }
  }

  const fm = serialiseFrontmatter(newFields);
  return { ...note, body: fm + content };
}

// ---------------------------------------------------------------------------
// F1954 – Wikilink rewriting helper
// ---------------------------------------------------------------------------

function applyWikilinkRenames(note: BulkNote, renames: WikilinkRenameEntry[]): BulkNote {
  let body = note.body;
  for (const { oldTitle, newTitle } of renames) {
    body = rewriteWikilinkTargets(body, oldTitle, newTitle);
  }
  return { ...note, body };
}

// ---------------------------------------------------------------------------
// F1955 – Tag operation helpers
// ---------------------------------------------------------------------------

function applyTagOp(note: BulkNote, op: BulkTagAction): BulkNote {
  switch (op.action) {
    case 'add': {
      if (note.tags.includes(op.tag)) return note;
      return { ...note, tags: [...note.tags, op.tag] };
    }
    case 'remove': {
      return { ...note, tags: note.tags.filter((t) => t !== op.tag) };
    }
    case 'rename': {
      if (!note.tags.includes(op.oldTag)) return note;
      return { ...note, tags: note.tags.map((t) => (t === op.oldTag ? op.newTag : t)) };
    }
  }
}

function describeTagOp(op: BulkTagAction): string {
  switch (op.action) {
    case 'add':
      return `add "${op.tag}"`;
    case 'remove':
      return `remove "${op.tag}"`;
    case 'rename':
      return `rename "${op.oldTag}" → "${op.newTag}"`;
  }
}

// ---------------------------------------------------------------------------
// F1957 – Split helpers
// ---------------------------------------------------------------------------

interface SplitSection {
  heading: string;
  body: string;
}

function splitByHeading(body: string, level: 1 | 2 | 3): SplitSection[] {
  const prefix = '#'.repeat(level) + ' ';
  const lines = body.split('\n');
  const sections: SplitSection[] = [];
  let currentHeading: string | null = null;
  const currentLines: string[] = [];

  const flush = (): void => {
    if (currentHeading !== null) {
      sections.push({ heading: currentHeading, body: currentLines.join('\n').trim() });
    }
  };

  for (const line of lines) {
    // Match exact heading level (not deeper)
    if (line.startsWith(prefix) && !line.startsWith(prefix + '#')) {
      flush();
      currentHeading = line.slice(prefix.length).trim();
      currentLines.length = 0;
    } else {
      if (currentHeading !== null) {
        currentLines.push(line);
      }
    }
  }
  flush();
  return sections;
}

// ---------------------------------------------------------------------------
// F1951 – planFindAndReplace (internal)
// ---------------------------------------------------------------------------

function planFindAndReplace(
  notes: BulkNote[],
  op: Extract<BulkOp, { type: 'findAndReplace' }>,
): BulkPlan {
  const result = buildRegex(op.options);
  if (isRegexError(result)) {
    return {
      op,
      diffs: [],
      added: [],
      removed: [],
      totalExamined: notes.length,
      totalAffected: 0,
      summary: `Error: ${result.message}`,
    };
  }

  const re = result;
  const scope = op.options.scope ?? 'both';
  const diffs: NoteDiff[] = [];

  for (const note of notes) {
    const newTitle =
      scope === 'body'
        ? note.title
        : applyReplaceInText(note.title, new RegExp(re.source, re.flags), op.options.replace);
    const newBody =
      scope === 'title'
        ? note.body
        : applyReplaceInText(note.body, new RegExp(re.source, re.flags), op.options.replace);

    if (newTitle !== note.title || newBody !== note.body) {
      const after: BulkNote = { ...note, title: newTitle, body: newBody };
      const matchCount = countMatchesInNote(note, re, scope);
      diffs.push({
        noteId: note.id,
        before: note,
        after,
        description: `Replaced ${matchCount} occurrence(s) in "${note.title}"`,
      });
    }
  }

  return {
    op,
    diffs,
    added: [],
    removed: [],
    totalExamined: notes.length,
    totalAffected: diffs.length,
    summary: `Find-and-replace "${op.options.find}" → "${op.options.replace}": ${diffs.length} note(s) affected.`,
  };
}

// ---------------------------------------------------------------------------
// F1951 – planBulk
// ---------------------------------------------------------------------------

/** Plan a bulk operation without executing it. Returns a serialisable plan. */
export function planBulk(notes: BulkNote[], op: BulkOp): BulkPlan {
  switch (op.type) {
    case 'findAndReplace': {
      return planFindAndReplace(notes, op);
    }

    case 'fieldEdit': {
      const diffs: NoteDiff[] = [];
      for (const note of notes) {
        const after = applyFieldEdits(note, op.edits);
        if (after.body !== note.body) {
          diffs.push({
            noteId: note.id,
            before: note,
            after,
            description: `Updated frontmatter fields in "${note.title}"`,
          });
        }
      }
      return {
        op,
        diffs,
        added: [],
        removed: [],
        totalExamined: notes.length,
        totalAffected: diffs.length,
        summary: `Field edit: ${diffs.length} note(s) updated.`,
      };
    }

    case 'wikilinkRename': {
      const diffs: NoteDiff[] = [];
      for (const note of notes) {
        const after = applyWikilinkRenames(note, op.renames);
        if (after.body !== note.body) {
          diffs.push({
            noteId: note.id,
            before: note,
            after,
            description: `Rewrote wikilinks in "${note.title}"`,
          });
        }
      }
      const titles = op.renames.map((r) => `${r.oldTitle} → ${r.newTitle}`).join(', ');
      return {
        op,
        diffs,
        added: [],
        removed: [],
        totalExamined: notes.length,
        totalAffected: diffs.length,
        summary: `Wikilink rename (${titles}): ${diffs.length} note(s) updated.`,
      };
    }

    case 'tagOp': {
      const opDesc = describeTagOp(op.op);
      const diffs: NoteDiff[] = [];
      let alreadyHad = 0;

      for (const note of notes) {
        const alreadyHadTag = op.op.action === 'add' && note.tags.includes(op.op.tag);
        if (alreadyHadTag) {
          alreadyHad++;
          continue;
        }

        const after = applyTagOp(note, op.op);
        const changed =
          after.tags.length !== note.tags.length || after.tags.some((t, i) => t !== note.tags[i]);

        if (changed) {
          diffs.push({
            noteId: note.id,
            before: note,
            after,
            description: `Applied tag op "${opDesc}" to "${note.title}"`,
          });
        }
      }

      return {
        op,
        diffs,
        added: [],
        removed: [],
        totalExamined: notes.length,
        totalAffected: diffs.length,
        summary: `Tag op "${opDesc}": ${diffs.length} note(s) affected${alreadyHad > 0 ? `, ${alreadyHad} already had tag` : ''}.`,
      };
    }

    case 'merge': {
      const targetNote = notes.find((n) => n.id === op.targetId);
      if (!targetNote) {
        return {
          op,
          diffs: [],
          added: [],
          removed: [],
          totalExamined: notes.length,
          totalAffected: 0,
          summary: `Merge error: target note "${op.targetId}" not found.`,
        };
      }

      const sourceNotes = op.sourceIds
        .map((id) => notes.find((n) => n.id === id))
        .filter((n): n is BulkNote => n !== undefined);

      const separator = op.separator ?? '\n\n---\n\n';
      const bodySections = [targetNote.body, ...sourceNotes.map((n) => n.body)];
      const mergedBody = bodySections.join(separator);
      const allTags = Array.from(
        new Set([...targetNote.tags, ...sourceNotes.flatMap((n) => n.tags)]),
      );

      const mergedNote: BulkNote = { ...targetNote, body: mergedBody, tags: allTags };
      const removed = sourceNotes.map((n) => n.id);

      return {
        op,
        diffs: [
          {
            noteId: targetNote.id,
            before: targetNote,
            after: mergedNote,
            description: `Merged ${sourceNotes.length} note(s) into "${targetNote.title}"`,
          },
        ],
        added: [],
        removed,
        totalExamined: notes.length,
        totalAffected: 1 + sourceNotes.length,
        summary: `Merge: combined ${sourceNotes.length + 1} notes into "${targetNote.title}".`,
      };
    }

    case 'split': {
      const note = notes.find((n) => n.id === op.noteId);
      if (!note) {
        return {
          op,
          diffs: [],
          added: [],
          removed: [],
          totalExamined: notes.length,
          totalAffected: 0,
          summary: `Split error: note "${op.noteId}" not found.`,
        };
      }

      const level = op.headingLevel ?? 2;
      const sections = splitByHeading(note.body, level);

      if (sections.length === 0) {
        return {
          op,
          diffs: [],
          added: [],
          removed: [],
          totalExamined: notes.length,
          totalAffected: 0,
          summary: `Split: no headings at level ${level} found in "${note.title}".`,
        };
      }

      const firstSection = sections[0]!;
      const updatedNote: BulkNote = {
        ...note,
        title: firstSection.heading,
        body: firstSection.body,
      };

      const added: BulkNote[] = sections.slice(1).map((sec, i) => ({
        id: `${note.id}-split-${i + 1}`,
        title: sec.heading,
        body: sec.body,
        tags: [...note.tags],
        notebookId: note.notebookId,
      }));

      return {
        op,
        diffs: [
          {
            noteId: note.id,
            before: note,
            after: updatedNote,
            description: `Split "${note.title}" into ${sections.length} notes (first section stays)`,
          },
        ],
        added,
        removed: [],
        totalExamined: notes.length,
        totalAffected: sections.length,
        summary: `Split "${note.title}" into ${sections.length} notes by heading level ${level}.`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// F1951 – applyPlan
// ---------------------------------------------------------------------------

/**
 * Apply a plan to a note collection, returning the updated collection.
 * Notes not in any diff/removed remain unchanged.
 */
export function applyPlan(notes: BulkNote[], plan: BulkPlan): BulkNote[] {
  const afterMap = new Map<string, BulkNote>();
  for (const diff of plan.diffs) {
    afterMap.set(diff.noteId, diff.after);
  }
  const removedSet = new Set(plan.removed);

  const result: BulkNote[] = [];
  for (const note of notes) {
    if (removedSet.has(note.id)) continue;
    const updated = afterMap.get(note.id);
    result.push(updated !== undefined ? updated : note);
  }

  for (const newNote of plan.added) {
    result.push(newNote);
  }

  return result;
}

// ---------------------------------------------------------------------------
// F1951/F1958 – invertPlan (undo)
// ---------------------------------------------------------------------------

/**
 * Produce an inverse plan that restores notes to their pre-op state.
 * The inverse swaps before↔after in diffs, turns added into removed,
 * and restores removed notes via the before snapshots in the original diffs.
 */
export function invertPlan(plan: BulkPlan): BulkPlan {
  const invertedDiffs: NoteDiff[] = plan.diffs.map((d) => ({
    noteId: d.noteId,
    before: d.after,
    after: d.before,
    description: `Undo: ${d.description}`,
  }));

  // Notes that were added now need to be removed
  const invertedRemoved = plan.added.map((n) => n.id);

  // Notes that were removed are restored from the before diffs
  const removedSet = new Set(plan.removed);
  const restoredNotes: BulkNote[] = plan.diffs
    .filter((d) => removedSet.has(d.noteId))
    .map((d) => d.before);

  return {
    op: plan.op,
    diffs: invertedDiffs,
    added: restoredNotes,
    removed: invertedRemoved,
    totalExamined: plan.totalExamined,
    totalAffected: plan.totalAffected,
    summary: `Undo: ${plan.summary}`,
  };
}

// ---------------------------------------------------------------------------
// F1952 – Standalone findAndReplace (for preview/count use)
// ---------------------------------------------------------------------------

export interface FindAndReplaceResult {
  noteId: string;
  matchCount: number;
  newTitle: string;
  newBody: string;
}

/**
 * Run find-and-replace across the given notes and return per-note match info.
 * Returns a structured error instead of throwing on invalid regex.
 */
export function findAndReplace(
  notes: BulkNote[],
  opts: FindAndReplaceOptions,
):
  | { ok: false; error: 'invalid_regex'; message: string }
  | { ok: true; results: FindAndReplaceResult[] } {
  const result = buildRegex(opts);
  if (isRegexError(result)) return result;

  const re = result;
  const scope = opts.scope ?? 'both';
  const results: FindAndReplaceResult[] = [];

  for (const note of notes) {
    const newTitle =
      scope === 'body'
        ? note.title
        : applyReplaceInText(note.title, new RegExp(re.source, re.flags), opts.replace);
    const newBody =
      scope === 'title'
        ? note.body
        : applyReplaceInText(note.body, new RegExp(re.source, re.flags), opts.replace);

    const matchCount = countMatchesInNote(note, re, scope);
    if (matchCount > 0) {
      results.push({ noteId: note.id, matchCount, newTitle, newBody });
    }
  }

  return { ok: true, results };
}

// ---------------------------------------------------------------------------
// F1955 – Standalone tag preview
// ---------------------------------------------------------------------------

export interface TagOpPreview {
  totalNotes: number;
  affected: number;
  alreadyHadTag: number;
  willLoseTag: number;
}

/** Count how many notes would be changed by a tag op, without applying it. */
export function previewTagOp(notes: BulkNote[], op: BulkTagAction): TagOpPreview {
  let affected = 0;
  let alreadyHadTag = 0;
  let willLoseTag = 0;

  for (const note of notes) {
    switch (op.action) {
      case 'add': {
        if (note.tags.includes(op.tag)) {
          alreadyHadTag++;
        } else {
          affected++;
        }
        break;
      }
      case 'remove': {
        if (note.tags.includes(op.tag)) {
          affected++;
          willLoseTag++;
        }
        break;
      }
      case 'rename': {
        if (note.tags.includes(op.oldTag)) {
          affected++;
        }
        break;
      }
    }
  }

  return { totalNotes: notes.length, affected, alreadyHadTag, willLoseTag };
}

// ---------------------------------------------------------------------------
// F1956 – Standalone mergeNotes
// ---------------------------------------------------------------------------

export interface MergeResult {
  merged: BulkNote;
  removedIds: string[];
}

/**
 * Merge source notes into a target note.
 * Returns the merged note and the list of removed source IDs.
 * Does not mutate any input.
 */
export function mergeNotes(
  target: BulkNote,
  sources: BulkNote[],
  separator = '\n\n---\n\n',
): MergeResult {
  const bodies = [target.body, ...sources.map((n) => n.body)];
  const allTags = Array.from(new Set([...target.tags, ...sources.flatMap((n) => n.tags)]));
  const merged: BulkNote = { ...target, body: bodies.join(separator), tags: allTags };
  return { merged, removedIds: sources.map((n) => n.id) };
}

// ---------------------------------------------------------------------------
// F1957 – Standalone splitNote
// ---------------------------------------------------------------------------

export interface SplitResult {
  sections: BulkNote[];
}

/**
 * Split a single note into multiple notes by markdown heading level.
 * Each heading becomes its own note. The original note is not returned —
 * callers replace it with sections[0] and add the rest.
 */
export function splitNote(note: BulkNote, headingLevel: 1 | 2 | 3 = 2): SplitResult {
  const sections = splitByHeading(note.body, headingLevel);
  const resultNotes: BulkNote[] = sections.map((sec, i) => ({
    id: i === 0 ? note.id : `${note.id}-split-${i}`,
    title: sec.heading,
    body: sec.body,
    tags: [...note.tags],
    notebookId: note.notebookId,
  }));
  return { sections: resultNotes };
}

// ---------------------------------------------------------------------------
// F1958 – Journal helpers
// ---------------------------------------------------------------------------

/** Wrap a plan in a journal entry for persistence. */
export function planToJournalEntry(
  plan: BulkPlan,
  id: string,
  createdAt: string,
): BulkJournalEntry {
  return {
    id,
    createdAt,
    op: plan.op,
    before: plan.diffs.map((d) => d.before),
    after: plan.diffs.map((d) => d.after),
    added: plan.added,
    removed: plan.removed,
  };
}

/** Reconstruct a BulkPlan from a journal entry (for replay/undo). */
export function journalEntryToPlan(entry: BulkJournalEntry): BulkPlan {
  const diffs: NoteDiff[] = entry.before.map((before, i) => {
    const after = entry.after[i] ?? before;
    return {
      noteId: before.id,
      before,
      after,
      description: `Replayed from journal entry ${entry.id}`,
    };
  });

  return {
    op: entry.op,
    diffs,
    added: entry.added,
    removed: entry.removed,
    totalExamined: diffs.length + entry.removed.length,
    totalAffected: diffs.length + entry.removed.length + entry.added.length,
    summary: `Replayed journal entry ${entry.id} (${entry.createdAt})`,
  };
}
