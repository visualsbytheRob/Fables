/**
 * FQL tokenizer (F271, F272). Hand-written single pass; every token carries
 * its start offset so syntax errors can point at the exact position.
 */

export type Token =
  | { type: 'word'; value: string; position: number }
  | { type: 'phrase'; value: string; position: number }
  | { type: 'field'; name: string; value: string; position: number }
  | { type: 'lparen'; position: number }
  | { type: 'rparen'; position: number };

/** Syntax error with a character offset; carries the failing token index when parsing. */
export class FqlError extends Error {
  readonly position: number;
  readonly tokenIndex: number | undefined;

  constructor(message: string, position: number, tokenIndex?: number) {
    super(message);
    this.name = 'FqlError';
    this.position = position;
    this.tokenIndex = tokenIndex;
  }
}

const isWhitespace = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r';
const isDelimiter = (c: string): boolean => isWhitespace(c) || c === '(' || c === ')' || c === '"';

/** Reads a `"quoted"` value starting at the opening quote; returns [value, indexAfter]. */
function readQuoted(input: string, start: number): [string, number] {
  const close = input.indexOf('"', start + 1);
  if (close === -1) throw new FqlError('unterminated quoted phrase', start);
  return [input.slice(start + 1, close), close + 1];
}

/** Reads a `[[bracketed]]` value starting at the first `[`; returns [inner, indexAfter]. */
function readWikilink(input: string, start: number): [string, number] {
  const close = input.indexOf(']]', start + 2);
  if (close === -1) throw new FqlError('unterminated [[wikilink]]', start);
  return [input.slice(start + 2, close).trim(), close + 2];
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i]!;
    if (isWhitespace(c)) {
      i += 1;
      continue;
    }
    if (c === '(') {
      tokens.push({ type: 'lparen', position: i });
      i += 1;
      continue;
    }
    if (c === ')') {
      tokens.push({ type: 'rparen', position: i });
      i += 1;
      continue;
    }
    if (c === '"') {
      const [value, next] = readQuoted(input, i);
      tokens.push({ type: 'phrase', value, position: i });
      i = next;
      continue;
    }

    // Word (or field:value). The first ':' splits the field name; a value may
    // be quoted (title:"two words") or bracketed (linksto:[[Note Title]]).
    const start = i;
    let colon = -1;
    while (i < input.length && !isDelimiter(input[i]!)) {
      if (input[i] === ':' && colon === -1) {
        colon = i;
        const after = input[i + 1];
        if (after === '"') {
          const name = input.slice(start, i);
          const [value, next] = readQuoted(input, i + 1);
          tokens.push({ type: 'field', name, value, position: start });
          i = next;
          colon = -2; // emitted
          break;
        }
        if (after === '[' && input[i + 2] === '[') {
          const name = input.slice(start, i);
          const [value, next] = readWikilink(input, i + 1);
          tokens.push({ type: 'field', name, value, position: start });
          i = next;
          colon = -2; // emitted
          break;
        }
      }
      i += 1;
    }
    if (colon === -2) continue;
    const text = input.slice(start, i);
    if (colon !== -1) {
      tokens.push({
        type: 'field',
        name: input.slice(start, colon),
        value: input.slice(colon + 1, i),
        position: start,
      });
    } else {
      tokens.push({ type: 'word', value: text, position: start });
    }
  }
  return tokens;
}
