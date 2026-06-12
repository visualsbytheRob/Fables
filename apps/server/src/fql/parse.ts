import { validation } from '@fables/core';
import {
  DEFAULT_SORT_DIRS,
  type DateSpec,
  type FqlNode,
  type ParsedQuery,
  type Sort,
  type SortKey,
} from './ast.js';
import { FqlError, tokenize, type Token } from './tokenize.js';

/**
 * FQL recursive-descent parser (F272, F274, F279).
 *
 * Grammar (precedence low → high):
 *   query   := orExpr?
 *   orExpr  := andExpr ('OR' andExpr)*
 *   andExpr := notExpr ('AND'? notExpr)*        -- adjacency is implicit AND
 *   notExpr := 'NOT' notExpr | primary
 *   primary := '(' orExpr ')' | phrase | word | field:value
 *
 * Operators must be uppercase (AND/OR/NOT) — lowercase "and" stays a search
 * term. `sort:key [asc|desc]` directives are extracted before parsing.
 */

const FIELDS = new Set([
  'tag',
  'notebook',
  'title',
  'body',
  'has',
  'linksto',
  'pinned',
  'created',
  'updated',
]);

const SORT_KEYS = new Set<string>(['updated', 'created', 'title']);

const MONTH_RE = /^(\d{4})-(\d{2})$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RELATIVE_RE = /^([<>])(\d+)d$/;

function parseDateSpec(value: string, position: number): DateSpec {
  const relative = RELATIVE_RE.exec(value);
  if (relative)
    return { kind: 'relative', op: relative[1] as '>' | '<', days: Number(relative[2]) };
  const day = DAY_RE.exec(value);
  if (day) return { kind: 'day', date: value };
  const month = MONTH_RE.exec(value);
  if (month) {
    const m = Number(month[2]);
    if (m >= 1 && m <= 12) return { kind: 'month', year: Number(month[1]), month: m };
  }
  throw new FqlError(
    `invalid date filter "${value}" — use YYYY-MM, YYYY-MM-DD, >7d, or <30d`,
    position,
  );
}

