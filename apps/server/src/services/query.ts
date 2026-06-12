import { validation, type Note, type NotebookId, type NoteId } from '@fables/core';
import type { Db } from '../db/connection.js';
import { compileFql, parseFql, type Sort } from '../fql/index.js';

/**
 * FQL execution (F273, F277): compiles a query and runs it over live notes
 * with the same keyset pagination contract as `notesRepo.list`.
 */

const SORT_COLUMNS: Record<Sort['key'], string> = {
  updated: 'updated_at',
  created: 'created_at',
  title: 'title',
};

interface Row {
  id: string;
  notebook_id: string;
  title: string;
  body: string;
  pinned: number;
  trashed_at: string | null;
  created_at: string;
  updated_at: string;
  rev: number;
}

const toNote = (row: Row): Note => ({
  id: row.id as NoteId,
  notebookId: row.notebook_id as NotebookId,
  title: row.title,
  body: row.body,
  pinned: row.pinned === 1,
  trashedAt: row.trashed_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  rev: row.rev,
});

export interface FqlRunResult {
  notes: Note[];
  warnings: string[];
}

/** Parses + compiles + executes `q`, returning `fetch` rows from `cursor`. */
export function runFqlQuery(
  db: Db,
  q: string,
  opts: { fetch: number; cursor: string | null; now?: Date },
): FqlRunResult {
  const { ast, sort, warnings } = parseFql(q);
  const { where, params } = compileFql(ast, opts.now ?? new Date());

  const column = SORT_COLUMNS[sort.key];
  const dir = sort.dir === 'asc' ? 'ASC' : 'DESC';
  const conditions = ['n.trashed_at IS NULL', `(${where})`];
  const args: unknown[] = [...params];

  if (opts.cursor !== null) {
    const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(opts.cursor) as Row | undefined;
    if (!row) throw validation('unknown cursor', { cursor: opts.cursor });
    const cmp = dir === 'DESC' ? '<' : '>';
    conditions.push(`(n.${column} ${cmp} ? OR (n.${column} = ? AND n.id ${cmp} ?))`);
    const value = row[column as 'updated_at' | 'created_at' | 'title'];
    args.push(value, value, row.id);
  }

  const sql = `SELECT n.* FROM notes n WHERE ${conditions.join(' AND ')}
               ORDER BY n.${column} ${dir}, n.id ${dir} LIMIT ?`;
  const rows = db.prepare(sql).all(...args, opts.fetch) as Row[];
  return { notes: rows.map(toNote), warnings };
}

/** Hard cap on rows in a markdown export (F288). */
export const EXPORT_ROW_LIMIT = 1000;

const cell = (value: string): string => value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** Renders query results as a markdown table: title, notebook, updated (F288). */
export function exportQueryMarkdown(db: Db, q: string, now?: Date): string {
  const { notes } = runFqlQuery(db, q, {
    fetch: EXPORT_ROW_LIMIT,
    cursor: null,
    ...(now !== undefined ? { now } : {}),
  });
  const notebookNames = new Map(
    (db.prepare('SELECT id, name FROM notebooks').all() as { id: string; name: string }[]).map(
      (r) => [r.id, r.name],
    ),
  );
  const lines = ['| Title | Notebook | Updated |', '| --- | --- | --- |'];
  for (const note of notes) {
    const title = note.title === '' ? '(untitled)' : note.title;
    const notebook = notebookNames.get(note.notebookId) ?? note.notebookId;
    lines.push(`| ${cell(title)} | ${cell(notebook)} | ${note.updatedAt.slice(0, 10)} |`);
  }
  return `${lines.join('\n')}\n`;
}
