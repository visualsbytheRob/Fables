/**
 * FQL computed-field expressions (Epic 20, F1963).
 *
 * A tiny, sandboxed expression language for derived result columns: arithmetic,
 * string concatenation, comparisons and a handful of functions over a result
 * row's fields. No identifiers resolve to anything but the row's own values, so
 * an expression can never reach outside the data it is given. Pure: parse once,
 * evaluate per row.
 */

export type ExprValue = number | string | boolean | null;
export type Row = Record<string, unknown>;

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ident'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lparen' }
  | { t: 'rparen' }
  | { t: 'comma' };

export class ExprError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExprError';
  }
}

const OPERATORS = new Set(['+', '-', '*', '/', '%', '>', '<', '>=', '<=', '==', '!=']);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '(') {
      tokens.push({ t: 'lparen' });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ t: 'rparen' });
      i += 1;
      continue;
    }
    if (ch === ',') {
      tokens.push({ t: 'comma' });
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let value = '';
      i += 1;
      while (i < input.length && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < input.length) {
          value += input[i + 1];
          i += 2;
        } else {
          value += input[i];
          i += 1;
        }
      }
      if (i >= input.length) throw new ExprError('unterminated string literal');
      i += 1; // closing quote
      tokens.push({ t: 'str', v: value });
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(input[i + 1] ?? ''))) {
      let num = '';
      while (i < input.length && /[0-9.]/.test(input[i]!)) {
        num += input[i];
        i += 1;
      }
      const parsed = Number(num);
      if (Number.isNaN(parsed)) throw new ExprError(`invalid number "${num}"`);
      tokens.push({ t: 'num', v: parsed });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = '';
      while (i < input.length && /[a-zA-Z0-9_.]/.test(input[i]!)) {
        ident += input[i];
        i += 1;
      }
      tokens.push({ t: 'ident', v: ident });
      continue;
    }
    // Two-char then one-char operators.
    const two = input.slice(i, i + 2);
    if (OPERATORS.has(two)) {
      tokens.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if (OPERATORS.has(ch)) {
      tokens.push({ t: 'op', v: ch });
      i += 1;
      continue;
    }
    throw new ExprError(`unexpected character "${ch}"`);
  }
  return tokens;
}

export type ExprNode =
  | { type: 'num'; value: number }
  | { type: 'str'; value: string }
  | { type: 'field'; name: string }
  | { type: 'binary'; op: string; left: ExprNode; right: ExprNode }
  | { type: 'unary'; op: string; operand: ExprNode }
  | { type: 'call'; name: string; args: ExprNode[] };

const BINDING: Record<string, number> = {
  '==': 1,
  '!=': 1,
  '>': 1,
  '<': 1,
  '>=': 1,
  '<=': 1,
  '+': 2,
  '-': 2,
  '*': 3,
  '/': 3,
  '%': 3,
};

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): ExprNode {
    const node = this.expr(0);
    if (this.pos < this.tokens.length) throw new ExprError('trailing tokens in expression');
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private expr(minBp: number): ExprNode {
    let left = this.unary();
    for (;;) {
      const token = this.peek();
      if (!token || token.t !== 'op') break;
      const bp = BINDING[token.v];
      if (bp === undefined || bp < minBp) break;
      this.pos += 1;
      const right = this.expr(bp + 1);
      left = { type: 'binary', op: token.v, left, right };
    }
    return left;
  }

  private unary(): ExprNode {
    const token = this.peek();
    if (token && token.t === 'op' && token.v === '-') {
      this.pos += 1;
      return { type: 'unary', op: '-', operand: this.unary() };
    }
    return this.primary();
  }

  private primary(): ExprNode {
    const token = this.peek();
    if (!token) throw new ExprError('unexpected end of expression');
    if (token.t === 'num') {
      this.pos += 1;
      return { type: 'num', value: token.v };
    }
    if (token.t === 'str') {
      this.pos += 1;
      return { type: 'str', value: token.v };
    }
    if (token.t === 'lparen') {
      this.pos += 1;
      const inner = this.expr(0);
      if (this.peek()?.t !== 'rparen') throw new ExprError('missing closing ")"');
      this.pos += 1;
      return inner;
    }
    if (token.t === 'ident') {
      this.pos += 1;
      if (this.peek()?.t === 'lparen') {
        this.pos += 1;
        const args: ExprNode[] = [];
        if (this.peek()?.t !== 'rparen') {
          args.push(this.expr(0));
          while (this.peek()?.t === 'comma') {
            this.pos += 1;
            args.push(this.expr(0));
          }
        }
        if (this.peek()?.t !== 'rparen') throw new ExprError('missing closing ")" in call');
        this.pos += 1;
        return { type: 'call', name: token.v.toLowerCase(), args };
      }
      return { type: 'field', name: token.v };
    }
    throw new ExprError('unexpected token in expression');
  }
}

