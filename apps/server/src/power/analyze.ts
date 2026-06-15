/**
 * Vault analysis tools — Epic 20 Power Tools (F1981–F1985).
 *
 * Pure, no I/O: no DB, no fs, no network. All functions are deterministic and
 * operate over plain in-memory objects. Hashing uses node:crypto (allowed:
 * deterministic, no side-effects).
 *
 * Features implemented:
 *   F1981 – vaultStats
 *   F1982 – findDuplicates
 *   F1983 – findBroken
 *   F1984 – lintVault
 *   F1985 – analyzeStorage
 */

import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Domain shapes
// ---------------------------------------------------------------------------

export interface AnalysisNote {
  id: string;
  title: string;
  body: string;
  tags: string[];
  notebookId: string;
  /** bytes of stored content + attachments, for storage analysis */
  sizeBytes: number;
  updatedAt: string; // ISO
}

export interface AnalysisLink {
  fromId: string;
  /** Wikilink target title (may or may not resolve) */
  toTitle: string;
}

export interface AnalysisAttachment {
  id: string;
  noteId: string;
  name: string;
  sizeBytes: number;
  present: boolean;
}

// ---------------------------------------------------------------------------
// F1981 — Vault statistics
// ---------------------------------------------------------------------------

export interface TagCount {
  tag: string;
  count: number;
}

export interface NotebookCount {
  notebookId: string;
  count: number;
}

export interface MostLinked {
  noteId: string;
  title: string;
  incomingLinks: number;
}

export interface MonthlyCount {
  month: string; // YYYY-MM
  count: number;
}

export interface VaultStats {
  totalNotes: number;
  totalWords: number;
  totalBytes: number;
  tagCount: number;
  tagHistogram: TagCount[];
  notebookDistribution: NotebookCount[];
  averageNoteLengthWords: number;
  medianNoteLengthWords: number;
  orphanCount: number;
  linkCount: number;
  mostLinked: MostLinked[];
  notesPerMonth: MonthlyCount[];
}

function countWords(body: string): number {
  const trimmed = body.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function toYearMonth(iso: string): string {
  // ISO date like 2024-03-15T... → "2024-03"
  return iso.slice(0, 7);
}

/**
 * F1981 – Compute comprehensive vault statistics from notes, links, and
 * attachments.
 */
export function vaultStats(
  notes: AnalysisNote[],
  links: AnalysisLink[],
  _attachments: AnalysisAttachment[],
  topN = 10,
): VaultStats {
  const totalNotes = notes.length;

  // Word counts
  const wordCounts = notes.map((n) => countWords(n.body));
  const totalWords = wordCounts.reduce((s, w) => s + w, 0);
  const totalBytes = notes.reduce((s, n) => s + n.sizeBytes, 0);

  // Tag histogram
  const tagMap = new Map<string, number>();
  for (const note of notes) {
    for (const tag of note.tags) {
      tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1);
    }
  }
  const tagHistogram: TagCount[] = [...tagMap.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  const tagCount = tagMap.size;

  // Notebook distribution
  const notebookMap = new Map<string, number>();
  for (const note of notes) {
    notebookMap.set(note.notebookId, (notebookMap.get(note.notebookId) ?? 0) + 1);
  }
  const notebookDistribution: NotebookCount[] = [...notebookMap.entries()]
    .map(([notebookId, count]) => ({ notebookId, count }))
    .sort((a, b) => b.count - a.count || a.notebookId.localeCompare(b.notebookId));

  // Average / median note length in words
  const averageNoteLengthWords = totalNotes === 0 ? 0 : totalWords / totalNotes;
  const sortedWordCounts = [...wordCounts].sort((a, b) => a - b);
  const medianNoteLengthWords = median(sortedWordCounts);

  // Orphan count — notes with no incoming links and no outgoing links
  const noteIds = new Set(notes.map((n) => n.id));
  const noteTitleToId = new Map<string, string>(notes.map((n) => [n.title.toLowerCase(), n.id]));
  const hasOutgoing = new Set<string>(links.map((l) => l.fromId));
  const hasIncoming = new Set<string>();
  for (const link of links) {
    const targetId = noteTitleToId.get(link.toTitle.toLowerCase());
    if (targetId !== undefined) hasIncoming.add(targetId);
  }
  let orphanCount = 0;
  for (const note of notes) {
    if (!hasOutgoing.has(note.id) && !hasIncoming.has(note.id)) orphanCount++;
  }

  // Link count
  const linkCount = links.length;

  // Most-linked notes (by incoming link count)
  const incomingMap = new Map<string, number>();
  for (const link of links) {
    const targetId = noteTitleToId.get(link.toTitle.toLowerCase());
    if (targetId !== undefined && noteIds.has(targetId)) {
      incomingMap.set(targetId, (incomingMap.get(targetId) ?? 0) + 1);
    }
  }
  const noteIdToTitle = new Map<string, string>(notes.map((n) => [n.id, n.title]));
  const mostLinked: MostLinked[] = [...incomingMap.entries()]
    .map(([noteId, incomingLinks]) => ({
      noteId,
      title: noteIdToTitle.get(noteId) ?? '',
      incomingLinks,
    }))
    .sort((a, b) => b.incomingLinks - a.incomingLinks || a.noteId.localeCompare(b.noteId))
    .slice(0, topN);

  // Notes per month
  const monthMap = new Map<string, number>();
  for (const note of notes) {
    const month = toYearMonth(note.updatedAt);
    monthMap.set(month, (monthMap.get(month) ?? 0) + 1);
  }
  const notesPerMonth: MonthlyCount[] = [...monthMap.entries()]
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    totalNotes,
    totalWords,
    totalBytes,
    tagCount,
    tagHistogram,
    notebookDistribution,
    averageNoteLengthWords,
    medianNoteLengthWords,
    orphanCount,
    linkCount,
    mostLinked,
    notesPerMonth,
  };
}

