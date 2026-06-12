import type { Diagnostic } from './diagnostics.js';
import { DiagnosticBag } from './diagnostics.js';
import type { Position, Span } from './span.js';
import type { Token, TokenKind } from './token.js';
import { OPERATORS, WORD_OPERATORS } from './token.js';

/**
 * The Forge lexer (F313–F318).
 *
 * Forge is line-oriented: the kind of a line is decided by its first
 * non-whitespace characters (`===` knot, `=` stitch, `*`/`+` choice, `-`
 * gather, `~` logic, `VAR`/`CONST`/`INCLUDE` directives, anything else is
 * prose). Within a line the lexer switches between *text mode* (prose with
 * inline `{...}` blocks, diverts, glue, tags, bindings) and *logic mode*
 * (identifiers, literals, operators).
 *
 * The lexer never throws and always terminates: invalid input becomes an
 * `Error` token plus a diagnostic, and every loop provably consumes input.
 */

export interface LexResult {
  readonly tokens: Token[];
  readonly diagnostics: readonly Diagnostic[];
}

type LineKind = 'text' | 'choice' | 'gather' | 'knot' | 'stitch' | 'logic' | 'var' | 'include';

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_]/;

class Lexer {
  private pos = 0;
  private line = 1;
  private col = 1;
  private readonly tokens: Token[] = [];

  constructor(
    private readonly source: string,
    private readonly bag: DiagnosticBag,
  ) {}

  tokenize(): Token[] {
    while (this.pos < this.source.length) {
      const before = this.pos;
      this.lexLine();
      if (this.pos === before) {
        // Safety net: guarantee forward progress no matter what (F319).
        this.errorToken(this.position(), 'FORGE001');
      }
    }
    this.tokens.push({ kind: 'EOF', text: '', span: this.point() });
    return this.tokens;
  }

  // ── line dispatch ────────────────────────────────────────────────────────

  private lexLine(): void {
    this.skipInlineSpace();
    const c = this.peek();
    if (c === '\n') {
      this.emitNewline();
      return;
    }
    if (this.at('//')) {
      this.lexLineComment();
      this.finishLineAsText('text');
      return;
    }
    if (this.at('/*')) {
      this.lexBlockComment();
      this.finishLineAsText('text');
      return;
    }
    if (this.at('==')) {
      this.lexKnotHeader();
      return;
    }
    if (c === '=') {
      this.lexStitchHeader();
      return;
    }
    if (c === '*' || c === '+') {
      this.lexChoiceLine(c);
      return;
    }
    if (this.at('->')) {
      this.finishLineAsText('text');
      return;
    }
    if (c === '-') {
      this.lexGatherLine();
      return;
    }
    if (c === '~') {
      this.emitChar('Tilde');
      this.lexLogicRestOfLine(true);
      return;
    }
    if (this.atKeywordLine('VAR')) {
      this.emitWord('VarKeyword', 3);
      this.lexLogicRestOfLine(false);
      return;
    }
    if (this.atKeywordLine('CONST')) {
      this.emitWord('ConstKeyword', 5);
      this.lexLogicRestOfLine(false);
      return;
    }
    if (this.atKeywordLine('INCLUDE')) {
      this.emitWord('IncludeKeyword', 7);
      this.lexIncludePath();
      return;
    }
    this.finishLineAsText('text');
  }

  private lexKnotHeader(): void {
    const start = this.position();
    while (this.peek() === '=') this.advance();
    this.emit('KnotMarker', start);
    this.skipInlineSpace();
    if (IDENT_START.test(this.peek())) this.lexIdentifier(false);
    this.skipInlineSpace();
    if (this.peek() === '=') {
      const tail = this.position();
      while (this.peek() === '=') this.advance();
      this.emit('KnotMarker', tail);
    }
    this.finishLineAsText('knot');
  }

  private lexStitchHeader(): void {
    this.emitChar('StitchMarker');
    this.skipInlineSpace();
    if (IDENT_START.test(this.peek())) this.lexIdentifier(false);
    this.finishLineAsText('stitch');
  }

