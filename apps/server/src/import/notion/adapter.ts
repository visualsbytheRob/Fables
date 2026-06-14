/**
 * Notion importer (F1411–F1418).
 *
 * Parses a Notion "Markdown & CSV" export — a `.zip` or an already-extracted
 * directory — into the framework's staging IR. Notion's own export already
 * flattens its block model to markdown, so the work here is Notion-specific
 * structure: 32-hex page ids embedded in filenames, nested child-page folders,
 * database CSVs, internal links, and media files.
 *
 *   F1411  pages, databases, blocks (markdown)        F1415  internal links → wikilinks
 *   F1412  database → notebook (+ properties)         F1416  media + file properties
 *   F1413  block coverage via lossy hints             F1417  nested page hierarchy
 *   F1414  relation/rollup → properties + lossy        F1418  lossy dry-run report
 */

import fs from 'node:fs';
import path from 'node:path';
import { validation } from '@fables/core';
import type { SourceAdapter, StagedAsset, StagedDoc, StagedLink } from '../framework/index.js';
import { readZip } from '../lib/zip.js';

export interface NotionInput {
  /** Server-local path to the Notion export `.zip` or its extracted directory. */
  path: string;
}

/** A flat view of the export: relative POSIX path → bytes. */
type Tree = Map<string, Buffer>;

/** 32-hex Notion id embedded at the end of a page/file name. */
const NOTION_ID_RE = /\s+([0-9a-f]{32})(?=\.|$|\/)/i;

export class NotionAdapter implements SourceAdapter {
  readonly name = 'notion';
  constructor(private readonly input: NotionInput) {}

  stage(): StagedDoc[] {
    const tree = readSourceTree(this.input.path);
    return parseNotion(tree);
  }
}

// ── Source tree ──────────────────────────────────────────────────────────────

function readSourceTree(inputPath: string): Tree {
  if (inputPath.includes('\0') || !path.isAbsolute(inputPath)) {
    throw validation('import path must be an absolute path with no NUL bytes');
  }
  let real: string;
  try {
    real = fs.realpathSync(inputPath);
  } catch {
    throw validation('import path does not exist', { path: inputPath });
  }
  const stat = fs.statSync(real);
  if (stat.isFile() && real.toLowerCase().endsWith('.zip')) {
    const tree: Tree = new Map();
    for (const entry of readZip(fs.readFileSync(real))) {
      if (!entry.isDirectory) tree.set(entry.name.split(path.sep).join('/'), entry.data);
    }
    return tree;
  }
  if (stat.isDirectory()) return walkDir(real);
  throw validation('import path must be a .zip file or a directory', { path: inputPath });
}

function walkDir(root: string): Tree {
  const tree: Tree = new Map();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) {
        const rel = path.relative(root, abs).split(path.sep).join('/');
        tree.set(rel, fs.readFileSync(abs));
      }
    }
  };
  walk(root);
  return tree;
}

// ── Naming helpers ───────────────────────────────────────────────────────────

/** Strip the trailing 32-hex Notion id from a name segment, leaving a clean title. */
export function stripNotionId(segment: string): string {
  return segment
    .replace(NOTION_ID_RE, '')
    .replace(/\.(md|csv)$/i, '')
    .trim();
}

/** The stable source id for a page path — its Notion id, or the path when absent. */
export function notionSourceId(relPath: string): string {
  const base = relPath.split('/').pop() ?? relPath;
  const m = NOTION_ID_RE.exec(base);
  return m ? m[1]!.toLowerCase() : relPath.toLowerCase();
}

/** Notebook hierarchy from a page's parent folders, with ids stripped (F1417). */
function notebookPathFor(relPath: string): string[] {
  return relPath
    .split('/')
    .slice(0, -1)
    .map((seg) => stripNotionId(seg))
    .filter((s) => s !== '');
}

// ── Core parse ───────────────────────────────────────────────────────────────

function parseNotion(tree: Tree): StagedDoc[] {
  const mdFiles = [...tree.keys()].filter((p) => p.toLowerCase().endsWith('.md'));
  const csvFiles = [...tree.keys()].filter((p) => p.toLowerCase().endsWith('.csv'));

  // Resolve internal links: map both a page's relpath and its decoded path → source id.
  const pathToId = new Map<string, string>();
  for (const p of mdFiles) {
    pathToId.set(p, notionSourceId(p));
    pathToId.set(decodeURIComponentSafe(p), notionSourceId(p));
  }

  // Database properties keyed by DB folder → (page title → property cells).
  const dbProps = parseDatabases(tree, csvFiles);

  const docs: StagedDoc[] = [];
  for (const rel of mdFiles) {
    docs.push(buildDoc(tree, rel, pathToId, dbProps));
  }
  return docs;
}

function buildDoc(
  tree: Tree,
  rel: string,
  pathToId: Map<string, string>,
  dbProps: Map<string, Map<string, Record<string, string>>>,
): StagedDoc {
  const raw = (tree.get(rel) ?? Buffer.alloc(0)).toString('utf8');
  const base = rel.split('/').pop() ?? rel;
  const title = stripNotionId(base) || firstHeading(raw) || 'Untitled';
  const dir = rel.split('/').slice(0, -1).join('/');

  const assets: StagedAsset[] = [];
  const links: StagedLink[] = [];
  const lossy = new Set<string>();

  let body = stripLeadingTitle(raw, title);
  body = rewriteRefs(body, dir, tree, pathToId, assets, links, lossy);

  // Database row properties (F1412/F1414): render onto the page, harvest tags.
  const tags: string[] = [];
  const dbProp = dbProps.get(dir)?.get(title);
  if (dbProp) {
    const { table, harvestedTags, lossyProps } = renderProperties(dbProp);
    if (table) body = `${body.trimEnd()}\n\n## Properties\n\n${table}\n`;
    tags.push(...harvestedTags);
    for (const l of lossyProps) lossy.add(l);
  }

  // Block-coverage hints (F1413): Notion's md export is already lossy for these.
  if (/^\s*>\s/m.test(body)) lossy.add('callouts rendered as quotes');
  if (/<details>|▶|⏷/.test(body)) lossy.add('toggles flattened');

  const doc: StagedDoc = {
    sourceId: notionSourceId(rel),
    title,
    body,
    notebookPath: notebookPathFor(rel),
    tags,
    assets,
    links,
  };
  if (lossy.size > 0) doc.metadata = { lossy: [...lossy] };
  return doc;
}