// ---------------------------------------------------------------------------
// F1982 — Duplicate finder
// ---------------------------------------------------------------------------

export interface DuplicateGroup {
  kind: 'exact' | 'near';
  /** Similarity score: 1.0 for exact, Jaccard for near-duplicates */
  similarity: number;
  noteIds: string[];
  /** The note that should be kept (most recently updated) */
  suggestedMergeTarget: string;
}

export interface DuplicateOptions {
  /** Jaccard similarity threshold (default 0.85) */
  threshold?: number | undefined;
  /** Shingle size in tokens (default 3) */
  shingleSize?: number | undefined;
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function normaliseBody(body: string): string {
  return body.trim().replace(/\s+/g, ' ').toLowerCase();
}

function tokenise(text: string): string[] {
  return text
    .trim()
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 0);
}

function buildShingles(tokens: string[], k: number): Set<string> {
  const shingles = new Set<string>();
  for (let i = 0; i <= tokens.length - k; i++) {
    shingles.add(tokens.slice(i, i + k).join(' '));
  }
  return shingles;
}

function jaccardSets(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const v of a) {
    if (b.has(v)) intersection++;
  }
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

function mostRecentNote(noteIds: string[], notes: AnalysisNote[]): string {
  const noteMap = new Map(notes.map((n) => [n.id, n]));
  let best: AnalysisNote | undefined;
  for (const id of noteIds) {
    const n = noteMap.get(id);
    if (n === undefined) continue;
    if (best === undefined || n.updatedAt > best.updatedAt) best = n;
  }
  return best?.id ?? noteIds[0] ?? '';
}

/**
 * F1982 – Find exact and near-duplicate notes.
 */
