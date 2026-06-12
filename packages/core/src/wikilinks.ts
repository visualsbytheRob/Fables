/**
 * Wikilink parsing (F201, F205, F207, F208, F210).
 *
 * Grammar (Obsidian-flavoured, single line, innermost wins on nesting):
 *   [[Target]]                  plain link
 *   [[Target|alias]]            display alias
 *   [[Target#Heading]]          heading link
 *   [[Target^blockid]]          block link (`blockid` is [A-Za-z0-9-]+)
 *
 * A backslash immediately before `[[` escapes the link. Links inside fenced
 * code blocks (``` / ~~~) and inline `code` spans never count. All offsets
 * are UTF-16 code units, matching `String.prototype` indexing everywhere.
 */

export interface Wikilink {
  /** Title part, trimmed (never empty). */
  target: string;
  /** Display alias after `|`, or null. */
  alias: string | null;
  /** Heading after `#`, or null. */
  heading: string | null;
  /** Block id after `^`, or null. */
  blockId: string | null;
  /** Offset of the opening `[[`. */
  start: number;
  /** Offset just past the closing `]]`. */
  end: number;
  /** The full matched text, brackets included. */
  raw: string;
}

export interface TextRange {
  start: number;
  end: number;
}

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

/** Character ranges covered by fenced code blocks, fence lines included. */
export function fencedRanges(body: string): TextRange[] {
  const ranges: TextRange[] = [];
  let fenceChar: string | null = null;
  let blockStart = 0;
  let offset = 0;
  for (const line of body.split('\n')) {
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const char = fence[1]![0]!;
      if (fenceChar === null) {
        fenceChar = char;
        blockStart = offset;
      } else if (fenceChar === char) {
        fenceChar = null;
        ranges.push({ start: blockStart, end: offset + line.length });
      }
    }
    offset += line.length + 1;
  }
  // An unclosed fence swallows the rest of the document.
  if (fenceChar !== null) ranges.push({ start: blockStart, end: body.length });
  return ranges;
}

/** Inline `code` spans outside fences: equal-length backtick runs on one line. */
function inlineCodeRanges(body: string, fenced: TextRange[]): TextRange[] {
  const ranges: TextRange[] = [];
  let offset = 0;
  for (const line of body.split('\n')) {
    if (!fenced.some((r) => offset >= r.start && offset < r.end)) {
      const runs = [...line.matchAll(/`+/g)];
      let i = 0;
      while (i < runs.length) {
        const open = runs[i]!;
        const close = runs.findIndex((r, j) => j > i && r[0].length === open[0].length);
        if (close === -1) {
          i += 1;
          continue;
        }
        const closer = runs[close]!;
        ranges.push({
          start: offset + open.index,
          end: offset + closer.index + closer[0].length,
        });
        i = close + 1;
      }
    }
    offset += line.length + 1;
  }
  return ranges;
}

/** All code ranges (fenced blocks + inline spans) where links and mentions are inert. */
export function codeRanges(body: string): TextRange[] {
  const fenced = fencedRanges(body);
  return [...fenced, ...inlineCodeRanges(body, fenced)].sort((a, b) => a.start - b.start);
}

const inRanges = (ranges: TextRange[], start: number, end: number): boolean =>
  ranges.some((r) => start < r.end && end > r.start);

const BLOCK_ID_RE = /^[A-Za-z0-9-]+$/;
const LINK_RE = /\[\[([^[\]\n]+)\]\]/g;

const nullIfEmpty = (s: string): string | null => (s === '' ? null : s);

/** Parses every wikilink in `body`, in document order. */
export function parseWikilinks(body: string): Wikilink[] {
  const excluded = codeRanges(body);
  const links: Wikilink[] = [];
  LINK_RE.lastIndex = 0;
  for (let match = LINK_RE.exec(body); match !== null; match = LINK_RE.exec(body)) {
    const start = match.index;
    const end = start + match[0].length;
    if (inRanges(excluded, start, end)) continue;
    if (body[start - 1] === '\\') continue; // \[[escaped]]
    const parsed = parseInner(match[1]!);
    if (!parsed) continue;
    links.push({ ...parsed, start, end, raw: match[0] });
  }
  return links;
}

function parseInner(
  inner: string,
): Pick<Wikilink, 'target' | 'alias' | 'heading' | 'blockId'> | null {
  const pipe = inner.indexOf('|');
  const targetPart = pipe === -1 ? inner : inner.slice(0, pipe);
  const alias = pipe === -1 ? null : nullIfEmpty(inner.slice(pipe + 1).trim());

  let target = targetPart;
  let heading: string | null = null;
  let blockId: string | null = null;
  const caret = targetPart.indexOf('^');
  const hash = targetPart.indexOf('#');
  if (caret !== -1 && (hash === -1 || caret < hash)) {
    blockId = targetPart.slice(caret + 1).trim();
    target = targetPart.slice(0, caret);
    if (!BLOCK_ID_RE.test(blockId)) return null; // malformed block ref
  } else if (hash !== -1) {
    heading = nullIfEmpty(targetPart.slice(hash + 1).trim());
    target = targetPart.slice(0, hash);
  }
  target = target.trim();
  if (target === '') return null;
  return { target, alias, heading, blockId };
}

/** Serializes link parts back to `[[...]]` syntax. */
export function formatWikilink(parts: {
  target: string;
  heading?: string | null;
  blockId?: string | null;
  alias?: string | null;
}): string {
  let inner = parts.target;
  if (parts.blockId != null) inner += `^${parts.blockId}`;
  else if (parts.heading != null) inner += `#${parts.heading}`;
  if (parts.alias != null) inner += `|${parts.alias}`;
  return `[[${inner}]]`;
}

/**
 * Rewrites the target of every wikilink matching `fromTitle`
 * (case-insensitive) to `toTitle`, preserving heading/block/alias parts.
 * Code spans and escaped links are untouched (F209).
 */
export function rewriteWikilinkTargets(body: string, fromTitle: string, toTitle: string): string {
  const fromLc = fromTitle.toLowerCase();
  let out = body;
  // Splice back-to-front so earlier offsets stay valid.
  for (const link of parseWikilinks(body).reverse()) {
    if (link.target.toLowerCase() !== fromLc) continue;
    const next = formatWikilink({ ...link, target: toTitle });
    out = out.slice(0, link.start) + next + out.slice(link.end);
  }
  return out;
}
