/**
 * Note harvesting for export (F1471, F1478 selective).
 *
 * Gathers the notes to export — all live notes, one notebook, or the result of an
 * FQL query (F1478 selective export) — and resolves each into the `ExportNote` IR
 * with its notebook path, tags, and attachments. Pure read side; targets never
 * touch the DB.
 */

import fs from 'node:fs';
import type { NoteId, NotebookId } from '@fables/core';
import { attachmentPath } from '../attachments/store.js';
import type { Db } from '../db/connection.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import { tagsRepo } from '../db/repos/tags.js';
import { runFqlQuery } from '../services/query.js';
import type { ExportAttachment, ExportNote } from './types.js';

export interface HarvestOptions {
  /** FQL query selecting which notes to export (F1478). */
  query?: string | undefined;
  /** Restrict to a single notebook. */
  notebookId?: string | undefined;
  /** Hard cap on notes harvested (default 10000). */
  limit?: number | undefined;
}

const DEFAULT_LIMIT = 10_000;

/** Resolve the notes to export and enrich them into the export IR. */
export function harvestNotes(db: Db, dataDir: string, opts: HarvestOptions = {}): ExportNote[] {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const base = selectNotes(db, opts, limit);
  return base.map((note) => enrich(db, dataDir, note));
}

function selectNotes(
  db: Db,
  opts: HarvestOptions,
  limit: number,
): {
  id: string;
  notebookId: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}[] {
  if (opts.query && opts.query.trim() !== '') {
    return runFqlQuery(db, opts.query, { fetch: limit, cursor: null }).notes;
  }
  return notesRepo(db).list({
    sort: 'updated',
    fetch: limit,
    cursor: null,
    ...(opts.notebookId !== undefined ? { notebookId: opts.notebookId as NotebookId } : {}),
  });
}

function enrich(
  db: Db,
  dataDir: string,
  note: {
    id: string;
    notebookId: string;
    title: string;
    body: string;
    createdAt: string;
    updatedAt: string;
  },
): ExportNote {
  const tags = tagsRepo(db)
    .tagsForNote(note.id as NoteId)
    .map((t) => t.name);
  const attachments = attachmentsForNote(db, dataDir, note.id);
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    notebookPath: notebookPathOf(db, note.notebookId as NotebookId),
    tags,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    attachments,
  };
}

/** Walk the notebook parent chain into a path (outermost first). */
export function notebookPathOf(db: Db, notebookId: NotebookId): string[] {
  const repo = notebooksRepo(db);
  const path: string[] = [];
  const seen = new Set<string>();
  let id: NotebookId | null = notebookId;
  while (id !== null && !seen.has(id)) {
    seen.add(id);
    const nb = repo.get(id);
    if (!nb) break;
    path.unshift(nb.name);
    id = nb.parentId;
  }
  return path;
}

function attachmentsForNote(db: Db, dataDir: string, noteId: string): ExportAttachment[] {
  const rows = db
    .prepare(
      'SELECT id, filename, mime, hash FROM attachments WHERE note_id = ? ORDER BY created_at',
    )
    .all(noteId) as { id: string; filename: string; mime: string; hash: string }[];
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    mime: r.mime,
    hash: r.hash,
    read: () => fs.readFileSync(attachmentPath(dataDir, r.hash)),
  }));
}
