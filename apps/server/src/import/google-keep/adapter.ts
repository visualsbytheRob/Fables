/**
 * Google Keep importer (F1455).
 *
 * Google Takeout exports Keep as one `.json` per note (under `Takeout/Keep/`).
 * Labels become tags, list items become a markdown checklist, and pinned/archived
 * state is preserved as tags so nothing about a note is silently lost.
 */

import fs from 'node:fs';
import path from 'node:path';
import { validation } from '@fables/core';
import type { SourceAdapter, StagedAsset, StagedDoc } from '../framework/index.js';

export interface GoogleKeepInput {
  path: string;
}

interface KeepListItem {
  text?: string;
  isChecked?: boolean;
}
interface KeepAttachment {
  filePath?: string;
  mimetype?: string;
}
interface KeepNote {
  title?: string;
  textContent?: string;
  listContent?: KeepListItem[];
  labels?: { name?: string }[];
  annotations?: { url?: string; title?: string }[];
  attachments?: KeepAttachment[];
  isPinned?: boolean;
  isArchived?: boolean;
  isTrashed?: boolean;
  color?: string;
  createdTimestampUsec?: number;
  userEditedTimestampUsec?: number;
}

export class GoogleKeepAdapter implements SourceAdapter {
  readonly name = 'google-keep';
  constructor(private readonly input: GoogleKeepInput) {}

  stage(): StagedDoc[] {
    const dir = resolveDir(this.input.path);
    const docs: StagedDoc[] = [];
    fs.readdirSync(dir)
      .filter((n) => n.toLowerCase().endsWith('.json'))
      .sort()
      .forEach((name, i) => {
        const note = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as KeepNote;
        if (note.isTrashed) return;
        docs.push(toDoc(dir, name, note, i));
      });
    return docs;
  }
}

function toDoc(dir: string, name: string, note: KeepNote, index: number): StagedDoc {
  const assets: StagedAsset[] = [];
  const parts: string[] = [];
  if (note.textContent) parts.push(note.textContent.trim());
  for (const item of note.listContent ?? []) {
    parts.push(`- [${item.isChecked ? 'x' : ' '}] ${(item.text ?? '').trim()}`);
  }
  for (const ann of note.annotations ?? []) {
    if (ann.url) parts.push(`[${ann.title ?? ann.url}](${ann.url})`);
  }
  (note.attachments ?? []).forEach((att, i) => {
    if (!att.filePath) return;
    const abs = path.join(dir, att.filePath);
    if (!fs.existsSync(abs)) return;
    const ref = `k${i}`;
    assets.push({ ref, filename: path.basename(att.filePath), read: () => fs.readFileSync(abs) });
    parts.push(`{{asset:${ref}}}`);
  });

  const tags = (note.labels ?? []).map((l) => l.name).filter((n): n is string => !!n);
  if (note.isPinned) tags.push('pinned');
  if (note.isArchived) tags.push('archived');

  const doc: StagedDoc = {
    sourceId: name.replace(/\.json$/i, '').toLowerCase(),
    title: (note.title ?? '').trim() || `Keep note ${index + 1}`,
    body: parts.join('\n\n').trim(),
    notebookPath: [],
    tags,
    assets,
    links: [],
  };
  if (note.createdTimestampUsec) doc.createdAt = usecToIso(note.createdTimestampUsec);
  if (note.userEditedTimestampUsec) doc.updatedAt = usecToIso(note.userEditedTimestampUsec);
  return doc;
}

function usecToIso(usec: number): string {
  return new Date(usec / 1000).toISOString();
}

function resolveDir(inputPath: string): string {
  if (inputPath.includes('\0') || !path.isAbsolute(inputPath)) {
    throw validation('import path must be an absolute path with no NUL bytes');
  }
  let real: string;
  try {
    real = fs.realpathSync(inputPath);
  } catch {
    throw validation('import path does not exist', { path: inputPath });
  }
  if (!fs.statSync(real).isDirectory()) {
    throw validation('Google Keep import path must be the Takeout/Keep directory');
  }
  return real;
}