export function findDuplicates(notes: AnalysisNote[], opts?: DuplicateOptions): DuplicateGroup[] {
  const threshold = opts?.threshold ?? 0.85;
  const shingleSize = opts?.shingleSize ?? 3;
  const results: DuplicateGroup[] = [];

  // --- Exact duplicates (hash-based) ---
  const hashToIds = new Map<string, string[]>();
  for (const note of notes) {
    const hash = sha256(normaliseBody(note.body));
    const existing = hashToIds.get(hash);
    if (existing !== undefined) {
      existing.push(note.id);
    } else {
      hashToIds.set(hash, [note.id]);
    }
  }

  const exactGroupIds = new Set<string>();
  for (const [, ids] of hashToIds) {
    if (ids.length < 2) continue;
    const sorted = [...ids].sort();
    for (const id of sorted) exactGroupIds.add(id);
    results.push({
      kind: 'exact',
      similarity: 1.0,
      noteIds: sorted,
      suggestedMergeTarget: mostRecentNote(sorted, notes),
    });
  }

  // --- Near-duplicates (shingled Jaccard) ---
  // Only compare notes not already in an exact group
  const remaining = notes.filter((n) => !exactGroupIds.has(n.id));
  const shingleCache = new Map<string, Set<string>>();
  for (const note of remaining) {
    const tokens = tokenise(note.body);
    shingleCache.set(note.id, buildShingles(tokens, shingleSize));
  }

  const nearGrouped = new Set<string>(); // tracks which note ids are already grouped
  for (let i = 0; i < remaining.length; i++) {
    const a = remaining[i];
    if (a === undefined) continue;
    if (nearGrouped.has(a.id)) continue;
    const aShingles = shingleCache.get(a.id) ?? new Set<string>();
    const groupIds: string[] = [a.id];

    for (let j = i + 1; j < remaining.length; j++) {
      const b = remaining[j];
      if (b === undefined) continue;
      if (nearGrouped.has(b.id)) continue;
      const bShingles = shingleCache.get(b.id) ?? new Set<string>();
      const sim = jaccardSets(aShingles, bShingles);
      if (sim >= threshold) {
        groupIds.push(b.id);
      }
    }

    if (groupIds.length >= 2) {
      const sorted = [...groupIds].sort();
      for (const id of sorted) nearGrouped.add(id);
      // Compute pairwise average similarity for the group
      let totalSim = 0;
      let pairs = 0;
      for (let p = 0; p < sorted.length; p++) {
        for (let q = p + 1; q < sorted.length; q++) {
          const pId = sorted[p]!;
          const qId = sorted[q]!;
          const pS = shingleCache.get(pId) ?? new Set<string>();
          const qS = shingleCache.get(qId) ?? new Set<string>();
          totalSim += jaccardSets(pS, qS);
          pairs++;
        }
      }
      const avgSim = pairs > 0 ? totalSim / pairs : threshold;
      results.push({
        kind: 'near',
        similarity: Math.round(avgSim * 10000) / 10000,
        noteIds: sorted,
        suggestedMergeTarget: mostRecentNote(sorted, notes),
      });
    }
  }

  // Sort results deterministically: exact before near, then by first noteId
  results.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'exact' ? -1 : 1;
    return (a.noteIds[0] ?? '').localeCompare(b.noteIds[0] ?? '');
  });

  return results;
}

// ---------------------------------------------------------------------------
// F1983 — Broken-reference finder
// ---------------------------------------------------------------------------

export interface BrokenReport {
  brokenLinks: Array<{ fromId: string; toTitle: string }>;
  missingAttachments: Array<{ noteId: string; attachmentId: string; name: string }>;
  emptyNotes: Array<{ noteId: string; title: string }>;
}

/**
 * F1983 – Identify broken wikilinks, missing attachments, and empty notes.
 */
export function findBroken(
  notes: AnalysisNote[],
  links: AnalysisLink[],
  attachments: AnalysisAttachment[],
): BrokenReport {
  const titleSet = new Set(notes.map((n) => n.title.toLowerCase()));

  const brokenLinks = links
    .filter((l) => !titleSet.has(l.toTitle.toLowerCase()))
    .map((l) => ({ fromId: l.fromId, toTitle: l.toTitle }))
    .sort((a, b) => a.fromId.localeCompare(b.fromId) || a.toTitle.localeCompare(b.toTitle));

  const missingAttachments = attachments
    .filter((a) => !a.present)
    .map((a) => ({ noteId: a.noteId, attachmentId: a.id, name: a.name }))
    .sort((a, b) => a.noteId.localeCompare(b.noteId) || a.name.localeCompare(b.name));

  const emptyNotes = notes
    .filter((n) => n.body.trim().length === 0)
    .map((n) => ({ noteId: n.id, title: n.title }))
    .sort((a, b) => a.noteId.localeCompare(b.noteId));

  return { brokenLinks, missingAttachments, emptyNotes };
}

// ---------------------------------------------------------------------------
// F1984 — Vault linter
// ---------------------------------------------------------------------------

export type LintSeverity = 'error' | 'warning' | 'info';

export type LintFix =
  | { kind: 'addTag'; tag: string }
  | { kind: 'removeTag'; tag: string }
  | { kind: 'setTitle'; title: string }
  | { kind: 'trimBody' }
  | { kind: 'splitNote' };

export interface LintFinding {
  ruleId: string;
  severity: LintSeverity;
  noteId: string;
  message: string;
  fix?: LintFix | undefined;
}

export interface LintRule {
  id: string;
  severity: LintSeverity;
  enabled?: boolean | undefined;
}

