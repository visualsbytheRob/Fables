import type { Span } from './span.js';

/**
 * Token kinds for the Forge lexer (F312).
 *
 * The lexer is mode-aware: structural markers and prose come out of *text mode*,
 * while everything inside logic lines (`~`, VAR, CONST), conditions, and inline
 * `{...}` expressions comes out of *logic mode*.
 */
export type TokenKind =
  // Structure
  | 'KnotMarker' // ===
  | 'StitchMarker' // = (at line start)
  | 'ChoiceStar' // *
  | 'ChoicePlus' // +
  | 'GatherDash' // - (at line start, not -> )
  | 'Tilde' // ~ (logic line marker)
  | 'VarKeyword' // VAR
  | 'ConstKeyword' // CONST
  | 'IncludeKeyword' // INCLUDE
  | 'TempKeyword' // temp (inside ~ line)
  // Flow
  | 'Divert' // ->
  | 'TunnelReturn' // ->->
  | 'Glue' // <>
  | 'Tag' // # tag text
  // Text
  | 'Text' // raw prose
  | 'Newline'
  // Inline / grouping
  | 'LBrace' // {
  | 'RBrace' // }
  | 'Pipe' // | (inside alternatives)
  | 'Colon' // :
  | 'Ampersand' // & (cycle marker {&...})
  | 'ShuffleMarker' // ~ immediately after { ({~...})
  | 'LBracket' // [
  | 'RBracket' // ]
  | 'NoteRefOpen' // [[
  | 'NoteRefClose' // ]]
  | 'At' // @
  | 'LParen' // (
  | 'RParen' // )
  | 'Comma' // ,
  | 'Dot' // .
  // Logic
  | 'Identifier'
  | 'Number'
  | 'String'
  | 'BoolLiteral' // true | false
  | 'Operator' // + - * / % == != < <= > >= = ! && || ? and or not has hasnt
  // Trivia & control
  | 'CommentLine' // // ...
  | 'CommentBlock' // /* ... */
  | 'Error' // invalid input, lexer recovered (F318)
  | 'EOF';

export interface Token {
  readonly kind: TokenKind;
  /** Raw source text of the token. */
  readonly text: string;
  readonly span: Span;
  /** Decoded value for String (escapes applied) and Number tokens. */
  readonly value?: string | number | boolean;
}

/** Operators recognised in logic mode, longest first so the lexer can greedily match. */
export const OPERATORS = [
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '<',
  '>',
  '+',
  '-',
  '*',
  '/',
  '%',
  '=',
  '!',
  '?',
] as const;

/** Word operators usable in place of symbolic ones. */
export const WORD_OPERATORS: Record<string, string> = {
  and: '&&',
  or: '||',
  not: '!',
  has: 'has',
  hasnt: 'hasnt',
};

export function isTrivia(kind: TokenKind): boolean {
  return kind === 'CommentLine' || kind === 'CommentBlock';
}