/** Parse an expression source into a reusable AST. */
export function parseExpr(source: string): ExprNode {
  return new Parser(tokenize(source)).parse();
}

function toNumber(v: ExprValue): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

function toStr(v: ExprValue): string {
  if (v === null) return '';
  return String(v);
}

function resolveField(row: Row, name: string): ExprValue {
  const raw = row[name];
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number' || typeof raw === 'string' || typeof raw === 'boolean') return raw;
  return String(raw);
}

const FUNCTIONS: Record<string, (args: ExprValue[]) => ExprValue> = {
  len: (a) => toStr(a[0] ?? null).length,
  lower: (a) => toStr(a[0] ?? null).toLowerCase(),
  upper: (a) => toStr(a[0] ?? null).toUpperCase(),
  abs: (a) => Math.abs(toNumber(a[0] ?? null)),
  round: (a) => {
    const n = toNumber(a[0] ?? null);
    const digits = a[1] === undefined ? 0 : toNumber(a[1]);
    const f = 10 ** digits;
    return Math.round(n * f) / f;
  },
  coalesce: (a) => a.find((v) => v !== null && v !== '') ?? null,
  concat: (a) => a.map(toStr).join(''),
  if: (a) => (truthy(a[0] ?? null) ? (a[1] ?? null) : (a[2] ?? null)),
};

function truthy(v: ExprValue): boolean {
  if (v === null) return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'boolean') return v;
  return v !== '';
}

function evalNode(node: ExprNode, row: Row): ExprValue {
  switch (node.type) {
    case 'num':
      return node.value;
    case 'str':
      return node.value;
    case 'field':
      return resolveField(row, node.name);
    case 'unary':
      return -toNumber(evalNode(node.operand, row));
    case 'call': {
      const fn = FUNCTIONS[node.name];
      if (!fn) throw new ExprError(`unknown function "${node.name}"`);
      return fn(node.args.map((a) => evalNode(a, row)));
    }
    case 'binary': {
      const left = evalNode(node.left, row);
      const right = evalNode(node.right, row);
      switch (node.op) {
        case '+':
          return typeof left === 'string' || typeof right === 'string'
            ? toStr(left) + toStr(right)
            : toNumber(left) + toNumber(right);
        case '-':
          return toNumber(left) - toNumber(right);
        case '*':
          return toNumber(left) * toNumber(right);
        case '/': {
          const d = toNumber(right);
          return d === 0 ? 0 : toNumber(left) / d;
        }
        case '%': {
          const d = toNumber(right);
          return d === 0 ? 0 : toNumber(left) % d;
        }
        case '==':
          return looseEq(left, right);
        case '!=':
          return !looseEq(left, right);
        case '>':
          return compare(left, right) > 0;
        case '<':
          return compare(left, right) < 0;
        case '>=':
          return compare(left, right) >= 0;
        case '<=':
          return compare(left, right) <= 0;
        default:
          throw new ExprError(`unknown operator "${node.op}"`);
      }
    }
  }
}

function looseEq(a: ExprValue, b: ExprValue): boolean {
  if (typeof a === 'number' || typeof b === 'number') return toNumber(a) === toNumber(b);
  return toStr(a) === toStr(b);
}

function compare(a: ExprValue, b: ExprValue): number {
  if (typeof a === 'string' || typeof b === 'string') {
    const sa = toStr(a);
    const sb = toStr(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  const na = toNumber(a);
  const nb = toNumber(b);
  return na < nb ? -1 : na > nb ? 1 : 0;
}

/** Evaluate a parsed expression against a row. Never throws on missing fields. */
export function evaluateExpr(node: ExprNode, row: Row): ExprValue {
  return evalNode(node, row);
}

/** Convenience: parse + evaluate in one shot. */
export function evalExpr(source: string, row: Row): ExprValue {
  return evaluateExpr(parseExpr(source), row);
}
