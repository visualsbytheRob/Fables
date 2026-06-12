/**
 * FQL — Fables Query Language — AST (F271, F274–F277).
 *
 * The parser produces a pure data tree; the compiler in `compile.ts` turns it
 * into a parameterized SQL WHERE clause. Nothing here touches the database.
 */

export type SortKey = 'updated' | 'created' | 'title';
export type SortDir = 'asc' | 'desc';

export interface Sort {
  key: SortKey;
  dir: SortDir;
}

/** Date filter payloads (F276). Relative cutoffs resolve at compile time. */
export type DateSpec =
  | { kind: 'month'; year: number; month: number } // created:2026-06
  | { kind: 'day'; date: string } // created:2026-06-12
  | { kind: 'relative'; op: '>' | '<'; days: number }; // updated:>7d (within), <30d (older)

export type FqlNode =
  | { type: 'and'; children: FqlNode[] }
  | { type: 'or'; children: FqlNode[] }
  | { type: 'not'; child: FqlNode }
  /** Bare term or "quoted phrase" — matches title OR body (LIKE until FTS lands, F271). */
  | { type: 'text'; value: string; phrase: boolean }
  | { type: 'tag'; value: string }
  | { type: 'notebook'; value: string }
  | { type: 'title'; value: string }
  | { type: 'body'; value: string }
  | { type: 'has'; what: 'attachment' }
  | { type: 'linksto'; title: string }
  | { type: 'pinned'; value: boolean }
  | { type: 'date'; field: 'created' | 'updated'; spec: DateSpec };

export interface ParsedQuery {
  /** null for an empty/whitespace-only query (matches everything). */
  ast: FqlNode | null;
  sort: Sort;
  /** Non-fatal issues: unparseable trailing clauses, duplicate sorts… (F279). */
  warnings: string[];
}

export const DEFAULT_SORT_DIRS: Record<SortKey, SortDir> = {
  updated: 'desc',
  created: 'desc',
  title: 'asc',
};