const MD_LINK_RE = /(!?)\[([^\]\n]*)\]\(([^)\n]+)\)/g;

/** Rewrite md links/images to framework placeholders (F1415 links, F1416 media). */
function rewriteRefs(
  body: string,
  dir: string,
  tree: Tree,
  pathToId: Map<string, string>,
  assets: StagedAsset[],
  links: StagedLink[],
  lossy: Set<string>,
): string {
  let assetN = 0;
  return body.replace(MD_LINK_RE, (whole, bang: string, text: string, target: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.toLowerCase().startsWith('http')) {
      return whole; // mailto:, etc. left as-is
    }
    const decoded = decodeURIComponentSafe(target);
    const resolved = joinPosix(dir, decoded);

    // Internal page link (F1415).
    if (!bang && decoded.toLowerCase().endsWith('.md')) {
      const targetId = pathToId.get(resolved) ?? pathToId.get(decoded);
      if (targetId) {
        const link: StagedLink = { targetSourceId: targetId };
        if (text) link.label = text;
        links.push(link);
        return `{{link:${targetId}}}`;
      }
      lossy.add('unresolved internal link');
      return text || whole;
    }

    // A Notion notion.so URL we can't resolve to a local page.
    if (target.toLowerCase().startsWith('http')) return whole;

    // Local media / file property (F1416).
    if (tree.has(resolved)) {
      const ref = `n${assetN++}`;
      const filename = resolved.split('/').pop() ?? 'file';
      const buf = tree.get(resolved)!;
      assets.push({ ref, filename, read: () => buf });
      return `{{asset:${ref}}}`;
    }
    lossy.add('missing media reference');
    return whole;
  });
}

// ── Database CSVs (F1412/F1414) ──────────────────────────────────────────────

/** dir → (page title → row cells). */
function parseDatabases(
  tree: Tree,
  csvFiles: string[],
): Map<string, Map<string, Record<string, string>>> {
  const out = new Map<string, Map<string, Record<string, string>>>();
  for (const csvPath of csvFiles) {
    const rows = parseCsv((tree.get(csvPath) ?? Buffer.alloc(0)).toString('utf8'));
    if (rows.length === 0) continue;
    // The DB's pages live in a sibling folder named like the CSV (sans extension).
    const folder = csvPath.replace(/\.csv$/i, '');
    const byTitle = out.get(folder) ?? new Map<string, Record<string, string>>();
    const nameKey = rows[0] && 'Name' in rows[0] ? 'Name' : Object.keys(rows[0]!)[0]!;
    for (const row of rows) {
      const title = stripNotionId(row[nameKey] ?? '');
      if (title) byTitle.set(title, row);
    }
    out.set(folder, byTitle);
  }
  return out;
}

const RELATION_HINT_RE = /relation|rollup/i;

function renderProperties(row: Record<string, string>): {
  table: string;
  harvestedTags: string[];
  lossyProps: string[];
} {
  const harvestedTags: string[] = [];
  const lossyProps: string[] = [];
  const lines: string[] = [];
  for (const [key, value] of Object.entries(row)) {
    if (key === 'Name' || value.trim() === '') continue;
    if (/^tags?$|multi-?select/i.test(key)) {
      for (const t of value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean))
        harvestedTags.push(t);
    }
    if (RELATION_HINT_RE.test(key)) lossyProps.push(`${key} relation/rollup flattened to text`);
    lines.push(`| ${key} | ${value.replace(/\|/g, '\\|')} |`);
  }
  const table = lines.length > 0 ? `| Property | Value |\n| --- | --- |\n${lines.join('\n')}` : '';
  return { table, harvestedTags, lossyProps };
}

// ── Small parsers ────────────────────────────────────────────────────────────

/** RFC-4180-ish CSV parse (quoted fields, embedded commas/newlines/quotes). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((f) => f !== '')) rows.push(row);
  }
  if (rows.length === 0) return [];
  const header = rows[0]!;
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => {
      obj[h] = r[idx] ?? '';
    });
    return obj;
  });
}

function firstHeading(md: string): string {
  const m = /^#\s+(.+)$/m.exec(md);
  return m ? m[1]!.trim() : '';
}

/** Drop a leading `# Title` line so it isn't duplicated against the note's title. */
function stripLeadingTitle(md: string, title: string): string {
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === '') i += 1;
  if (i < lines.length) {
    const h = /^#\s+(.+)$/.exec(lines[i]!.trim());
    if (h && h[1]!.trim() === title) {
      lines.splice(0, i + 1);
      while (lines.length > 0 && lines[0]!.trim() === '') lines.shift();
      return lines.join('\n');
    }
  }
  return md;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function joinPosix(dir: string, target: string): string {
  if (dir === '') return target.replace(/^\.\//, '');
  const segments = `${dir}/${target}`.split('/');
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}
