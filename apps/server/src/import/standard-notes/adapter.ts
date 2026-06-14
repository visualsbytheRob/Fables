/**
 * Standard Notes importer (F1456).
 *
 * Standard Notes exports a decrypted JSON backup: an `items` array mixing Notes
 * and Tags. Tags reference the notes they apply to, so we resolve those into
 * Fables tags. Only `Note` items become notes; trashed items are skipped.
 */

import fs from 'node:fs';
import path from 'node:path';
import { validation } from '@fables/core';
import type { SourceAdapter, StagedDoc } from '../framework/index.js';

export interface StandardNotesInput {
  path: string;
}

interface SnItem {
  uuid?: string;
  content_type?: string;
  created_at?: string;
  updated_at?: string;
  content?: {
    title?: string;
    text?: string;
    trashed?: boolean;
    references?: { uuid?: string; content_type?: string }[];
  };
}

export class StandardNotesAdapter implements SourceAdapter {
  readonly name = 'standard-notes';
  constructor(private readonly input: StandardNotesInput) {}

  stage(): StagedDoc[] {
    const data = readBackup(this.input.path);
    const items = data.items ?? [];

    // Build note-uuid → tag names from Tag items' references (F1456).
    const tagsByNote = new Map<string, string[]>();
    for (const item of items) {
      if (item.content_type !== 'Tag') continue;
      const name = item.content?.title?.trim();
      if (!name) continue;
      for (const ref of item.content?.references ?? []) {
        if (!ref.uuid) continue;
        const list = tagsByNote.get(ref.uuid) ?? [];
        list.push(name);
        tagsByNote.set(ref.uuid, list);
      }
    }

    const docs: StagedDoc[] = [];
    items.forEach((item, i) => {
      if (item.content_type !== 'Note' || item.content?.trashed) return;
      docs.push(toDoc(item, i, item.uuid ? (tagsByNote.get(item.uuid) ?? []) : []));
    });
    return docs;
  }
}

function toDoc(item: SnItem, index: number, tags: string[]): StagedDoc {
  const doc: StagedDoc = {
    sourceId: item.uuid?.toLowerCase() ?? `sn-${index}`,
    title: item.content?.title?.trim() || `Note ${index + 1}`,
    body: (item.content?.text ?? '').trim(),
    notebookPath: [],
    tags,
    assets: [],
    links: [],
  };
  if (item.created_at) doc.createdAt = normalizeDate(item.created_at);
  if (item.updated_at) doc.updatedAt = normalizeDate(item.updated_at);
  return doc;
}

function readBackup(inputPath: string): { items?: SnItem[] } {
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
    throw validation('Standard Notes import expects the decrypted backup .txt/.json file');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(real, 'utf8'));
  } catch {
    throw validation('Standard Notes backup is not valid JSON (is it decrypted?)');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { items?: unknown }).items)
  ) {
    throw validation('Standard Notes backup must contain an "items" array');
  }
  return parsed as { items: SnItem[] };
}

function normalizeDate(raw: string): string {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toISOString();
}