  private lexChoiceLine(marker: '*' | '+'): void {
    // Markers may repeat for nesting, with or without spaces: `* * *` or `***`.
    while (this.peek() === marker) {
      this.emitChar(marker === '*' ? 'ChoiceStar' : 'ChoicePlus');
      this.skipInlineSpace();
    }
    this.lexOptionalLabel();
    this.finishLineAsText('choice');
  }

  private lexGatherLine(): void {
    while (this.peek() === '-' && this.peekAt(1) !== '>') {
      this.emitChar('GatherDash');
      this.skipInlineSpace();
    }
    this.lexOptionalLabel();
    this.finishLineAsText('text');
  }

  /** `(label)` immediately after choice/gather markers. */
  private lexOptionalLabel(): void {
    if (this.peek() !== '(') return;
    const save = this.snapshot();
    const lparen = this.position();
    this.advance();
    this.emit('LParen', lparen);
    this.skipInlineSpace();
    if (!IDENT_START.test(this.peek())) {
      this.restore(save);
      this.tokens.pop();
      return;
    }
    this.lexIdentifier(false);
    this.skipInlineSpace();
    if (this.peek() === ')') {
      this.emitChar('RParen');
      this.skipInlineSpace();
    } else {
      this.restore(save);
      this.tokens.pop();
      this.tokens.pop();
    }
  }

  private lexIncludePath(): void {
    this.skipInlineSpace();
    const start = this.position();
    let text = '';
    while (this.pos < this.source.length && this.peek() !== '\n' && !this.at('//')) {
      text += this.peek();
      this.advance();
    }
    text = text.trimEnd();
    if (text.length > 0) {
      this.tokens.push({
        kind: 'Text',
        text,
        span: { start, end: this.position() },
        value: text,
      });
    }
    this.finishLineAsText('include');
  }

  // ── text mode ────────────────────────────────────────────────────────────

  /** Lex the remainder of the current line in text mode, then the newline. */
  private finishLineAsText(lineKind: LineKind): void {
    this.lexTextUntil(new Set(['\n']), lineKind, 'top');
    if (this.peek() === '\n') this.emitNewline();
  }

  /**
   * Text-mode scanner (F313). Stops (without consuming) at any char in
   * `stops` when at brace context boundaries.
   */
  private lexTextUntil(stops: Set<string>, lineKind: LineKind, context: 'top' | 'brace'): void {
    let textStart: Position | null = null;
    let text = '';
    const flush = (): void => {
      if (textStart !== null && text.length > 0) {
        this.tokens.push({
          kind: 'Text',
          text: this.source.slice(textStart.offset, this.pos),
          span: { start: textStart, end: this.position() },
          value: text,
        });
      }
      textStart = null;
      text = '';
    };

    while (this.pos < this.source.length) {
      const c = this.peek();
      if (c === '\n' || (context === 'brace' && stops.has(c))) break;
      if (c === '\r') {
        flush();
        this.advance();
        continue;
      }
      if (c === '\\' && this.pos + 1 < this.source.length && this.peekAt(1) !== '\n') {
        // Escapes: `\{`, `\[`, `\#`, `\@`, `\->` etc. keep specials literal.
        if (textStart === null) textStart = this.position();
        this.advance();
        text += this.peek();
        this.advance();
        continue;
      }
      if (this.at('//')) {
        flush();
        this.lexLineComment();
        continue;
      }
      if (this.at('/*')) {
        flush();
        this.lexBlockComment();
        continue;
      }
      if (this.at('->')) {
        flush();
        this.lexDivert();
        continue;
      }
      if (this.at('<>')) {
        flush();
        this.emitWord('Glue', 2);
        continue;
      }
      if (c === '#') {
        flush();
        this.lexTag();
        continue;
      }
      if (c === '{') {
        flush();
        this.lexInlineBlock(lineKind);
        continue;
      }
      if (this.at('[[')) {
        flush();
        this.lexNoteRef();
        continue;
      }
      if ((c === '[' || c === ']') && lineKind === 'choice') {
        flush();
        this.emitChar(c === '[' ? 'LBracket' : 'RBracket');
        continue;
      }
      if (c === '@' && IDENT_START.test(this.peekAt(1))) {
        flush();
        this.lexBinding();
        continue;
      }
      if (textStart === null) textStart = this.position();
      text += c;
      this.advance();
    }
    flush();
  }

