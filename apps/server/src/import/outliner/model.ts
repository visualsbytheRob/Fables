/**
 * Shared outliner model (Roam + Logseq).
 *
 * Both tools are block outliners: a page is a tree of blocks, each with optional
 * text, a stable `uid`, and children. This module turns that tree into Fables
 * markdown and rewrites the outliner-specific syntax into framework placeholders:
 *
 *   indentation        → nested markdown bullets (F1445)
 *   referenced block   → trailing `^uid` anchor on its line (F1446)
 *   [[Page]]           → {{link:pageId}} (F1443 page links)
 *   ((uid))            → link to the block's owning page + lossy note (F1443)
 *   #tag / #[[tag]]    → harvested tags
 *   {{query …}}        → best-effort FQL in a code block + lossy note (F1447)
 *   daily-note titles  → the Journal notebook + the note's date (F1444)
 *   A/B/C namespaces   → nested notebooks when enabled (F1448)
 */

import type { StagedDoc, StagedLink } from '../framework/index.js';

export interface OutlinerBlock {
  uid?: string | undefined;
  text: string;
  children: OutlinerBlock[];
}

export interface OutlinerPage {
  title: string;
  blocks: OutlinerBlock[];
  /** Pre-known date for daily notes (ISO), when the source provides one. */
  date?: string | undefined;
}

export interface OutlinerOptions {
  source: string;
  /** 'nest' maps `A/B/C` page titles to nested notebooks; 'flat' keeps the title. */
  namespaces: 'nest' | 'flat';
  /** Notebook daily notes are filed under (F1444). */
  journalNotebook: string;
}

export const DEFAULT_OUTLINER_OPTIONS: Omit<OutlinerOptions, 'source'> = {
  namespaces: 'flat',
  journalNotebook: 'Journal',
};

/** Fables block ids accept `[A-Za-z0-9-]`; coerce a foreign uid into that charset. */
export function sanitizeUid(uid: string): string {
  return uid.replace(/[^A-Za-z0-9-]/g, '-');
}

const pageId = (title: string): string => title.trim().toLowerCase();

// ── Public: convert pages → staged docs ──────────────────────────────────────

export function outlinerToStaged(pages: OutlinerPage[], opts: OutlinerOptions): StagedDoc[] {
  // Global indexes for cross-page resolution.
  const uidToPage = new Map<string, string>(); // sanitized uid → owning page id
  const titleSet = new Set<string>();
  for (const page of pages) {
    titleSet.add(pageId(page.title));
    walk(page.blocks, (b) => {
      if (b.uid) uidToPage.set(sanitizeUid(b.uid), pageId(page.title));
    });
  }
  const referenced = collectReferencedUids(pages);

  return pages.map((page) => buildDoc(page, opts, uidToPage, referenced));
}

function buildDoc(
  page: OutlinerPage,
  opts: OutlinerOptions,
  uidToPage: Map<string, string>,
  referenced: Set<string>,
): StagedDoc {
  const links: StagedLink[] = [];
  const tags = new Set<string>();
  const lossy = new Set<string>();
  const ctx = { opts, uidToPage, referenced, links, tags, lossy };

  const body = page.blocks.map((b) => renderBlock(b, 0, ctx)).join('\n');

  const daily = page.date ?? detectDailyNote(page.title);
  const { notebookPath, title } = mapTitle(page.title, opts, daily);

  const doc: StagedDoc = {
    sourceId: pageId(page.title),
    title,
    body: body.trim(),
    notebookPath,
    tags: [...tags],
    assets: [],
    links: dedupeLinks(links),
  };
  if (daily) doc.createdAt = daily;
  if (lossy.size > 0) doc.metadata = { lossy: [...lossy] };
  return doc;
}

interface RenderCtx {
  opts: OutlinerOptions;
  uidToPage: Map<string, string>;
  referenced: Set<string>;
  links: StagedLink[];
  tags: Set<string>;
  lossy: Set<string>;
}

function renderBlock(block: OutlinerBlock, depth: number, ctx: RenderCtx): string {
  const indent = '  '.repeat(depth);
  let text = rewriteText(block.text, ctx);
  // F1446: anchor blocks that are referenced elsewhere so the link survives.
  if (block.uid && ctx.referenced.has(sanitizeUid(block.uid))) {
    text = `${text} ^${sanitizeUid(block.uid)}`;
  }
  const line = text.trim() === '' ? `${indent}-` : `${indent}- ${text}`;
  const childLines = block.children.map((c) => renderBlock(c, depth + 1, ctx));
  return [line, ...childLines].join('\n');
}

// ── Syntax rewriting ─────────────────────────────────────────────────────────