export interface LintRuleSet {
  /** Disable specific rule ids */
  disabled?: string[] | undefined;
  /** Override severities per rule id */
  severities?: Record<string, LintSeverity> | undefined;
  /** Max word count before 'very-long-note' fires (default 5000) */
  maxWords?: number | undefined;
  /** Regex that note titles must match (default: no restriction) */
  titlePattern?: string | undefined;
}

const DEFAULT_MAX_WORDS = 5000;

function resolveSeverity(
  ruleId: string,
  base: LintSeverity,
  overrides?: Record<string, LintSeverity>,
): LintSeverity {
  if (overrides === undefined) return base;
  return overrides[ruleId] ?? base;
}

/**
 * F1984 – Lint the vault against a configurable rule set and return findings.
 */
export function lintVault(notes: AnalysisNote[], rules?: LintRuleSet): LintFinding[] {
  const disabled = new Set(rules?.disabled ?? []);
  const severities = rules?.severities;
  const maxWords = rules?.maxWords ?? DEFAULT_MAX_WORDS;
  const titlePatternStr = rules?.titlePattern;
  const titlePattern = titlePatternStr !== undefined ? new RegExp(titlePatternStr) : undefined;

  const findings: LintFinding[] = [];

  // Build title map to detect duplicates
  const titleCount = new Map<string, number>();
  for (const note of notes) {
    const lower = note.title.toLowerCase();
    titleCount.set(lower, (titleCount.get(lower) ?? 0) + 1);
  }

  // Build link presence for orphan detection
  const hasLinks = new Set<string>();
  // Orphan means no outgoing AND no incoming links — we only have outgoing info
  // from AnalysisNote itself; for linting we use the simpler definition:
  // no tags and an empty body is caught by other rules.
  // The 'orphan-note' rule fires when a note has no outgoing links in its body.
  // Since body is plain text here, we detect wikilinks via [[...]] pattern.
  for (const note of notes) {
    if (/\[\[.*?\]\]/.test(note.body)) hasLinks.add(note.id);
  }

  for (const note of notes) {
    // --- empty-title ---
    if (!disabled.has('empty-title') && note.title.trim().length === 0) {
      findings.push({
        ruleId: 'empty-title',
        severity: resolveSeverity('empty-title', 'error', severities),
        noteId: note.id,
        message: 'Note has an empty title.',
        fix: { kind: 'setTitle', title: 'Untitled' },
      });
    }

    // --- title-case ---
    if (!disabled.has('title-case') && note.title.length > 0) {
      const first = note.title[0];
      if (first !== undefined && first !== first.toUpperCase() && /[a-z]/.test(first)) {
        findings.push({
          ruleId: 'title-case',
          severity: resolveSeverity('title-case', 'warning', severities),
          noteId: note.id,
          message: `Title "${note.title}" does not start with a capital letter.`,
          fix: { kind: 'setTitle', title: note.title[0]!.toUpperCase() + note.title.slice(1) },
        });
      }
    }

    // --- duplicate-title ---
    if (!disabled.has('duplicate-title')) {
      const cnt = titleCount.get(note.title.toLowerCase()) ?? 0;
      if (cnt > 1) {
        findings.push({
          ruleId: 'duplicate-title',
          severity: resolveSeverity('duplicate-title', 'error', severities),
          noteId: note.id,
          message: `Title "${note.title}" is shared by ${cnt} notes.`,
        });
      }
    }

    // --- untagged-note ---
    if (!disabled.has('untagged-note') && note.tags.length === 0) {
      findings.push({
        ruleId: 'untagged-note',
        severity: resolveSeverity('untagged-note', 'info', severities),
        noteId: note.id,
        message: 'Note has no tags.',
        fix: { kind: 'addTag', tag: 'inbox' },
      });
    }

    // --- very-long-note ---
    if (!disabled.has('very-long-note')) {
      const wc = countWords(note.body);
      if (wc > maxWords) {
        findings.push({
          ruleId: 'very-long-note',
          severity: resolveSeverity('very-long-note', 'warning', severities),
          noteId: note.id,
          message: `Note is very long (${wc} words > ${maxWords}).`,
          fix: { kind: 'splitNote' },
        });
      }
    }

    // --- orphan-note ---
    if (!disabled.has('orphan-note') && !hasLinks.has(note.id)) {
      findings.push({
        ruleId: 'orphan-note',
        severity: resolveSeverity('orphan-note', 'info', severities),
        noteId: note.id,
        message: 'Note has no outgoing wikilinks.',
      });
    }

    // --- title-convention ---
    if (!disabled.has('title-convention') && titlePattern !== undefined && note.title.length > 0) {
      if (!titlePattern.test(note.title)) {
        findings.push({
          ruleId: 'title-convention',
          severity: resolveSeverity('title-convention', 'warning', severities),
          noteId: note.id,
          message: `Title "${note.title}" does not match naming convention /${titlePatternStr ?? ''}/`,
        });
      }
    }
  }

  // Sort deterministically: by severity order, then ruleId, then noteId
  const severityOrder: Record<LintSeverity, number> = { error: 0, warning: 1, info: 2 };
  findings.sort(
    (a, b) =>
      (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99) ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.noteId.localeCompare(b.noteId),
  );

  return findings;
}

