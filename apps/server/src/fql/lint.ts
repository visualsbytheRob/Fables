/**
 * FQL linting with suggestions (Epic 20, F1968).
 *
 * Surfaces problems and gentle nudges before a query runs: hard syntax errors
 * (with position), likely-mistyped field names (nearest known field by edit
 * distance), lowercase boolean operators that FQL treats as search terms, and
 * shapes that will be slow or match everything. Pure: tokenize + parse, then
 * inspect.
 */

import { isAppError } from '@fables/core';
import { parseFql } from './parse.js';
import { tokenize, FqlError, type Token } from './tokenize.js';

export type LintSeverity = 'error' | 'warning' | 'info';

export interface LintFinding {
  severity: LintSeverity;
  message: string;
  position?: number | undefined;
  suggestion?: string | undefined;
}

const KNOWN_FIELDS = [
  'tag',
  'notebook',
  'title',
  'body',
  'has',
  'linksto',
  'pinned',
  'created',
  'updated',
  'sort',
];

const LOWER_KEYWORDS = new Set(['and', 'or', 'not']);

/** Levenshtein distance, capped — used to suggest the nearest field name. */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= n; j += 1) prev[j] = curr[j]!;
  }
  return prev[n]!;
}

function nearestField(name: string): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  for (const field of KNOWN_FIELDS) {
    const d = editDistance(name.toLowerCase(), field);
    if (d < bestDist) {
      bestDist = d;
      best = field;
    }
  }
  return bestDist > 0 && bestDist <= 2 ? best : undefined;
}

/** Inspect a query and return findings ordered by severity then position. */
export function lintQuery(source: string): LintFinding[] {
  const findings: LintFinding[] = [];
  const trimmed = source.trim();

  if (trimmed === '') {
    return [{ severity: 'info', message: 'empty query matches every note' }];
  }

  let tokens: Token[] = [];
  try {
    tokens = tokenize(source);
  } catch (error) {
    if (error instanceof FqlError) {
      findings.push({ severity: 'error', message: error.message, position: error.position });
      return findings;
    }
    throw error;
  }

  // Unknown / mistyped field names.
  for (const token of tokens) {
    if (token.type !== 'field') continue;
    if (token.name === 'sort') continue;
    if (!KNOWN_FIELDS.includes(token.name)) {
      const near = nearestField(token.name);
      findings.push({
        severity: 'error',
        message: `unknown field "${token.name}"`,
        position: token.position,
        ...(near !== undefined ? { suggestion: `did you mean "${near}:"?` } : {}),
      });
    }
    if (token.type === 'field' && token.name === 'tag' && token.value.startsWith('#')) {
      findings.push({
        severity: 'info',
        message: 'tag values don\'t need a leading "#"',
        position: token.position,
        suggestion: `tag:${token.value.replace(/^#+/, '')}`,
      });
    }
  }

  // Lowercase boolean keywords are treated as literal search terms.
  for (const token of tokens) {
    if (token.type === 'word' && LOWER_KEYWORDS.has(token.value)) {
      findings.push({
        severity: 'warning',
        message: `"${token.value}" is a search term — use uppercase ${token.value.toUpperCase()} for the boolean operator`,
        position: token.position,
        suggestion: token.value.toUpperCase(),
      });
    }
  }

  // Very broad single-character text terms.
  for (const token of tokens) {
    if (token.type === 'word' && token.value.length === 1 && /[a-z0-9]/i.test(token.value)) {
      findings.push({
        severity: 'warning',
        message: `single-character term "${token.value}" matches almost everything`,
        position: token.position,
      });
    }
  }

  // Hard parse errors (after the more specific checks above).
  try {
    const { warnings } = parseFql(source);
    for (const w of warnings) findings.push({ severity: 'warning', message: w });
  } catch (error) {
    if (isAppError(error) && error.code === 'VALIDATION') {
      const position = error.details?.position;
      findings.push({
        severity: 'error',
        message: error.message,
        ...(typeof position === 'number' ? { position } : {}),
      });
    } else {
      throw error;
    }
  }

  const rank: Record<LintSeverity, number> = { error: 0, warning: 1, info: 2 };
  return findings.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || (a.position ?? 0) - (b.position ?? 0),
  );
}