  /** `-> target`, `-> target ->` (tunnel), `->->` (tunnel return). */
  private lexDivert(): void {
    const start = this.position();
    this.advance();
    this.advance();
    if (this.at('->')) {
      this.advance();
      this.advance();
      this.emit('TunnelReturn', start);
      return;
    }
    this.emit('Divert', start);
    this.skipInlineSpace();
    if (IDENT_START.test(this.peek())) {
      this.lexIdentifier(false);
      while (this.peek() === '.') {
        this.emitChar('Dot');
        if (IDENT_START.test(this.peek())) this.lexIdentifier(false);
        else break;
      }
      // `-> target ->` tunnel marker: a bare arrow with no target of its own.
      const save = this.snapshot();
      this.skipInlineSpace();
      if (this.at('->') && !this.at('->->')) {
        let j = this.pos + 2;
        while (this.source[j] === ' ' || this.source[j] === '\t') j++;
        const after = this.source[j];
        if (after === undefined || !IDENT_START.test(after)) {
          this.emitWord('Divert', 2);
          return;
        }
      }
      this.restore(save);
    }
  }

  /** `# tag text` — runs to the next `#`, comment, or end of line. */
  private lexTag(): void {
    const start = this.position();
    this.advance(); // #
    let raw = '';
    while (
      this.pos < this.source.length &&
      this.peek() !== '\n' &&
      this.peek() !== '#' &&
      !this.at('//') &&
      !this.at('/*')
    ) {
      raw += this.peek();
      this.advance();
    }
    this.tokens.push({
      kind: 'Tag',
      text: this.source.slice(start.offset, this.pos),
      span: { start, end: this.position() },
      value: raw.trim(),
    });
  }

  /** `[[Note Title]]` (F317). */
  private lexNoteRef(): void {
    const open = this.position();
    this.advance();
    this.advance();
    this.emit('NoteRefOpen', open);
    const start = this.position();
    let raw = '';
    while (this.pos < this.source.length && this.peek() !== '\n' && !this.at(']]')) {
      raw += this.peek();
      this.advance();
    }
    this.tokens.push({
      kind: 'Text',
      text: raw,
      span: { start, end: this.position() },
      value: raw,
    });
    if (this.at(']]')) {
      const close = this.position();
      this.advance();
      this.advance();
      this.emit('NoteRefClose', close);
    } else {
      this.errorToken(start, 'FORGE108', 'note reference is missing closing "]]"');
    }
  }

  /** `@name`, `@name.field`, `@entity(Display Name)`, `@entity(Name).field` (F317). */
  private lexBinding(): void {
    this.emitChar('At');
    this.lexIdentifier(false);
    if (this.peek() === '(') {
      this.emitChar('LParen');
      const start = this.position();
      let raw = '';
      while (this.pos < this.source.length && this.peek() !== '\n' && this.peek() !== ')') {
        raw += this.peek();
        this.advance();
      }
      this.tokens.push({
        kind: 'Text',
        text: raw,
        span: { start, end: this.position() },
        value: raw.trim(),
      });
      if (this.peek() === ')') this.emitChar('RParen');
      else this.errorToken(start, 'FORGE108', 'entity binding is missing closing ")"');
    }
    if (this.peek() === '.' && IDENT_CHAR.test(this.peekAt(1))) {
      this.emitChar('Dot');
      this.lexIdentifier(false);
    }
  }