// ---------------------------------------------------------------------------
// F1985 — Storage analyzer
// ---------------------------------------------------------------------------

export interface StorageItem {
  id: string;
  name: string;
  sizeBytes: number;
  shareOfTotal: number;
}

export interface NotebookStorage {
  notebookId: string;
  noteBodyBytes: number;
  attachmentBytes: number;
  totalBytes: number;
}

export interface StorageReport {
  totalBytes: number;
  noteBodyBytes: number;
  attachmentBytes: number;
  byNotebook: NotebookStorage[];
  topNotes: StorageItem[];
  topAttachments: StorageItem[];
  /** Fraction of total storage occupied by topNotes + topAttachments */
  largestItemShare: number;
}

/**
 * F1985 – Break down vault storage by notebook, kind, and top-N largest items.
 */
export function analyzeStorage(
  notes: AnalysisNote[],
  attachments: AnalysisAttachment[],
  topN = 10,
): StorageReport {
  const noteBodyBytes = notes.reduce((s, n) => s + n.sizeBytes, 0);
  const attachmentBytes = attachments.reduce((s, a) => s + a.sizeBytes, 0);
  const totalBytes = noteBodyBytes + attachmentBytes;

  // By notebook
  const nbNoteBytes = new Map<string, number>();
  for (const note of notes) {
    nbNoteBytes.set(note.notebookId, (nbNoteBytes.get(note.notebookId) ?? 0) + note.sizeBytes);
  }
  const nbAttachBytes = new Map<string, number>();
  for (const att of attachments) {
    const note = notes.find((n) => n.id === att.noteId);
    const nbId = note?.notebookId ?? 'unknown';
    nbAttachBytes.set(nbId, (nbAttachBytes.get(nbId) ?? 0) + att.sizeBytes);
  }
  const allNotebookIds = new Set([...nbNoteBytes.keys(), ...nbAttachBytes.keys()]);
  const byNotebook: NotebookStorage[] = [...allNotebookIds]
    .map((nbId) => {
      const noteB = nbNoteBytes.get(nbId) ?? 0;
      const attB = nbAttachBytes.get(nbId) ?? 0;
      return {
        notebookId: nbId,
        noteBodyBytes: noteB,
        attachmentBytes: attB,
        totalBytes: noteB + attB,
      };
    })
    .sort((a, b) => b.totalBytes - a.totalBytes || a.notebookId.localeCompare(b.notebookId));

  // Top notes
  const topNotes: StorageItem[] = [...notes]
    .sort((a, b) => b.sizeBytes - a.sizeBytes || a.id.localeCompare(b.id))
    .slice(0, topN)
    .map((n) => ({
      id: n.id,
      name: n.title,
      sizeBytes: n.sizeBytes,
      shareOfTotal: totalBytes === 0 ? 0 : n.sizeBytes / totalBytes,
    }));

  // Top attachments
  const topAttachments: StorageItem[] = [...attachments]
    .sort((a, b) => b.sizeBytes - a.sizeBytes || a.id.localeCompare(b.id))
    .slice(0, topN)
    .map((a) => ({
      id: a.id,
      name: a.name,
      sizeBytes: a.sizeBytes,
      shareOfTotal: totalBytes === 0 ? 0 : a.sizeBytes / totalBytes,
    }));

  const topBytes =
    topNotes.reduce((s, i) => s + i.sizeBytes, 0) +
    topAttachments.reduce((s, i) => s + i.sizeBytes, 0);

  const largestItemShare = totalBytes === 0 ? 0 : topBytes / totalBytes;

  return {
    totalBytes,
    noteBodyBytes,
    attachmentBytes,
    byNotebook,
    topNotes,
    topAttachments,
    largestItemShare,
  };
}
