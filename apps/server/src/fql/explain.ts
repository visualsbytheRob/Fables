/**
 * FQL EXPLAIN (Epic 20, F1965).
 *
 * A static, heuristic plan for a parsed query: walks the AST, estimates the
 * relative cost of each clause, names the index/subquery each one leans on, and
 * flags shapes that can't use an index (leading-wildcard LIKE). No database is
 * touched — this reads the AST the compiler would lower, so authors can reason
 * about a query before running it.
 */

import type { FqlNode } from './ast.js';

export interface ExplainStep {
  clause: string;
  /** 'scan' (no index), 'index' (subquery/index lookup) or 'range'. */
  access: 'scan' | 'index' | 'range';
  cost: number;
  detail: string;
}

export interface QueryPlan {
  steps: ExplainStep[];
  estimatedCost: number;
  indexes: string[];
  warnings: string[];
}

const COST = { scan: 100, index: 10, range: 20 } as const;

function stepFor(node: FqlNode, warnings: string[]): ExplainStep[] {
  switch (node.type) {
    case 'and':
    case 'or':
      return node.children.flatMap((c) => stepFor(c, warnings));
    case 'not':
      return stepFor(node.child, warnings);
    case 'text':
      warnings.push(
        `text term "${node.value}" scans title+body with a leading-wildcard LIKE (no index)`,
      );
      return [
        {
          clause: `text:${node.value}`,
          access: 'scan',
          cost: COST.scan * 2,
          detail: 'LIKE on title and body',
        },
      ];
    case 'title':
    case 'body':
      warnings.push(`${node.type}: uses a leading-wildcard LIKE and cannot use an index`);
      return [
        {
          clause: `${node.type}:${node.value}`,
          access: 'scan',
          cost: COST.scan,
          detail: `LIKE on ${node.type}`,
        },
      ];
    case 'tag':
      return [
        {
          clause: `tag:${node.value}`,
          access: 'index',
          cost: COST.index,
          detail: 'EXISTS over note_tags/tags',
        },
      ];
    case 'notebook':
      return [
        {
          clause: `notebook:${node.value}`,
          access: 'index',
          cost: COST.index,
          detail: 'notebook_id lookup',
        },
      ];
    case 'linksto':
      return [
        {
          clause: `linksto:${node.title}`,
          access: 'index',
          cost: COST.index,
          detail: 'EXISTS over links',
        },
      ];
    case 'has':
      return [
        {
          clause: 'has:attachment',
          access: 'index',
          cost: COST.index,
          detail: 'EXISTS over attachments',
        },
      ];
    case 'pinned':
      return [
        {
          clause: `pinned:${node.value}`,
          access: 'scan',
          cost: COST.scan / 2,
          detail: 'pinned flag scan',
        },
      ];
    case 'date':
      return [
        {
          clause: `${node.field} date`,
          access: 'range',
          cost: COST.range,
          detail: `${node.field}_at range bounds`,
        },
      ];
  }
}

const INDEX_FOR: Partial<Record<FqlNode['type'], string>> = {
  tag: 'note_tags',
  notebook: 'notebooks',
  linksto: 'links',
  has: 'attachments',
  date: 'notes(created_at/updated_at)',
};

function collectIndexes(node: FqlNode, into: Set<string>): void {
  const idx = INDEX_FOR[node.type];
  if (idx) into.add(idx);
  if (node.type === 'and' || node.type === 'or')
    node.children.forEach((c) => collectIndexes(c, into));
  if (node.type === 'not') collectIndexes(node.child, into);
}

/** Produce a static plan for a parsed AST (null = match-all). */
export function explainQuery(ast: FqlNode | null): QueryPlan {
  if (ast === null) {
    return {
      steps: [
        { clause: 'all notes', access: 'scan', cost: COST.scan, detail: 'no filter — full scan' },
      ],
      estimatedCost: COST.scan,
      indexes: [],
      warnings: ['empty query matches every note'],
    };
  }
  const warnings: string[] = [];
  const steps = stepFor(ast, warnings);
  const indexes = new Set<string>();
  collectIndexes(ast, indexes);
  const estimatedCost = steps.reduce((sum, s) => sum + s.cost, 0);
  return { steps, estimatedCost, indexes: [...indexes].sort(), warnings };
}
