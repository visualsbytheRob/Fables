import { isId } from '@fables/core';
import type { DateSpec, FqlNode } from './ast.js';

/**
 * FQL → SQL compiler (F273). Produces a WHERE fragment over `notes n`.
 *
 * STRICTLY parameterized: user strings only ever appear in `params`, never in
 * the SQL text — the fragment is assembled exclusively from fixed templates.
 */

export interface CompiledQuery {
  /** WHERE fragment over alias `n` (no leading WHERE, never empty). */
  where: string;
  params: unknown[];
}

/** Escapes LIKE wildcards so user input matches literally (ESCAPE '\'). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const LIKE_BOTH = `(n.title LIKE ? ESCAPE '\\' OR n.body LIKE ? ESCAPE '\\')`;

const TAG_EXISTS = `EXISTS (
  SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
  WHERE nt.note_id = n.id AND (t.name = ? OR t.name LIKE ? ESCAPE '\\'))`;

const ATTACHMENT_EXISTS = `EXISTS (SELECT 1 FROM attachments a WHERE a.note_id = n.id)`;

/** Matches by stored lowercased target title, so broken links count too. */
const LINKSTO_EXISTS = `EXISTS (
  SELECT 1 FROM links l
  WHERE l.source_type = 'note' AND l.source_id = n.id
    AND l.kind = 'wikilink' AND l.target_title = ?)`;

const pad = (value: number): string => String(value).padStart(2, '0');

/** [startInclusive, endExclusive) ISO-prefix bounds for a date spec. */
function dateBounds(spec: DateSpec, now: Date): { start?: string; end?: string } {
  switch (spec.kind) {
    case 'month': {
      const next =
        spec.month === 12 ? `${spec.year + 1}-01` : `${spec.year}-${pad(spec.month + 1)}`;
      return { start: `${spec.year}-${pad(spec.month)}`, end: next };
    }
    case 'day': {
      const [y, m, d] = spec.date.split('-').map(Number) as [number, number, number];
      const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
      return { start: spec.date, end: nextDay.toISOString().slice(0, 10) };
    }
    case 'relative': {
      const cutoff = new Date(now.getTime() - spec.days * 24 * 60 * 60 * 1000).toISOString();
      // >7d — newer than the cutoff (within the window); <30d — older than it.
      return spec.op === '>' ? { start: cutoff } : { end: cutoff };
    }
  }
}

function compileNode(node: FqlNode, params: unknown[], now: Date): string {
  switch (node.type) {
    case 'and':
      return `(${node.children.map((c) => compileNode(c, params, now)).join(' AND ')})`;
    case 'or':
      return `(${node.children.map((c) => compileNode(c, params, now)).join(' OR ')})`;
    case 'not':
      return `NOT ${compileNode(node.child, params, now)}`;
    case 'text': {
      const like = `%${escapeLike(node.value)}%`;
      params.push(like, like);
      return LIKE_BOTH;
    }
    case 'title':
      params.push(`%${escapeLike(node.value)}%`);
      return `n.title LIKE ? ESCAPE '\\'`;
    case 'body':
      params.push(`%${escapeLike(node.value)}%`);
      return `n.body LIKE ? ESCAPE '\\'`;
    case 'tag':
      // Exact tag plus nested children (tag:work also matches work/projects).
      params.push(node.value, `${escapeLike(node.value)}/%`);
      return TAG_EXISTS;
    case 'notebook':
      if (isId(node.value, 'nb')) {
        params.push(node.value);
        return `n.notebook_id = ?`;
      }
      params.push(node.value);
      return `n.notebook_id IN (SELECT id FROM notebooks WHERE name = ? COLLATE NOCASE)`;
    case 'has':
      return ATTACHMENT_EXISTS;
    case 'linksto':
      params.push(node.title.toLowerCase());
      return LINKSTO_EXISTS;
    case 'pinned':
      params.push(node.value ? 1 : 0);
      return `n.pinned = ?`;
    case 'date': {
      const column = node.field === 'created' ? 'n.created_at' : 'n.updated_at';
      const { start, end } = dateBounds(node.spec, now);
      const parts: string[] = [];
      if (start !== undefined) {
        parts.push(`${column} >= ?`);
        params.push(start);
      }
      if (end !== undefined) {
        parts.push(`${column} < ?`);
        params.push(end);
      }
      return parts.length === 1 ? parts[0]! : `(${parts.join(' AND ')})`;
    }
  }
}

/** Compiles a parsed query; `null` (empty query) compiles to a match-all. */
export function compileFql(ast: FqlNode | null, now: Date = new Date()): CompiledQuery {
  if (ast === null) return { where: '1 = 1', params: [] };
  const params: unknown[] = [];
  const where = compileNode(ast, params, now);
  return { where, params };
}
