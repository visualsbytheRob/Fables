/**
 * Generic markdown-folder importer (F1458).
 *
 * The catch-all for any folder of `.md` files — including tools whose export is
 * "just markdown with frontmatter". It tolerates several frontmatter dialects:
 * title under `title`; tags under `tags`/`tag`/`keywords` as a YAML list or a
 * comma/space string; dates under `date`/`created`/`created_at` (and
 * `updated`/`modified`). Subfolders become notebooks, `[[wikilinks]]` heal, and
 * local images import as attachments.
 */

import fs from 'node:fs';
import path from 'node:path';
import { validation } from '@fables/core';
import type { SourceAdapter, StagedAsset, StagedDoc, StagedLink } from '../framework/index.js';
import { parseFrontmatter, type FrontmatterValue } from '../../lib/frontmatter.js';

export interface MarkdownInput {
  path: string;
}

export class MarkdownFolderAdapter implements SourceAdapter {
  readonly name = 'markdown';
  constructor(private readonly input: MarkdownInput) {}

  stage(): StagedDoc[] {
    const dir = resolveDir(this.input.path);
    return walkMarkdown(dir).map((rel) => toDoc(dir, rel));
  }
}

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

function toDoc(dir: string, rel: string): StagedDoc {
  const { data, body: rawBody } = parseFrontmatter(fs.readFileSync(path.join(dir, rel), 'utf8'));
  const fileDir = path.dirname(path.join(dir, rel));
  const assets: StagedAsset[] = [];
  const links: StagedLink[] = [];

  let body = rawBody.replace(WIKILINK_RE, (_m, title: string) => {
    const target = title.trim().toLowerCase();
    links.push({ targetSourceId: target, label: title.trim() });
    return `{{link:${target}}}`;
  });

  let assetN = 0;
  body = body.replace(IMAGE_RE, (whole, _alt: string, target: string) => {
    if (/^[a-z]+:\/\//i.test(target) || target.startsWith('{{')) return whole;
    const abs = path.resolve(fileDir, decodeURIComponentSafe(target));
    if (!abs.startsWith(dir) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return whole;
    const ref = `m${assetN++}`;
    assets.push({ ref, filename: path.basename(abs), read: () => fs.readFileSync(abs) });
    return `{{asset:${ref}}}`;
  });

  const title = firstString(data['title']) || path.basename(rel).replace(/\.md$/i, '');

  const doc: StagedDoc = {
    sourceId: rel.toLowerCase(),
    title,
    body: body.trim(),
    notebookPath: rel.includes('/') ? rel.split('/').slice(0, -1) : [],
    tags: extractTags(data),
    assets,
    links,
  };
  const created = firstDate(data['created'], data['created_at'], data['date']);
  const updated = firstDate(data['updated'], data['modified'], data['updated_at']);
  if (created) doc.createdAt = created;
  if (updated) doc.updatedAt = updated;
  return doc;
}

/** Tags across dialects: list value, or comma/space string under several keys. */
function extractTags(data: Record<string, FrontmatterValue>): string[] {
  const out = new Set<string>();
  for (const key of ['tags', 'tag', 'keywords']) {
    const v = data[key];
    if (v === undefined || typeof v === 'boolean') continue;
    const parts = Array.isArray(v) ? v : v.split(/[,\s]+/);
    for (const p of parts) {
      const name = String(p).trim().replace(/^#/, '');
      if (name) out.add(name);
    }
  }
  return [...out];
}

function firstString(v: FrontmatterValue | undefined): string {
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0].trim();
  return '';
}

function firstDate(...values: (FrontmatterValue | undefined)[]): string | undefined {
  for (const v of values) {
    const s = firstString(v);
    if (s === '') continue;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return undefined;
}

function walkMarkdown(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        out.push(path.relative(root, abs).split(path.sep).join('/'));
      }
    }
  };
  walk(root);
  return out;
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
  if (!fs.statSync(real).isDirectory())
    throw validation('markdown import path must be a directory');
  return real;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
