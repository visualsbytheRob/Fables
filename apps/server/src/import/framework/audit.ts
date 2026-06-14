/**
 * Interop epic-close tooling (F1491 link audit, F1493 memory ceiling, F1495 telemetry).
 *
 * Cross-cutting helpers that operate over imports as a whole rather than a single
 * adapter: a vault-wide link-integrity audit, a guard that refuses pathologically
 * huge imports before they exhaust memory, and a local-only classifier that turns
 * a run's errors into a failure-pattern summary for tuning.
 */

import type { Db } from '../../db/connection.js';
import { notesRepo } from '../../db/repos/notes.js';
import { buildTitlesIndex } from '../../services/links.js';
import type { ImportResult } from './types.js';

// ── Link-integrity audit (F1491) ─────────────────────────────────────────────

export interface BrokenLink {
  noteId: string;
  noteTitle: string;
  /** Wikilink targets in this note that resolve to no live note. */
  missing: string[];
}

export interface LinkAudit {
  notesScanned: number;
  totalLinks: number;
  resolved: number;
  unresolved: number;
  resolutionPct: number;
  broken: BrokenLink[];
}

const WIKILINK_RE = /\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g;

/**
 * Audit every live note's `[[wikilinks]]` and report the ones pointing nowhere
 * (F1491) — the cross-importer integrity check after one or many imports.
 */
export function linkIntegrityAudit(db: Db, sampleLimit = 200): LinkAudit {
  const titles = new Set(buildTitlesIndex(db).keys());
  const repo = notesRepo(db);
  let cursor: string | null = null;
  let notesScanned = 0;
  let resolved = 0;
  let unresolved = 0;
  const broken: BrokenLink[] = [];

  for (;;) {
    const page = repo.list({ sort: 'created', fetch: 500, cursor });
    if (page.length === 0) break;
    for (const note of page) {
      notesScanned += 1;
      const missing: string[] = [];
      for (const m of note.body.matchAll(WIKILINK_RE)) {
        const target = m[1]!.trim();
        if (titles.has(target.toLowerCase())) resolved += 1;
        else {
          unresolved += 1;
          if (!missing.includes(target)) missing.push(target);
        }
      }
      if (missing.length > 0 && broken.length < sampleLimit) {
        broken.push({ noteId: note.id, noteTitle: note.title, missing });
      }
    }
    cursor = page[page.length - 1]!.id;
    if (page.length < 500) break;
  }

  const total = resolved + unresolved;
  return {
    notesScanned,
    totalLinks: total,
    resolved,
    unresolved,
    resolutionPct: total === 0 ? 100 : Math.round((resolved / total) * 100),
    broken,
  };
}

// ── Memory ceiling (F1493) ───────────────────────────────────────────────────

/** Refuse imports above this many documents in one batch (guards against OOM). */
export const MAX_IMPORT_DOCS = 250_000;

/** Throw a clear error when an import would exceed the document ceiling (F1493). */
export function assertImportSize(docCount: number, ceiling = MAX_IMPORT_DOCS): void {
  if (docCount > ceiling) {
    throw new Error(
      `import has ${docCount} documents, above the ${ceiling} ceiling — split it into smaller imports`,
    );
  }
}

// ── Local telemetry (F1495) ──────────────────────────────────────────────────

export type ImportErrorKind = 'parse' | 'io' | 'encrypted' | 'validation' | 'other';

export interface ImportTelemetry {
  source: string;
  imported: number;
  errors: number;
  byKind: Record<ImportErrorKind, number>;
}

/** Classify a single error message into a failure kind (local-only tuning, F1495). */
export function classifyImportError(message: string): ImportErrorKind {
  const m = message.toLowerCase();
  if (m.includes('json') || m.includes('parse') || m.includes('not valid')) return 'parse';
  if (m.includes('path') || m.includes('exist') || m.includes('read') || m.includes('enoent')) {
    return 'io';
  }
  if (m.includes('encrypt') || m.includes('locked')) return 'encrypted';
  if (m.includes('invalid') || m.includes('must ') || m.includes('required')) return 'validation';
  return 'other';
}

/** Summarize a run's errors into a local telemetry record — never leaves the device. */
export function importTelemetry(result: ImportResult): ImportTelemetry {
  const byKind: Record<ImportErrorKind, number> = {
    parse: 0,
    io: 0,
    encrypted: 0,
    validation: 0,
    other: 0,
  };
  for (const e of result.errors) byKind[classifyImportError(e.message)] += 1;
  return { source: result.source, imported: result.imported, errors: result.errors.length, byKind };
}
