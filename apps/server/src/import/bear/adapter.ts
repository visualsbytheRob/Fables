/**
 * Bear importer (F1451).
 *
 * Bear's "Export as Markdown" produces a folder of `.md` files (optionally with an
 * assets folder). Bear's tag syntax is distinctive: `#tag`, nested `#parent/child`,
 * and multi-word `#two words#` (closed with a trailing `#`). We harvest those as
 * Fables tags, keep `[[note links]]` as wikilinks, and import referenced images.
 */

import fs from 'node:fs';
import path from 'node:path';
import { validation } from '@fables/core';
import type { SourceAdapter, StagedAsset, StagedDoc, StagedLink } from '../framework/index.js';

export interface BearInput {
  path: string;
}

export class BearAdapter implements SourceAdapter {
  readonly name = 'bear';
  constructor(private readonly input: BearInput) {}

  stage(): StagedDoc[] {
    const dir = resolveDir(this.input.path);
    const files = walkMarkdown(dir);
    return files.map((rel) => toDoc(dir, rel));
  }
}

// Multi-word tags are delimited `#two words#`: opener at a word boundary, no inner
// `#`, and the closing `#` must be followed by whitespace/end.
const MULTIWORD_TAG_RE = /(^|\s)#([\p{L}\p{N}][^#\n]*?)#(?=\s|$)/gu;
const SIMPLE_TAG_RE = /(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_/-]*)/gu;
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;
const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

function toDoc(dir: string, rel: string): StagedDoc {
  const raw = fs.readFileSync(path.join(dir, rel), 'utf8');
  const fileDir = path.dirname(path.join(dir, rel));
  const tags = new Set<string>();
  const assets: StagedAsset[] = [];
  const links: StagedLink[] = [];

  let body = raw;

  // Multi-word tags first (#two words#), then simple tags.
  body = body.replace(MULTIWORD_TAG_RE, (_m, lead: string, name: string) => {
    const slug = name.trim().replace(/\s+/g, '-');
    tags.add(slug);
    return `${lead}#${slug}`;
  });
  body = body.replace(SIMPLE_TAG_RE, (_m, lead: string, name: string) => {
    tags.add(name);
    return `${lead}#${name}`;
  });

  // [[wikilinks]] → framework link placeholders (heal to real notes).
  body = body.replace(WIKILINK_RE, (_m, title: string) => {
    const target = title.trim().toLowerCase();
    links.push({ targetSourceId: target, label: title.trim() });
    return `{{link:${target}}}`;
  });

  // Local images → assets.
  let assetN = 0;
  body = body.replace(IMAGE_RE, (whole, _alt: string, target: string) => {
    if (/^[a-z]+:\/\//i.test(target)) return whole;
    const abs = path.resolve(fileDir, decodeURIComponentSafe(target));
    if (!abs.startsWith(dir) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return whole;
    const ref = `b${assetN++}`;
    assets.push({ ref, filename: path.basename(abs), read: () => fs.readFileSync(abs) });
    return `{{asset:${ref}}}`;
  });

  const title = firstHeading(raw) || path.basename(rel).replace(/\.md$/i, '');
  return {
    sourceId: rel.toLowerCase(),
    title,
    body: stripLeadingHeading(body, title).trim(),
    notebookPath: rel.includes('/') ? rel.split('/').slice(0, -1) : [],
    tags: [...tags],
    assets,
    links,
  };
}

function firstHeading(md: string): string {
  return /^#\s+(.+)$/m.exec(md)?.[1]?.trim() ?? '';
}

function stripLeadingHeading(md: string, title: string): string {
  const lines = md.split('\n');
  const i = lines.findIndex((l) => l.trim() !== '');
  if (i >= 0 && /^#\s+/.test(lines[i]!.trim()) && lines[i]!.replace(/^#\s+/, '').trim() === title) {
    lines.splice(0, i + 1);
  }
  return lines.join('\n');
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
  if (!fs.statSync(real).isDirectory()) throw validation('Bear import path must be a directory');
  return real;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