function fieldNode(token: Token & { type: 'field' }, index: number): FqlNode {
  const { name, value, position } = token;
  if (!FIELDS.has(name)) {
    throw new FqlError(
      `unknown field "${name}" — expected one of ${[...FIELDS].join(', ')}, sort`,
      position,
      index,
    );
  }
  if (value === '') throw new FqlError(`field "${name}" is missing a value`, position, index);
  try {
    switch (name) {
      case 'tag':
        return { type: 'tag', value: value.toLowerCase().replace(/^#+/, '') };
      case 'notebook':
        return { type: 'notebook', value };
      case 'title':
        return { type: 'title', value };
      case 'body':
        return { type: 'body', value };
      case 'has':
        if (value !== 'attachment') {
          throw new FqlError(`has: supports only "attachment", got "${value}"`, position);
        }
        return { type: 'has', what: 'attachment' };
      case 'linksto':
        return { type: 'linksto', title: value };
      case 'pinned':
        if (value !== 'true' && value !== 'false') {
          throw new FqlError(`pinned: expects true or false, got "${value}"`, position);
        }
        return { type: 'pinned', value: value === 'true' };
      default:
        return {
          type: 'date',
          field: name as 'created' | 'updated',
          spec: parseDateSpec(value, position),
        };
    }
  } catch (error) {
    // Re-tag value errors with the token index so error recovery can cut here.
    if (error instanceof FqlError && error.tokenIndex === undefined) {
      throw new FqlError(error.message, error.position, index);
    }
    throw error;
  }
}

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): FqlNode | null {
    if (this.tokens.length === 0) return null;
    const node = this.orExpr();
    const leftover = this.tokens[this.pos];
    if (leftover) {
      const what = leftover.type === 'rparen' ? 'unmatched ")"' : 'unexpected token';
      throw new FqlError(what, leftover.position, this.pos);
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private isWord(token: Token | undefined, text: string): boolean {
    return token?.type === 'word' && token.value === text;
  }

  private orExpr(): FqlNode {
    const children = [this.andExpr()];
    while (this.isWord(this.peek(), 'OR')) {
      this.pos += 1;
      children.push(this.andExpr());
    }
    return children.length === 1 ? children[0]! : { type: 'or', children };
  }

  private andExpr(): FqlNode {
    const children = [this.notExpr()];
    for (;;) {
      const next = this.peek();
      if (!next || next.type === 'rparen' || this.isWord(next, 'OR')) break;
      if (this.isWord(next, 'AND')) this.pos += 1; // explicit AND between clauses
      children.push(this.notExpr());
    }
    return children.length === 1 ? children[0]! : { type: 'and', children };
  }

  private notExpr(): FqlNode {
    const token = this.peek();
    if (this.isWord(token, 'NOT')) {
      this.pos += 1;
      const next = this.peek();
      if (!next) {
        throw new FqlError('NOT needs a clause to negate', token!.position, this.pos - 1);
      }
      return { type: 'not', child: this.notExpr() };
    }
    return this.primary();
  }

  private primary(): FqlNode {
    const token = this.peek();
    if (!token) {
      const last = this.tokens[this.tokens.length - 1];
      throw new FqlError('unexpected end of query', last ? last.position : 0, this.pos);
    }
    switch (token.type) {
      case 'lparen': {
        this.pos += 1;
        const inner = this.orExpr();
        const close = this.peek();
        if (close?.type !== 'rparen') {
          throw new FqlError('missing closing ")"', token.position, this.pos);
        }
        this.pos += 1;
        return inner;
      }
      case 'rparen':
        throw new FqlError('unmatched ")"', token.position, this.pos);
      case 'phrase':
        this.pos += 1;
        return { type: 'text', value: token.value, phrase: true };
      case 'word':
        if (token.value === 'AND' || token.value === 'OR') {
          throw new FqlError(
            `${token.value} needs a clause on both sides`,
            token.position,
            this.pos,
          );
        }
        this.pos += 1;
        return { type: 'text', value: token.value, phrase: false };
      case 'field':
        this.pos += 1;
        return fieldNode(token, this.pos - 1);
    }
  }
}

/** Pulls `sort:key [asc|desc]` directives (F277) out of the token stream. */
function extractSort(tokens: Token[], warnings: string[]): { rest: Token[]; sort: Sort } {
  const rest: Token[] = [];
  let sort: Sort | null = null;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token.type !== 'field' || token.name !== 'sort') {
      rest.push(token);
      continue;
    }
    if (!SORT_KEYS.has(token.value)) {
      throw new FqlError(
        `sort: expects updated, created, or title — got "${token.value}"`,
        token.position,
      );
    }
    const key = token.value as SortKey;
    let dir = DEFAULT_SORT_DIRS[key];
    const next = tokens[i + 1];
    if (next?.type === 'word' && (next.value === 'asc' || next.value === 'desc')) {
      dir = next.value;
      i += 1;
    }
    if (sort) warnings.push('multiple sort directives — the last one wins');
    sort = { key, dir };
  }
  return { rest, sort: sort ?? { key: 'updated', dir: 'desc' } };
}

/**
 * Parses an FQL query. Tokenizer/sort errors and errors on the very first
 * clause are fatal (VALIDATION with details.position); an unparseable
 * *trailing* clause degrades to a warning + the longest parseable prefix (F279).
 */
export function parseFql(input: string): ParsedQuery {
  const warnings: string[] = [];
  let tokens: Token[];
  let sort: Sort;
  try {
    ({ rest: tokens, sort } = extractSort(tokenize(input), warnings));
  } catch (error) {
    if (error instanceof FqlError) {
      throw validation(`FQL syntax error: ${error.message}`, { position: error.position });
    }
    throw error;
  }

  if (tokens.length === 0) return { ast: null, sort, warnings };

  let cut = tokens.length;
  let firstError: FqlError | null = null;
  while (cut > 0) {
    try {
      const ast = new Parser(tokens.slice(0, cut)).parse();
      if (firstError) {
        warnings.push(
          `ignored unparseable clause at position ${firstError.position}: ${firstError.message}`,
        );
      }
      return { ast, sort, warnings };
    } catch (error) {
      if (!(error instanceof FqlError)) throw error;
      firstError ??= error;
      const errorIndex = error.tokenIndex ?? 0;
      // Cut the query just before the failing token and retry (must shrink).
      cut = Math.min(cut - 1, errorIndex);
    }
  }

  const fatal = firstError ?? new FqlError('unparseable query', 0);
  throw validation(`FQL syntax error: ${fatal.message}`, { position: fatal.position });
}
