/**
 * Simplenote importer (F1454).
 *
 * Simplenote exports a single `notes.json` with `activeNotes` (and `trashedNotes`,
 * which we skip). Each note is plain markdown whose first line is the title.
 */

import fs from 'node:fs';
import path from 'node:path';
import { validation } from '@fables/core';
import type { SourceAdapter, StagedDoc } from '../framework/index.js';

export interface SimplenoteInput {
  path: string;
}

interface SimplenoteNote {
  id?: string;
  content?: string;
  tags?: string[];
  creationDate?: string;
  lastModified?: string;
}

export class SimplenoteAdapter implements SourceAdapter {
  readonly name = 'simplenote';
  constructor(private readonly input: SimplenoteInput) {}

  stage(): StagedDoc[] {
    const data = readJson(this.input.path) as { activeNotes?: SimplenoteNote[] };
    return (data.activeNotes ?? []).map((note, i) => toDoc(note, i));
  }
}

function toDoc(note: SimplenoteNote, index: number): StagedDoc {
  const content = note.content ?? '';
  const lines = content.split('\n');
  const title = (lines[0] ?? '').trim() || `Note ${index + 1}`;
  const body = lines.slice(1).join('\n').trim();
  const doc: StagedDoc = {
    sourceId: note.id?.toLowerCase() ?? `simplenote-${index}`,
    title: title.slice(0, 120),
    body,
    notebookPath: [],
    tags: (note.tags ?? []).filter((t) => typeof t === 'string'),
    assets: [],
    links: [],
  };
  if (note.creationDate) doc.createdAt = normalizeDate(note.creationDate);
  if (note.lastModified) doc.updatedAt = normalizeDate(note.lastModified);
  return doc;
}

export function readJson(inputPath: string): unknown {
  if (inputPath.includes('\0') || !path.isAbsolute(inputPath)) {
    throw validation('import path must be an absolute path with no NUL bytes');
  }
  let real: string;
  try {
    real = fs.realpathSync(inputPath);
  } catch {
    throw validation('import path does not exist', { path: inputPath });
  }
  if (fs.statSync(real).isDirectory()) {
    const candidate = path.join(real, 'notes.json');
    if (fs.existsSync(candidate)) real = candidate;
    else throw validation('expected notes.json in the Simplenote export directory');
  }
  try {
    return JSON.parse(fs.readFileSync(real, 'utf8'));
  } catch {
    throw validation('Simplenote export is not valid JSON');
  }
}

function normalizeDate(raw: string): string {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toISOString();
}