  // ── inline `{...}` blocks ────────────────────────────────────────────────

  /**
   * Classify and lex an inline block (F316/F327 support):
   *   `{expr}` interpolation · `{cond: a|b}` conditional ·
   *   `{a|b|c}` sequence · `{&a|b}` cycle · `{~a|b}` shuffle.
   */
  private lexInlineBlock(lineKind: LineKind): void {
    const flavor = this.classifyBrace();
    if (flavor === 'unterminated') {
      const start = this.position();
      this.advance();
      this.errorToken(start, 'FORGE104', 'inline "{" block is not closed before the end of the line');
      return;
    }
    this.emitChar('LBrace');
    if (flavor === 'cycle') this.emitChar('Ampersand');
    if (flavor === 'shuffle') this.emitChar('ShuffleMarker');
    if (flavor === 'expr') {
      this.lexLogicUntil(new Set(['}']));
    } else if (flavor === 'cond') {
      this.lexLogicUntil(new Set([':', '}']));
      if (this.peek() === ':') this.emitChar('Colon');
      this.lexBranches(lineKind);
    } else {
      this.lexBranches(lineKind);
    }
    if (this.peek() === '}') this.emitChar('RBrace');
  }

  private lexBranches(lineKind: LineKind): void {
    for (;;) {
      this.lexTextUntil(new Set(['|', '}']), lineKind, 'brace');
      if (this.peek() === '|') {
        this.emitChar('Pipe');
        continue;
      }
      break;
    }
  }

