/**
 * Format detection on drop (F1469).
 *
 * Given a path the user points at, sniff what it is and rank which importer(s)
 * should handle it — by extension first, then a light content peek for the
 * ambiguous cases (a `.json` could be Roam, Simplenote, Standard Notes, or Day
 * One; a directory could be a Logseq graph, an ENEX folder, a Keep takeout, …).
 * Returns ranked guesses so the UI can preselect the best source and offer the
 * runners-up. Pure detection — never imports a note.
 */

import fs from 'node:fs';
import path from 'node:path';

export type Confidence = 'high' | 'medium' | 'low';

export interface FormatGuess {
  /** Importer source name (matches the registry), e.g. 'notion'. */
  source: string;
  confidence: Confidence;
  reason: string;
}

/** Rank the importers that could handle `inputPath` (best first). */
export function detectImportSource(inputPath: string): FormatGuess[] {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(inputPath);
  } catch {
    return [];
  }
  return stat.isDirectory() ? detectDirectory(inputPath) : detectFile(inputPath);
}

// ── Files ────────────────────────────────────────────────────────────────────

function detectFile(file: string): FormatGuess[] {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case '.docx':
      return [{ source: 'docx', confidence: 'high', reason: 'Word document' }];
    case '.jex':
      return [{ source: 'joplin', confidence: 'high', reason: 'Joplin export archive' }];
    case '.opml':
      return [{ source: 'opml', confidence: 'high', reason: 'OPML outline' }];
    case '.ics':
      return [{ source: 'ics', confidence: 'high', reason: 'iCalendar file' }];
    case '.eml':
    case '.mbox':
      return [{ source: 'email', confidence: 'high', reason: 'email message(s)' }];
    case '.csv':
      return [{ source: 'csv', confidence: 'high', reason: 'CSV table' }];
    case '.txt':
      return [{ source: 'plaintext', confidence: 'high', reason: 'plain text' }];
    case '.zip':
      return [{ source: 'notion', confidence: 'medium', reason: 'zip export (assumed Notion)' }];
    case '.enex':
      return [
        { source: 'evernote', confidence: 'medium', reason: 'ENEX export' },
        { source: 'apple-notes', confidence: 'medium', reason: 'ENEX (Apple Notes via Exporter)' },
      ];
    case '.json':
      return detectJson(file);
    default:
      return [];
  }
}

function detectJson(file: string): FormatGuess[] {
  // Sniff the head as a string (not a full parse) so multi-MB exports classify
  // cheaply even when the peek truncates mid-document.
  const head = peek(file)
    .replace(/^\uFEFF/, '')
    .trimStart();
  if (head.startsWith('[')) {
    return [{ source: 'roam', confidence: 'high', reason: 'JSON array of pages (Roam)' }];
  }
  if (head.startsWith('{')) {
    if (head.includes('"activeNotes"')) {
      return [{ source: 'simplenote', confidence: 'high', reason: 'has activeNotes (Simplenote)' }];
    }
    if (head.includes('"entries"')) {
      return [{ source: 'day-one', confidence: 'high', reason: 'has entries (Day One)' }];
    }
    if (head.includes('"items"')) {
      return [
        { source: 'standard-notes', confidence: 'high', reason: 'has items (Standard Notes)' },
      ];
    }
  }
  return [{ source: 'standard-notes', confidence: 'low', reason: 'JSON (unrecognised shape)' }];
}

// ── Directories ──────────────────────────────────────────────────────────────

function detectDirectory(dir: string): FormatGuess[] {
  const names = safeReaddir(dir);
  const lower = names.map((n) => n.toLowerCase());
  const has = (n: string): boolean => lower.includes(n);
  const some = (test: (n: string) => boolean): boolean => lower.some(test);

  const guesses: FormatGuess[] = [];

  if (has('pages') && has('journals')) {
    guesses.push({ source: 'logseq', confidence: 'high', reason: 'pages/ + journals/ (Logseq)' });
  }
  if (has('notes.json')) {
    guesses.push({ source: 'simplenote', confidence: 'high', reason: 'notes.json (Simplenote)' });
  }
  if (some((n) => n.endsWith('.json')) && has('photos')) {
    guesses.push({ source: 'day-one', confidence: 'high', reason: '*.json + photos/ (Day One)' });
  }
  if (some((n) => n.endsWith('.enex'))) {
    guesses.push({
      source: 'apple-notes',
      confidence: 'medium',
      reason: '.enex files (Apple Notes)',
    });
    guesses.push({ source: 'evernote', confidence: 'medium', reason: '.enex files (Evernote)' });
  }
  if (some((n) => n.endsWith('.html') || n.endsWith('.htm'))) {
    guesses.push({ source: 'html', confidence: 'medium', reason: '.html files (static site)' });
  }
  if (some((n) => n.endsWith('.json')) && guesses.length === 0) {
    guesses.push({ source: 'google-keep', confidence: 'low', reason: '.json notes (Google Keep)' });
  }
  if (some((n) => n.endsWith('.md'))) {
    guesses.push({
      source: 'markdown',
      confidence: 'medium',
      reason: '.md files (generic markdown)',
    });
    guesses.push({ source: 'bear', confidence: 'low', reason: '.md files (Bear)' });
  }
  if (some((n) => n.endsWith('.txt'))) {
    guesses.push({ source: 'plaintext', confidence: 'medium', reason: '.txt files' });
  }

  return dedupe(guesses);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Read the first slice of a file (enough to classify a JSON shape cheaply). */
function peek(file: string, bytes = 64 * 1024): string {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const read = fs.readSync(fd, buf, 0, bytes, 0);
    // If we truncated mid-document, the JSON.parse in the caller will fail and
    // fall back to a low-confidence guess — acceptable for detection.
    return buf.toString('utf8', 0, read);
  } finally {
    fs.closeSync(fd);
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function dedupe(guesses: FormatGuess[]): FormatGuess[] {
  const seen = new Set<string>();
  const out: FormatGuess[] = [];
  for (const g of guesses) {
    if (seen.has(g.source)) continue;
    seen.add(g.source);
    out.push(g);
  }
  return out;
}
