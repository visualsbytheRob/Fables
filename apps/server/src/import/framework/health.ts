/**
 * Import health report (F1486).
 *
 * After an import, this scores how well it landed: how many notes/notebooks/
 * attachments the batch created, and — the headline number — what fraction of the
 * `[[wikilinks]]` in the imported notes actually resolve to a real note. A low
 * resolution percentage is the clearest signal that an import lost connective
 * tissue (e.g. links to pages that weren't part of the export).
 */

import { notFound } from '@fables/core';
import type { NoteId } from '@fables/core';
import type { Db } from '../../db/connection.js';
import { notesRepo } from '../../db/repos/notes.js';
import { buildTitlesIndex } from '../../services/links.js';
import { importBatchesRepo, type BatchStatus } from './batches.js';

export interface ImportHealth {
  batchId: string;
  source: string;
  status: BatchStatus;
  notes: number;
  notebooks: number;
  attachments: number;
  linksResolved: number;
  linksUnresolved: number;
  /** Percentage of wikilinks that point at a real note (100 when there are none). */
  linkResolutionPct: number;
}

const WIKILINK_RE = /\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g;

/** Compute a post-import health report for a batch (F1486). */
export function importHealthReport(db: Db, batchId: string): ImportHealth {
  const batches = importBatchesRepo(db);
  const batch = batches.get(batchId);
  if (!batch) throw notFound('ImportBatch', batchId);

  const noteIds = batches.artifacts(batchId, 'note');
  const titles = new Set(buildTitlesIndex(db).keys()); // lowercased live titles
  const repo = notesRepo(db);

  let resolved = 0;
  let unresolved = 0;
  for (const id of noteIds) {
    const note = repo.get(id as NoteId);
    if (!note) continue;
    for (const m of note.body.matchAll(WIKILINK_RE)) {
      const target = m[1]!.trim().toLowerCase();
      if (titles.has(target)) resolved += 1;
      else unresolved += 1;
    }
  }

  const totalLinks = resolved + unresolved;
  return {
    batchId,
    source: batch.source,
    status: batch.status,
    notes: noteIds.length,
    notebooks: batches.artifacts(batchId, 'notebook').length,
    attachments: batches.artifacts(batchId, 'attachment').length,
    linksResolved: resolved,
    linksUnresolved: unresolved,
    linkResolutionPct: totalLinks === 0 ? 100 : Math.round((resolved / totalLinks) * 100),
  };
}

/**
 * Re-sync a "living" source into an existing batch (F1487).
 *
 * Thin wrapper over the framework's resume path: re-running an import against the
 * same batch id imports any documents that have appeared since (resume skips ones
 * already materialized). Changed-in-place documents aren't re-updated yet — that
 * needs per-document content hashing — and the folder-watch trigger is a web/UX
 * concern; this is the server mechanism a watcher would call.
 */
export { runImport as resyncImport } from './runner.js';
