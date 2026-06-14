/**
 * Joplin importer (F1457).
 *
 * A Joplin `.jex` export is an uncompressed tarball of *items* — markdown files
 * named by a 32-hex id, each ending in a `key: value` metadata trailer whose
 * `type_` says what it is (1 note, 2 folder/notebook, 4 resource). Notebooks form
 * a hierarchy via `parent_id`; resources (`:/id` references in note bodies) are
 * stored as binaries under `resources/`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { validation } from '@fables/core';
import type { SourceAdapter, StagedAsset, StagedDoc } from '../framework/index.js';
import { readTar } from '../lib/tar.js';

export interface JoplinInput {
  /** Server-local path to the `.jex` file. */
  path: string;
}

interface JoplinItem {
  id: string;
  title: string;
  body: string;
  meta: Record<string, string>;
}

export class JoplinAdapter implements SourceAdapter {
  readonly name = 'joplin';
  constructor(private readonly input: JoplinInput) {}

  stage(): StagedDoc[] {
    const entries = readTar(readFile(this.input.path));
    const items: JoplinItem[] = [];
    const resourceBin = new Map<string, Buffer>(); // resourceId → bytes

    for (const entry of entries) {
      if (!entry.isFile) continue;
      const base = entry.name.split('/').pop() ?? entry.name;
      if (entry.name.startsWith('resources/')) {
        resourceBin.set(base.replace(/\.[^.]+$/, ''), entry.data);
        continue;
      }
      if (/^[0-9a-f]{32}$/i.test(base)) {
        items.push(parseItem(base, entry.data.toString('utf8')));
      }
    }

    const folders = new Map<string, JoplinItem>();
    const resourceMeta = new Map<string, JoplinItem>();
    const notes: JoplinItem[] = [];
    for (const item of items) {
      const type = item.meta['type_'];
      if (type === '2') folders.set(item.id, item);
      else if (type === '4') resourceMeta.set(item.id, item);
      else if (type === '1') notes.push(item);
    }

    return notes.map((note) => toDoc(note, folders, resourceMeta, resourceBin));
  }
}

function toDoc(
  note: JoplinItem,
  folders: Map<string, JoplinItem>,
  resourceMeta: Map<string, JoplinItem>,
  resourceBin: Map<string, Buffer>,
): StagedDoc {
  const assets: StagedAsset[] = [];
  let body = note.body;
  let assetN = 0;

  // Resource references `![alt](:/id)` / `[label](:/id)` → assets.
  body = body.replace(
    /(!?)\[([^\]]*)\]\(:\/([0-9a-f]{32})\)/gi,
    (whole, bang, _label, id: string) => {
      const bin = resourceBin.get(id);
      if (!bin) return whole;
      const meta = resourceMeta.get(id);
      const ext = meta?.meta['file_extension'] ? `.${meta.meta['file_extension']}` : '';
      const filename = meta?.title || `${id}${ext}`;
      const ref = `j${assetN++}`;
      assets.push({ ref, filename, read: () => bin });
      return `${bang}{{asset:${ref}}}`;
    },
  );

  const notebookPath = folderChain(note.meta['parent_id'], folders);

  const doc: StagedDoc = {
    sourceId: note.id,
    title: note.title || 'Untitled',
    body: body.trim(),
    notebookPath,
    tags: [],
    assets,
    links: [],
  };
  const created = note.meta['user_created_time'] ?? note.meta['created_time'];
  const updated = note.meta['user_updated_time'] ?? note.meta['updated_time'];
  if (created) doc.createdAt = msToIso(created);
  if (updated) doc.updatedAt = msToIso(updated);
  return doc;
}

/** Walk the parent_id chain to a notebook path (outermost first). */
function folderChain(parentId: string | undefined, folders: Map<string, JoplinItem>): string[] {
  const chain: string[] = [];
  let id = parentId;
  const seen = new Set<string>();
  while (id && folders.has(id) && !seen.has(id)) {
    seen.add(id);
    const folder = folders.get(id)!;
    chain.unshift(folder.title || 'Notebook');
    id = folder.meta['parent_id'];
  }
  return chain;
}

/** Split a Joplin item into title, body, and its trailing metadata block. */
function parseItem(id: string, content: string): JoplinItem {
  const lines = content.split('\n');
  // The metadata block is the trailing run of `key: value` lines (ends at type_).
  let metaStart = lines.length;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i]!.trim() === '') continue;
    if (/^[a-z_]+: /.test(lines[i]!)) metaStart = i;
    else break;
  }
  const meta: Record<string, string> = {};
  for (const line of lines.slice(metaStart)) {
    const m = /^([a-z_]+): (.*)$/.exec(line.trim());
    if (m) meta[m[1]!] = m[2]!;
  }
  const bodyLines = lines.slice(0, metaStart);
  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1]!.trim() === '') bodyLines.pop();
  const title = (bodyLines[0] ?? '').trim();
  const body = bodyLines.slice(1).join('\n').trim();
  return { id, title, body, meta };
}

function msToIso(ms: string): string {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : ms;
}

function readFile(inputPath: string): Buffer {
  if (inputPath.includes('\0') || !path.isAbsolute(inputPath)) {
    throw validation('import path must be an absolute path with no NUL bytes');
  }
  let real: string;
  try {
    real = fs.realpathSync(inputPath);
  } catch {
    throw validation('import path does not exist', { path: inputPath });
  }
  if (!fs.statSync(real).isFile() || !real.toLowerCase().endsWith('.jex')) {
    throw validation('expected a Joplin .jex file');
  }
  return fs.readFileSync(real);
}
