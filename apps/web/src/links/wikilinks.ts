/**
 * Client-side wikilink support (F203/F204/F206 web halves).
 *
 * Mirrors the server grammar in @fables/core/wikilinks (the web app has no
 * workspace dependency on core, so the slim parser is duplicated here):
 *   [[Target]] · [[Target|alias]] · [[Target#Heading]] · [[Target^blockid]]
 * Escaped `\[[…]]` and links inside fenced/inline code never count.
 */

export interface Wikilink {
  target: string;
  alias: string | null;
  heading: string | null;
  blockId: string | null;
  /** Offset of the opening `[[`. */
  start: number;
  /** Offset just past the closing `]]`. */
  end: number;
  raw: string;
}

interface TextRange {
  start: number;
  end: number;
}

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const BLOCK_ID_RE = /^[A-Za-z0-9-]+$/;
const LINK_RE = /\[\[([^[\]\n]+)\]\]/g;

/** Fenced code blocks plus inline backtick spans, where links are inert. */
function codeRanges(body: string): TextRange[] {
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
    } else if (fenceChar === null) {
      // Inline `code` spans: equal-length backtick runs on one line.
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
        ranges.push({ start: offset + open.index, end: offset + closer.index + closer[0].length });
        i = close + 1;
      }
    }
    offset += line.length + 1;
  }
  if (fenceChar !== null) ranges.push({ start: blockStart, end: body.length });
  return ranges;
}

const nullIfEmpty = (s: string): string | null => (s === '' ? null : s);

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
    if (!BLOCK_ID_RE.test(blockId)) return null;
  } else if (hash !== -1) {
    heading = nullIfEmpty(targetPart.slice(hash + 1).trim());
    target = targetPart.slice(0, hash);
  }
  target = target.trim();
  if (target === '') return null;
  return { target, alias, heading, blockId };
}

/** Parses every wikilink in `body`, in document order. */
export function parseWikilinks(body: string): Wikilink[] {
  const excluded = codeRanges(body);
  const links: Wikilink[] = [];
  LINK_RE.lastIndex = 0;
  for (let match = LINK_RE.exec(body); match !== null; match = LINK_RE.exec(body)) {
    const start = match.index;
    const end = start + match[0].length;
    if (excluded.some((r) => start < r.end && end > r.start)) continue;
    if (body[start - 1] === '\\') continue;
    const parsed = parseInner(match[1]!);
    if (!parsed) continue;
    links.push({ ...parsed, start, end, raw: match[0] });
  }
  return links;
}

/** The wikilink covering document offset `pos`, or null (Cmd-click in editor). */
export function wikilinkAt(body: string, pos: number): Wikilink | null {
  return parseWikilinks(body).find((l) => pos >= l.start && pos <= l.end) ?? null;
}

/** Display text for a link: alias, else target plus heading/block suffix. */
export function wikilinkDisplay(link: Pick<Wikilink, 'target' | 'alias' | 'heading'>): string {
  if (link.alias !== null) return link.alias;
  return link.heading !== null ? `${link.target} › ${link.heading}` : link.target;
}

/**
 * Href scheme carried through the markdown pipeline. Fragment hrefs survive
 * rehype-sanitize's default protocol allow-list, and `#` can't collide with
 * heading-anchor slugs because those never contain `=`.
 */
export const WIKILINK_HREF_PREFIX = '#wikilink=';

export const wikilinkHref = (link: Wikilink): string =>
  `${WIKILINK_HREF_PREFIX}${encodeURIComponent(link.raw.slice(2, -2))}`;

/** Decodes a preview href back into a parsed wikilink, or null. */
export function decodeWikilinkHref(href: string): Wikilink | null {
  if (!href.startsWith(WIKILINK_HREF_PREFIX)) return null;
  let inner: string;
  try {
    inner = decodeURIComponent(href.slice(WIKILINK_HREF_PREFIX.length));
  } catch {
    return null;
  }
  const parsed = parseInner(inner);
  if (!parsed) return null;
  return { ...parsed, start: 0, end: inner.length + 4, raw: `[[${inner}]]` };
}

/**
 * Rewrites `[[…]]` syntax into regular markdown links with `#wikilink=` hrefs
 * so the existing react-markdown pipeline renders them; the preview's `a`
 * component takes it from there (F204/F206).
 */
export function preprocessWikilinks(source: string): string {
  const links = parseWikilinks(source);
  if (links.length === 0) return source;
  let out = '';
  let last = 0;
  for (const link of links) {
    const label = wikilinkDisplay(link).replace(/([[\]\\])/g, '\\$1');
    out += source.slice(last, link.start) + `[${label}](${wikilinkHref(link)})`;
    last = link.end;
  }
  return out + source.slice(last);
}

/** Case-insensitive title → note id map (F204/F206 resolution). */
export function buildTitleIndex(notes: { id: string; title: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const note of notes) {
    const key = note.title.trim().toLowerCase();
    if (key !== '' && !map.has(key)) map.set(key, note.id);
  }
  return map;
}

export const resolveTitle = (index: Map<string, string>, target: string): string | null =>
  index.get(target.trim().toLowerCase()) ?? null;
