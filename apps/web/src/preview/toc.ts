/**
 * Heading extraction for anchors + table of contents (F138).
 *
 * Walks the markdown source (skipping fenced code) rather than the hast tree:
 * the remark AST isn't directly importable here, and this keeps the TOC usable
 * without rendering the preview at all.
 */
export interface TocEntry {
  depth: number;
  text: string;
  slug: string;
}

/** GitHub-style slug: lowercase, strip punctuation, spaces → hyphens. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

/** Strip the inline markdown that commonly appears in headings. */
function plainText(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images → alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → text
    .replace(/[`*_~]/g, '')
    .replace(/\s+#+\s*$/, '') // trailing closing hashes
    .trim();
}

export function extractHeadings(source: string): TocEntry[] {
  const entries: TocEntry[] = [];
  let fence: string | null = null;
  for (const line of source.split('\n')) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]?.[0] ?? '`';
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!heading) continue;
    const text = plainText(heading[2] ?? '');
    if (!text) continue;
    entries.push({ depth: heading[1]?.length ?? 1, text, slug: slugify(text) });
  }
  return entries;
}
