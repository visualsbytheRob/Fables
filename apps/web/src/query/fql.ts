/**
 * Client-side FQL helpers (F278, F283): token highlighting for the query bar,
 * field-name completion, and ```fql embed-block directive parsing. Mirrors the
 * server grammar in apps/server/src/fql — keep the field list in sync.
 */

/** Queryable fields with hints, shown by the completion popup (F278). */
export const FQL_FIELDS: { name: string; hint: string }[] = [
  { name: 'tag', hint: 'tag:reading' },
  { name: 'notebook', hint: 'notebook:Work' },
  { name: 'title', hint: 'title:"the fox"' },
  { name: 'body', hint: 'body:moral' },
  { name: 'has', hint: 'has:attachment' },
  { name: 'linksto', hint: 'linksto:[[Note Title]]' },
  { name: 'pinned', hint: 'pinned:true' },
  { name: 'created', hint: 'created:>7d or created:2026-06' },
  { name: 'updated', hint: 'updated:<30d' },
  { name: 'sort', hint: 'sort:updated desc' },
];

/** Per-field value completions (enumerable values only). */
const FIELD_VALUES: Record<string, string[]> = {
  has: ['attachment'],
  pinned: ['true', 'false'],
  sort: ['updated', 'created', 'title'],
};

export type FqlSegmentKind = 'field' | 'value' | 'operator' | 'phrase' | 'paren' | 'text' | 'ws';

export interface FqlSegment {
  text: string;
  kind: FqlSegmentKind;
}

const OPERATORS = new Set(['AND', 'OR', 'NOT']);
const FIELD_NAMES = new Set(FQL_FIELDS.map((f) => f.name));

/**
 * Splits a query string into contiguous display segments for the highlight
 * layer. Never throws and never changes the text — segments concatenate back
 * to the exact input, so the transparent <input> overlays perfectly.
 */
export function highlightFql(input: string): FqlSegment[] {
  const segments: FqlSegment[] = [];
  const push = (text: string, kind: FqlSegmentKind) => {
    if (text !== '') segments.push({ text, kind });
  };
  let i = 0;
  while (i < input.length) {
    const c = input[i]!;
    if (/\s/.test(c)) {
      let j = i;
      while (j < input.length && /\s/.test(input[j]!)) j += 1;
      push(input.slice(i, j), 'ws');
      i = j;
      continue;
    }
    if (c === '(' || c === ')') {
      push(c, 'paren');
      i += 1;
      continue;
    }
    if (c === '"') {
      const close = input.indexOf('"', i + 1);
      const end = close === -1 ? input.length : close + 1;
      push(input.slice(i, end), 'phrase');
      i = end;
      continue;
    }
    // Word or field:value (value may be quoted or [[bracketed]]).
    let j = i;
    while (j < input.length && !/[\s()"]/.test(input[j]!)) {
      if (input[j] === ':') break;
      j += 1;
    }
    if (input[j] === ':') {
      const name = input.slice(i, j);
      push(`${name}:`, FIELD_NAMES.has(name) ? 'field' : 'text');
      i = j + 1;
      if (input[i] === '"') {
        const close = input.indexOf('"', i + 1);
        const end = close === -1 ? input.length : close + 1;
        push(input.slice(i, end), 'phrase');
        i = end;
      } else if (input.startsWith('[[', i)) {
        const close = input.indexOf(']]', i + 2);
        const end = close === -1 ? input.length : close + 2;
        push(input.slice(i, end), 'value');
        i = end;
      } else {
        let k = i;
        while (k < input.length && !/[\s()"]/.test(input[k]!)) k += 1;
        push(input.slice(i, k), 'value');
        i = k;
      }
      continue;
    }
    const word = input.slice(i, j);
    push(word, OPERATORS.has(word) ? 'operator' : 'text');
    i = j;
  }
  return segments;
}

export interface FqlCompletion {
  /** Replacement range [from, to) in the input. */
  from: number;
  to: number;
  options: { label: string; apply: string; hint: string }[];
}

/**
 * Completion at `caret` (F278): suggests `field:` names while typing a bare
 * word, and enumerable values right after `has:` / `pinned:` / `sort:`.
 */
export function completeFql(input: string, caret: number): FqlCompletion | null {
  const before = input.slice(0, caret);
  // Value position: field name + colon + partial value, no space since.
  const valueMatch = /([A-Za-z]+):([A-Za-z]*)$/.exec(before);
  if (valueMatch) {
    const values = FIELD_VALUES[valueMatch[1]!.toLowerCase()];
    if (values) {
      const partial = valueMatch[2]!.toLowerCase();
      const options = values
        .filter((v) => v.startsWith(partial))
        .map((v) => ({ label: v, apply: v, hint: `${valueMatch[1]!}:${v}` }));
      if (options.length === 0) return null;
      return { from: caret - valueMatch[2]!.length, to: caret, options };
    }
    return null;
  }
  // Field-name position: a bare partial word (no colon yet).
  const wordMatch = /(^|[\s(])([A-Za-z]*)$/.exec(before);
  if (!wordMatch) return null;
  const partial = wordMatch[2]!.toLowerCase();
  const options = FQL_FIELDS.filter((f) => f.name.startsWith(partial)).map((f) => ({
    label: `${f.name}:`,
    apply: `${f.name}:`,
    hint: f.hint,
  }));
  if (options.length === 0 || (partial === '' && before.trim() !== '' && !/[\s(]$/.test(before))) {
    return null;
  }
  return { from: caret - partial.length, to: caret, options };
}

/* ===== ```fql embed blocks (F283–F285, F289) ===== */

export type EmbedMode = 'list' | 'table' | 'count';

export interface EmbedBlock {
  query: string;
  mode: EmbedMode;
  /** Result cap, always clamped to EMBED_MAX_RESULTS (F289). */
  limit: number;
  /** Directive problems worth surfacing (unknown mode, bad limit). */
  errors: string[];
}

export const EMBED_DEFAULT_RESULTS = 10;
export const EMBED_MAX_RESULTS = 50;

const MODES = new Set<string>(['list', 'table', 'count']);

/**
 * Parses the content of a ```fql fenced block. Leading `key: value` directive
 * lines configure the embed; everything else is the query:
 *
 *   ```fql
 *   mode: table
 *   limit: 5
 *   tag:reading sort:updated desc
 *   ```
 */
export function parseEmbedBlock(content: string): EmbedBlock {
  const errors: string[] = [];
  let mode: EmbedMode = 'list';
  let limit = EMBED_DEFAULT_RESULTS;
  const queryLines: string[] = [];
  let inDirectives = true;
  for (const line of content.split('\n')) {
    const directive = inDirectives ? /^(mode|limit)\s*:\s*(\S+)\s*$/.exec(line.trim()) : null;
    if (directive) {
      const [, key, value] = directive;
      if (key === 'mode') {
        if (MODES.has(value!)) mode = value as EmbedMode;
        else errors.push(`unknown mode "${value}" — use list, table, or count`);
      } else {
        const n = Number(value);
        if (Number.isInteger(n) && n > 0) limit = n;
        else errors.push(`limit must be a positive integer, got "${value}"`);
      }
      continue;
    }
    if (line.trim() !== '') inDirectives = false;
    queryLines.push(line);
  }
  if (limit > EMBED_MAX_RESULTS) {
    errors.push(`limit capped at ${EMBED_MAX_RESULTS}`);
    limit = EMBED_MAX_RESULTS;
  }
  return { query: queryLines.join('\n').trim(), mode, limit, errors };
}