  /**
   * Prescan from a `{` to decide the block flavor. Only `|` and `:` at brace
   * depth 1 / paren depth 0 are separators; ternaries inside inline blocks
   * must be parenthesised (documented in the spec).
   */
  private classifyBrace(): 'expr' | 'cond' | 'seq' | 'cycle' | 'shuffle' | 'unterminated' {
    let i = this.pos + 1;
    if (this.source[i] === '&') return this.prescanClosed(i + 1) ? 'cycle' : 'unterminated';
    if (this.source[i] === '~') return this.prescanClosed(i + 1) ? 'shuffle' : 'unterminated';
    let depth = 1;
    let paren = 0;
    let sawPipe = false;
    let sawColon = false;
    let sawQuestion = false;
    for (; i < this.source.length; i++) {
      const c = this.source[i];
      if (c === '\n') return 'unterminated';
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          if (sawColon) return 'cond';
          return sawPipe ? 'seq' : 'expr';
        }
      } else if (depth === 1) {
        if (c === '(') paren++;
        else if (c === ')') paren = Math.max(0, paren - 1);
        else if (paren === 0) {
          if (c === '?') sawQuestion = true;
          else if (c === ':' && !sawPipe && !sawQuestion) sawColon = true;
          else if (c === '|') {
            // `||` is the logic OR operator, not a branch separator.
            if (this.source[i + 1] === '|') i++;
            else sawPipe = true;
          }
        }
      }
    }
    return 'unterminated';
  }

  private prescanClosed(from: number): boolean {
    let depth = 1;
    for (let i = from; i < this.source.length; i++) {
      const c = this.source[i];
      if (c === '\n') return false;
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return true;
    }
    return false;
  }

  // ── logic mode ───────────────────────────────────────────────────────────

  private lexLogicRestOfLine(allowTemp: boolean): void {
    this.skipInlineSpace();
    if (allowTemp && this.atKeyword('temp')) this.emitWord('TempKeyword', 4);
    this.lexLogicUntil(new Set(['\n']));
    if (this.peek() === '\n') this.emitNewline();
  }

  /** Logic-mode scanner (F315). Stops (without consuming) at chars in `stops`. */
  private lexLogicUntil(stops: Set<string>): void {
    while (this.pos < this.source.length) {
      const c = this.peek();
      if (c === '\n' || stops.has(c)) return;
      if (c === ' ' || c === '\t' || c === '\r') {
        this.advance();
        continue;
      }
      if (this.at('//')) {
        this.lexLineComment();
        continue;
      }
      if (this.at('/*')) {
        this.lexBlockComment();
        continue;
      }
      if (this.at('->')) {
        this.lexDivert();
        continue;
      }
      if (c === '@' && IDENT_START.test(this.peekAt(1))) {
        this.lexBinding();
        continue;
      }
      if (IDENT_START.test(c)) {
        this.lexIdentifier(true);
        continue;
      }
      if (c >= '0' && c <= '9') {
        this.lexNumber();
        continue;
      }
      if (c === '"') {
        this.lexString();
        continue;
      }
      const simple: Record<string, TokenKind> = {
        '(': 'LParen',
        ')': 'RParen',
        ',': 'Comma',
        '.': 'Dot',
        '[': 'LBracket',
        ']': 'RBracket',
        '{': 'LBrace',
        '}': 'RBrace',
        ':': 'Colon',
      };
      const kind = simple[c];
      if (kind !== undefined) {
        this.emitChar(kind);
        continue;
      }
      const op = OPERATORS.find((o) => this.at(o));
      if (op !== undefined) {
        this.emitWord('Operator', op.length);
        continue;
      }
      this.errorToken(this.position(), 'FORGE001', `invalid character ${JSON.stringify(c)} in expression`);
    }
  }

  private lexIdentifier(logicMode: boolean): void {
    const start = this.position();
    while (this.pos < this.source.length && IDENT_CHAR.test(this.peek())) this.advance();
    const text = this.source.slice(start.offset, this.pos);
    if (logicMode) {
      if (text === 'true' || text === 'false') {
        this.tokens.push({
          kind: 'BoolLiteral',
          text,
          span: { start, end: this.position() },
          value: text === 'true',
        });
        return;
      }
      if (text in WORD_OPERATORS) {
        this.tokens.push({ kind: 'Operator', text, span: { start, end: this.position() } });
        return;
      }
    }
    this.tokens.push({ kind: 'Identifier', text, span: { start, end: this.position() }, value: text });
  }

  private lexNumber(): void {
    const start = this.position();
    while (this.pos < this.source.length && this.peek() >= '0' && this.peek() <= '9') this.advance();
    if (this.peek() === '.' && this.peekAt(1) >= '0' && this.peekAt(1) <= '9') {
      this.advance();
      while (this.pos < this.source.length && this.peek() >= '0' && this.peek() <= '9') this.advance();
    }
    if (IDENT_START.test(this.peek())) {
      while (this.pos < this.source.length && IDENT_CHAR.test(this.peek())) this.advance();
      const text = this.source.slice(start.offset, this.pos);
      this.tokens.push({ kind: 'Error', text, span: { start, end: this.position() } });
      this.bag.add('FORGE004', { start, end: this.position() }, `malformed number literal "${text}"`);
      return;
    }
    const text = this.source.slice(start.offset, this.pos);
    this.tokens.push({
      kind: 'Number',
      text,
      span: { start, end: this.position() },
      value: Number(text),
    });
  }

  private lexString(): void {
    const start = this.position();
    this.advance(); // opening quote
    let value = '';
    while (this.pos < this.source.length) {
      const c = this.peek();
      if (c === '\n') break;
      if (c === '"') {
        this.advance();
        this.tokens.push({
          kind: 'String',
          text: this.source.slice(start.offset, this.pos),
          span: { start, end: this.position() },
          value,
        });
        return;
      }
      if (c === '\\') {
        this.advance();
        const esc = this.peek();
        const decoded: Record<string, string> = { n: '\n', t: '\t', '"': '"', '\\': '\\' };
        value += decoded[esc] ?? esc;
        if (this.pos < this.source.length && esc !== '\n') this.advance();
        continue;
      }
      value += c;
      this.advance();
    }
    const spanEnd = this.position();
    this.tokens.push({
      kind: 'Error',
      text: this.source.slice(start.offset, this.pos),
      span: { start, end: spanEnd },
    });
    this.bag.add('FORGE002', { start, end: spanEnd }, 'string literal is missing a closing quote');
  }

  // ── comments ─────────────────────────────────────────────────────────────

  private lexLineComment(): void {
    const start = this.position();
    while (this.pos < this.source.length && this.peek() !== '\n') this.advance();
    this.tokens.push({
      kind: 'CommentLine',
      text: this.source.slice(start.offset, this.pos),
      span: { start, end: this.position() },
    });
  }

  private lexBlockComment(): void {
    const start = this.position();
    this.advance();
    this.advance();
    while (this.pos < this.source.length && !this.at('*/')) this.advance();
    if (this.at('*/')) {
      this.advance();
      this.advance();
      this.tokens.push({
        kind: 'CommentBlock',
        text: this.source.slice(start.offset, this.pos),
        span: { start, end: this.position() },
      });
    } else {
      const end = this.position();
      this.tokens.push({
        kind: 'Error',
        text: this.source.slice(start.offset, this.pos),
        span: { start, end },
      });
      this.bag.add('FORGE003', { start, end }, 'block comment is missing closing "*/"');
    }
  }

  // ── low-level cursor ─────────────────────────────────────────────────────

  private peek(): string {
    return this.source[this.pos] ?? '\0';
  }

  private peekAt(n: number): string {
    return this.source[this.pos + n] ?? '\0';
  }

  private at(s: string): boolean {
    return this.source.startsWith(s, this.pos);
  }

  private atKeyword(word: string): boolean {
    return this.at(word) && !IDENT_CHAR.test(this.peekAt(word.length));
  }

  private atKeywordLine(word: string): boolean {
    return this.atKeyword(word);
  }


  private advance(): void {
    if (this.source[this.pos] === '\n') {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    this.pos++;
  }

  private skipInlineSpace(): void {
    while (this.peek() === ' ' || this.peek() === '\t' || this.peek() === '\r') this.advance();
  }

  private position(): Position {
    return { line: this.line, col: this.col, offset: this.pos };
  }

  private point(): Span {
    const p = this.position();
    return { start: p, end: p };
  }

  private snapshot(): { pos: number; line: number; col: number } {
    return { pos: this.pos, line: this.line, col: this.col };
  }

  private restore(s: { pos: number; line: number; col: number }): void {
    this.pos = s.pos;
    this.line = s.line;
    this.col = s.col;
  }

  private emit(kind: TokenKind, start: Position): void {
    this.tokens.push({
      kind,
      text: this.source.slice(start.offset, this.pos),
      span: { start, end: this.position() },
    });
  }

  private emitChar(kind: TokenKind): void {
    const start = this.position();
    this.advance();
    this.emit(kind, start);
  }

  private emitWord(kind: TokenKind, len: number): void {
    const start = this.position();
    for (let i = 0; i < len; i++) this.advance();
    this.emit(kind, start);
  }

  private emitNewline(): void {
    const start = this.position();
    this.advance();
    this.emit('Newline', start);
  }

  private errorToken(start: Position, code: 'FORGE001' | 'FORGE104' | 'FORGE108', message?: string): void {
    if (this.pos === start.offset && this.pos < this.source.length) this.advance();
    const sp: Span = { start, end: this.position() };
    this.tokens.push({ kind: 'Error', text: this.source.slice(start.offset, this.pos), span: sp });
    this.bag.add(code, sp, message ?? `invalid character ${JSON.stringify(this.source[start.offset] ?? '')}`);
  }
}

/**
 * Tokenize Forge source. Never throws; lexical problems surface as `Error`
 * tokens plus diagnostics (F318).
 */
export function tokenize(source: string, bag?: DiagnosticBag): LexResult {
  const ownBag = bag ?? new DiagnosticBag();
  if (bag === undefined) ownBag.loadSuppressions(source);
  const tokens = new Lexer(source, ownBag).tokenize();
  return { tokens, diagnostics: ownBag.all };
}
