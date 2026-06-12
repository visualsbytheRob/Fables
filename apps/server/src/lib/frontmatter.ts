/**
 * Minimal hand-rolled YAML frontmatter (F293) — no dependency. Supports the
 * subset real vaults (incl. Obsidian) actually use for note metadata:
 *
 *   ---
 *   title: My Note          scalars (quoted or bare; true/false → boolean)
 *   tags: [a, b]            inline lists
 *   aliases:                block lists
 *     - One
 *     - Two
 *   created: 2024-01-01T00:00:00Z
 *   ---
 *
 * Lenient by design: lines it doesn't understand are skipped, and a document
 * without a frontmatter block returns `{ data: {}, body: text }` unchanged.
 * Serialization (`formatFrontmatter`) round-trips through this parser.
 */

export type FrontmatterValue = string | boolean | string[];

export interface Frontmatter {
  data: Record<string, FrontmatterValue>;
  /** Document body with the frontmatter block stripped. */
  body: string;
}

const KEY_RE = /^([A-Za-z0-9_-]+):(.*)$/;

function unquote(raw: string): string {
  const v = raw.trim();
  if (
    v.length >= 2 &&
    ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

function parseScalar(raw: string): string | boolean {
  const v = raw.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return unquote(v);
}

function parseInlineList(raw: string): string[] {
  const inner = raw.trim().slice(1, -1).trim();
  if (inner === '') return [];
  return inner.split(',').map((item) => unquote(item));
}

export function parseFrontmatter(text: string): Frontmatter {
  if (!text.startsWith('---\n')) return { data: {}, body: text };
  const lines = text.split('\n');
  let closing = -1;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]!.trimEnd();
    if (line === '---' || line === '...') {
      closing = i;
      break;
    }
  }
  if (closing === -1) return { data: {}, body: text };

  const data: Record<string, FrontmatterValue> = {};
  let i = 1;
  while (i < closing) {
    const line = lines[i]!;
    const match = KEY_RE.exec(line);
    if (!match) {
      i += 1; // indented continuation / comment / unsupported syntax — skip
      continue;
    }
    const key = match[1]!;
    const rest = match[2]!.trim();
    if (rest === '' || rest.startsWith('#')) {
      // Possible block list on the following indented `- item` lines.
      const items: string[] = [];
      let j = i + 1;
      while (j < closing) {
        const itemMatch = /^\s+-\s*(.*)$/.exec(lines[j]!);
        if (!itemMatch) break;
        items.push(unquote(itemMatch[1]!));
        j += 1;
      }
      if (items.length > 0) {
        data[key] = items;
        i = j;
        continue;
      }
      data[key] = '';
      i += 1;
      continue;
    }
    if (rest.startsWith('[') && rest.endsWith(']')) {
      data[key] = parseInlineList(rest);
    } else {
      data[key] = parseScalar(rest);
    }
    i += 1;
  }
  return {
    data,
    body: lines
      .slice(closing + 1)
      .join('\n')
      .replace(/^\n/, ''),
  };
}

const needsQuoting = (value: string): boolean =>
  value === '' || /[:#[\]{}"'\n]|^[\s>|&*!%@`-]|\s$|^\s/.test(value) || value !== value.trim();

const scalar = (value: string | boolean): string => {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return needsQuoting(value) ? JSON.stringify(value) : value;
};

/** Serializes a frontmatter block (export side, F295). Empty data → ''. */
export function formatFrontmatter(data: Record<string, FrontmatterValue | undefined>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${scalar(item)}`);
    } else {
      lines.push(`${key}: ${scalar(value)}`);
    }
  }
  if (lines.length === 0) return '';
  return `---\n${lines.join('\n')}\n---\n`;
}
