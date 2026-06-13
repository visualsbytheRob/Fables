/**
 * Story-wide search & replace (F516): a pure, client-side scan over the open
 * project buffers with an optional regex mode. Replacement returns the new
 * sources for changed files only; the store applies them as edits.
 */

export interface SearchOptions {
  readonly regex?: boolean;
  readonly caseSensitive?: boolean;
}

export interface SearchMatch {
  readonly path: string;
  /** 1-based line of the match start. */
  readonly line: number;
  readonly from: number;
  readonly to: number;
  readonly lineText: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build the scanning regex; returns null for empty/invalid patterns. */
export function compileQuery(query: string, options: SearchOptions = {}): RegExp | null {
  if (query.length === 0) return null;
  const body = options.regex === true ? query : escapeRegExp(query);
  const flags = options.caseSensitive === true ? 'g' : 'gi';
  try {
    return new RegExp(body, flags);
  } catch {
    return null;
  }
}

export function searchFiles(
  files: ReadonlyMap<string, string>,
  query: string,
  options: SearchOptions = {},
): SearchMatch[] {
  const re = compileQuery(query, options);
  if (re === null) return [];
  const matches: SearchMatch[] = [];
  for (const [path, source] of [...files.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let line = 1;
    let scanned = 0;
    while ((m = re.exec(source)) !== null) {
      for (; scanned < m.index; scanned++) if (source.charCodeAt(scanned) === 10) line++;
      const lineStart = source.lastIndexOf('\n', Math.max(0, m.index - 1)) + 1;
      const lineEndRaw = source.indexOf('\n', m.index);
      const lineEnd = lineEndRaw === -1 ? source.length : lineEndRaw;
      matches.push({
        path,
        line,
        from: m.index,
        to: m.index + m[0].length,
        lineText: source.slice(lineStart, lineEnd),
      });
      if (m[0].length === 0) re.lastIndex++;
      if (matches.length >= 500) return matches; // sanity cap
    }
  }
  return matches;
}

/** Replace every match; returns only the files whose source changed. */
export function replaceInFiles(
  files: ReadonlyMap<string, string>,
  query: string,
  replacement: string,
  options: SearchOptions = {},
): Map<string, string> {
  const changed = new Map<string, string>();
  const re = compileQuery(query, options);
  if (re === null) return changed;
  for (const [path, source] of files) {
    const next =
      options.regex === true
        ? source.replace(re, replacement)
        : source.replace(re, () => replacement);
    if (next !== source) changed.set(path, next);
  }
  return changed;
}
