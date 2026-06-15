/**
 * Power-tools data loaders (Epic 20, F1981–F1985).
 *
 * Bridges the live database to the pure analyzers in `power/analyze.ts`: pulls
 * notes (with their tags + byte size), wikilink edges and attachments (checking
 * each backing file's presence) into the plain shapes the analyzers consume.
 * The heavy lifting — stats, duplicate detection, broken-reference and storage
 * analysis, the linter — stays pure and is unit-tested there.
 */

import fs from 'node:fs';
import type { Db } from '../db/connection.js';
import { attachmentPath } from '../attachments/store.js';
import {
  analyzeStorage,
  findBroken,
  findDuplicates,
  lintVault,
  vaultStats,
  type AnalysisAttachment,
  type AnalysisLink,
  type AnalysisNote,
  type DuplicateOptions,
  type LintRuleSet,
} from '../power/analyze.js';

interface NoteRow {
  id: string;
  notebook_id: string;
  title: string;
  body: string;
  updated_at: string;
}

export function loadNotes(db: Db): AnalysisNote[] {
  const rows = db
    .prepare('SELECT id, notebook_id, title, body, updated_at FROM notes WHERE trashed_at IS NULL')
    .all() as NoteRow[];
  const tagsByNote = new Map<string, string[]>();
  for (const r of db
    .prepare(
      `SELECT nt.note_id AS noteId, t.name AS name
         FROM note_tags nt JOIN tags t ON t.id = nt.tag_id`,
    )
    .all() as { noteId: string; name: string }[]) {
    const list = tagsByNote.get(r.noteId);
    if (list) list.push(r.name);
    else tagsByNote.set(r.noteId, [r.name]);
  }
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    tags: tagsByNote.get(r.id) ?? [],
    notebookId: r.notebook_id,
    sizeBytes: Buffer.byteLength(r.body, 'utf8'),
    updatedAt: r.updated_at,
  }));
}

export function loadLinks(db: Db): AnalysisLink[] {
  return (
    db
      .prepare(
        "SELECT source_id AS fromId, target_title AS toTitle FROM links WHERE kind = 'wikilink' AND source_type = 'note'",
      )
      .all() as { fromId: string; toTitle: string }[]
  ).filter((l) => l.toTitle !== '');
}

export function loadAttachments(db: Db, dataDir: string): AnalysisAttachment[] {
  return (
    db.prepare('SELECT id, note_id, filename, size, hash FROM attachments').all() as {
      id: string;
      note_id: string | null;
      filename: string;
      size: number;
      hash: string;
    }[]
  ).map((a) => ({
    id: a.id,
    noteId: a.note_id ?? '',
    name: a.filename,
    sizeBytes: a.size,
    present: fs.existsSync(attachmentPath(dataDir, a.hash)),
  }));
}

export function vaultStatistics(db: Db, dataDir: string, topN?: number) {
  return vaultStats(loadNotes(db), loadLinks(db), loadAttachments(db, dataDir), topN);
}

export function vaultDuplicates(db: Db, opts?: DuplicateOptions) {
  return findDuplicates(loadNotes(db), opts);
}

export function vaultBroken(db: Db, dataDir: string) {
  return findBroken(loadNotes(db), loadLinks(db), loadAttachments(db, dataDir));
}

export function vaultLint(db: Db, rules?: LintRuleSet) {
  return lintVault(loadNotes(db), rules);
}

export function vaultStorage(db: Db, dataDir: string, topN?: number) {
  return analyzeStorage(loadNotes(db), loadAttachments(db, dataDir), topN);
}