const PAGE_LINK_RE = /\[\[([^\]]+)\]\]/g;
const BLOCK_REF_RE = /\(\(([^)]+)\)\)/g;
const TAG_RE = /#\[\[([^\]]+)\]\]|#([A-Za-z0-9_/-]+)/g;
const QUERY_RE = /\{\{(?:\[\[)?query(?:\]\])?:?\s*([\s\S]*?)\}\}/gi;

function rewriteText(raw: string, ctx: RenderCtx): string {
  let text = raw;

  // Queries first (F1447) — before we strip their inner [[…]] as page links.
  text = text.replace(QUERY_RE, (_m, inner: string) => {
    ctx.lossy.add('query translated best-effort to FQL');
    return `\`\`\`fql\n${queryToFql(inner)}\n\`\`\``;
  });

  // Tags (F harvested) — before page links so `#[[A]]` isn't taken as a link.
  text = text.replace(TAG_RE, (_m, bracketed: string | undefined, bare: string | undefined) => {
    const name = (bracketed ?? bare ?? '').trim();
    if (name) ctx.tags.add(name);
    return `#${name}`;
  });

  // Block references (F1443): resolve to the owning page, keep navigable.
  text = text.replace(BLOCK_REF_RE, (_m, uid: string) => {
    const owner = ctx.uidToPage.get(sanitizeUid(uid.trim()));
    if (owner) {
      ctx.links.push({ targetSourceId: owner, label: `block ((${uid.trim()}))` });
      ctx.lossy.add('block reference mapped to a page link');
      return `{{link:${owner}}}`;
    }
    return _m;
  });

  // Page links (F1443).
  text = text.replace(PAGE_LINK_RE, (_m, title: string) => {
    const target = pageId(title.trim());
    ctx.links.push({ targetSourceId: target, label: title.trim() });
    return `{{link:${target}}}`;
  });

  return text;
}

/** Best-effort Roam/Logseq query → FQL: pull out page/tag terms (F1447). */
export function queryToFql(query: string): string {
  const terms: string[] = [];
  for (const m of query.matchAll(/\[\[([^\]]+)\]\]/g)) terms.push(`links:"${m[1]!.trim()}"`);
  for (const m of query.matchAll(/#([A-Za-z0-9_/-]+)/g)) terms.push(`tag:${m[1]!}`);
  return terms.length > 0 ? terms.join(' AND ') : `# unsupported query: ${query.trim()}`;
}

// ── Daily notes + namespaces ─────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

/** Detect a Roam/Logseq daily-note title and return its ISO date, else null (F1444). */
export function detectDailyNote(title: string): string | undefined {
  // Roam: "January 1st, 2026"
  const roam = /^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,\s+(\d{4})$/.exec(title.trim());
  if (roam) {
    const month = MONTHS[roam[1]!.toLowerCase()];
    if (month) return iso(Number(roam[3]), month, Number(roam[2]));
  }
  // Logseq: "2026_01_01" or "2026-01-01"
  const logseq = /^(\d{4})[_-](\d{2})[_-](\d{2})$/.exec(title.trim());
  if (logseq) return iso(Number(logseq[1]), Number(logseq[2]), Number(logseq[3]));
  return undefined;
}

function iso(y: number, m: number, d: number): string | undefined {
  const date = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function mapTitle(
  rawTitle: string,
  opts: OutlinerOptions,
  daily: string | undefined,
): { notebookPath: string[]; title: string } {
  if (daily) return { notebookPath: [opts.journalNotebook], title: rawTitle.trim() };
  if (opts.namespaces === 'nest' && rawTitle.includes('/')) {
    const parts = rawTitle
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);
    const title = parts.pop() ?? rawTitle;
    return { notebookPath: parts, title };
  }
  return { notebookPath: [], title: rawTitle.trim() };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function walk(blocks: OutlinerBlock[], fn: (b: OutlinerBlock) => void): void {
  for (const b of blocks) {
    fn(b);
    walk(b.children, fn);
  }
}

function collectReferencedUids(pages: OutlinerPage[]): Set<string> {
  const refs = new Set<string>();
  for (const page of pages) {
    walk(page.blocks, (b) => {
      for (const m of b.text.matchAll(BLOCK_REF_RE)) refs.add(sanitizeUid(m[1]!.trim()));
    });
  }
  return refs;
}

function dedupeLinks(links: StagedLink[]): StagedLink[] {
  const seen = new Set<string>();
  const out: StagedLink[] = [];
  for (const l of links) {
    if (seen.has(l.targetSourceId)) continue;
    seen.add(l.targetSourceId);
    out.push(l);
  }
  return out;
}
