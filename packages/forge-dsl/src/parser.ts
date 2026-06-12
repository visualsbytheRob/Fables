import type {
  BlockItem,
  BlockNode,
  DivertLineNode,
  LogicLineNode,
  BranchNode,
  ChoiceNode,
  CommentTrivia,
  DivertNode,
  ExprNode,
  GatherNode,
  IdentifierNode,
  InlineNode,
  KnotNode,
  StoryNode,
  StitchNode,
  StmtNode,
  TagNode,
  TextLineNode,
  TunnelReturnNode,
  VarDeclNode,
  BinaryOp,
  UnaryOp,
} from './ast.js';
import type { Diagnostic } from './diagnostics.js';
import { DiagnosticBag } from './diagnostics.js';
import { tokenize } from './lexer.js';
import type { Span } from './span.js';
import { mergeSpans, pointSpan } from './span.js';
import type { Token, TokenKind } from './token.js';
import { isTrivia } from './token.js';

/**
 * Recursive-descent parser (F321–F329). Produces a typed AST with spans and
 * recovers from errors at line boundaries so a single mistake never cascades.
 */

export interface ParseResult {
  readonly story: StoryNode;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ParseOptions {
  readonly fileName?: string;
  readonly bag?: DiagnosticBag;
}

/** Binary operator precedence (F305). Higher binds tighter. */
export const BINARY_PRECEDENCE: Record<BinaryOp, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  has: 4,
  hasnt: 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

class Parser {
  private i = 0;
  private pendingComments: CommentTrivia[] = [];
  private readonly declarations: VarDeclNode[] = [];

  constructor(
    private readonly tokens: Token[],
    private readonly bag: DiagnosticBag,
    private readonly fileName?: string,
  ) {}

  // ── token cursor ─────────────────────────────────────────────────────────

  private peek(offset = 0): Token {
    let j = this.i;
    let remaining = offset;
    while (j < this.tokens.length) {
      const t = this.tokens[j];
      if (t === undefined) break;
      if (!isTrivia(t.kind)) {
        if (remaining === 0) return t;
        remaining--;
      }
      j++;
    }
    return this.tokens[this.tokens.length - 1] as Token;
  }

  private next(): Token {
    for (;;) {
      const t = this.tokens[this.i] as Token;
      if (t.kind === 'EOF') return t;
      this.i++;
      if (isTrivia(t.kind)) {
        this.recordComment(t);
        continue;
      }
      return t;
    }
  }

  private recordComment(t: Token): void {
    this.pendingComments.push({
      text: t.text,
      block: t.kind === 'CommentBlock',
      span: t.span,
    });
  }

  private atKind(kind: TokenKind, offset = 0): boolean {
    return this.peek(offset).kind === kind;
  }

  private atOperator(op: string): boolean {
    const t = this.peek();
    return t.kind === 'Operator' && t.text === op;
  }

  private eat(kind: TokenKind): Token | undefined {
    if (this.atKind(kind)) return this.next();
    return undefined;
  }

  private expect(kind: TokenKind, what: string): Token | undefined {
    const t = this.peek();
    if (t.kind === kind) return this.next();
    this.bag.add('FORGE101', t.span, `expected ${what} but found ${describeToken(t)}`);
    return undefined;
  }

  /** Sync point (F329): skip to (and over) the end of the current line. */
  private syncToLineEnd(): void {
    for (;;) {
      const t = this.peek();
      if (t.kind === 'EOF') return;
      if (t.kind === 'Newline') {
        this.next();
        return;
      }
      this.next();
    }
  }

  /** Consume the line terminator; anything unexpected before it is an error. */
  private endLine(node: { trailingComment?: CommentTrivia } | null): void {
    const before = this.pendingComments.length;
    const t = this.peek();
    if (t.kind !== 'Newline' && t.kind !== 'EOF') {
      this.bag.add('FORGE101', t.span, `unexpected ${describeToken(t)} before end of line`);
      this.syncToLineEnd();
    } else if (t.kind === 'Newline') {
      this.next();
    }
    if (node !== null && this.pendingComments.length > before) {
      const trailing = this.pendingComments.pop();
      if (trailing) node.trailingComment = trailing;
    }
  }

  private takeLeadingComments(): CommentTrivia[] {
    const c = this.pendingComments;
    this.pendingComments = [];
    return c;
  }

  private applyLeading(node: { leadingComments?: CommentTrivia[] }): void {
    const lead = this.takeLeadingComments();
    if (lead.length > 0) node.leadingComments = lead;
  }

  // ── top level ────────────────────────────────────────────────────────────

  parseStory(): StoryNode {
    const startSpan = this.peek().span;
    const headerTags: TagNode[] = [];
    const includes: StoryNode['includes'] = [];
    const knots: KnotNode[] = [];
    const preamble: BlockNode = { kind: 'Block', span: startSpan, items: [] };

    // Header: tag-only lines before any other content (F322, F307).
    this.skipBlankLines();
    while (this.atKind('Tag')) {
      headerTags.push(this.parseTag());
      while (this.atKind('Tag')) headerTags.push(this.parseTag());
      this.endLine(null);
      this.skipBlankLines();
    }

    for (;;) {
      this.skipBlankLines();
      const t = this.peek();
      if (t.kind === 'EOF') break;
      if (t.kind === 'IncludeKeyword') {
        includes.push(this.parseInclude());
        continue;
      }
      if (t.kind === 'KnotMarker') {
        knots.push(this.parseKnot());
        continue;
      }
      if (t.kind === 'StitchMarker') {
        this.bag.add('FORGE109', t.span, 'a stitch ("= name") must appear inside a knot');
        this.syncToLineEnd();
        this.parseBlockInto(preamble.items);
        continue;
      }
      this.parseBlockInto(preamble.items);
    }

    const endSpan = this.peek().span;
    const story: StoryNode = {
      kind: 'Story',
      span: mergeSpans(startSpan, endSpan),
      ...(this.fileName !== undefined ? { fileName: this.fileName } : {}),
      headerTags,
      includes,
      declarations: this.declarations,
      preamble,
      knots,
    };
    if (preamble.items.length > 0) {
      const first = preamble.items[0] as BlockItem;
      const last = preamble.items[preamble.items.length - 1] as BlockItem;
      setSpan(preamble, mergeSpans(first.span, last.span));
    }
    const remaining = this.takeLeadingComments();
    if (remaining.length > 0) story.leadingComments = remaining;
    return story;
  }

  private skipBlankLines(): void {
    while (this.atKind('Newline')) this.next();
  }

  /** Skip whitespace-only text tokens (e.g. between a knot header and its tags). */
  private skipBlankText(): void {
    while (this.atKind('Text') && String(this.peek().value ?? this.peek().text).trim() === '') {
      this.next();
    }
  }

  private parseTag(): TagNode {
    const t = this.next();
    return { kind: 'Tag', span: t.span, text: String(t.value ?? t.text.slice(1).trim()) };
  }

  private parseInclude(): StoryNode['includes'][number] {
    const kw = this.next();
    const pathTok = this.eat('Text');
    const node: StoryNode['includes'][number] = {
      kind: 'Include',
      span: pathTok ? mergeSpans(kw.span, pathTok.span) : kw.span,
      path: pathTok ? String(pathTok.value ?? pathTok.text).trim() : '',
    };
    this.applyLeading(node);
    if (!pathTok) {
      this.bag.add('FORGE110', kw.span, 'INCLUDE must be followed by a file path');
    }
    this.endLine(node);
    return node;
  }

  private parseVarDecl(): void {
    const kw = this.next();
    const declKind = kw.kind === 'VarKeyword' ? 'VAR' : 'CONST';
    const nameTok = this.expect('Identifier', `a variable name after ${declKind}`);
    if (!nameTok) {
      this.syncToLineEnd();
      return;
    }
    if (!this.atOperator('=')) {
      this.bag.add(
        'FORGE103',
        this.peek().span,
        `${declKind} ${nameTok.text} must be initialised with "= <expression>"`,
      );
      this.syncToLineEnd();
      return;
    }
    this.next(); // =
    const init = this.parseExpression();
    const node: VarDeclNode = {
      kind: 'VarDecl',
      span: mergeSpans(kw.span, init.span),
      declKind,
      name: identifier(nameTok),
      init,
    };
    this.applyLeading(node);
    this.endLine(node);
    this.declarations.push(node);
  }

  // ── knots & stitches ─────────────────────────────────────────────────────

  private parseKnot(): KnotNode {
    const marker = this.next();
    const nameTok = this.expect('Identifier', 'a knot name after "==="');
    this.eat('KnotMarker');
    const tags: TagNode[] = [];
    this.skipBlankText();
    while (this.atKind('Tag')) {
      tags.push(this.parseTag());
      this.skipBlankText();
    }
    const name: IdentifierNode = nameTok
      ? identifier(nameTok)
      : { kind: 'Identifier', span: marker.span, name: '<error>' };
    if (!nameTok) {
      this.bag.add('FORGE106', marker.span, 'knot header must be "=== knot_name ==="');
      this.syncToLineEnd();
    }
    const node: KnotNode = {
      kind: 'Knot',
      span: marker.span,
      name,
      body: { kind: 'Block', span: pointSpan(marker.span.end), items: [] },
      stitches: [],
      tags,
    };
    this.applyLeading(node);
    if (nameTok) this.endLine(node);

    this.parseBlockInto(node.body.items);
    while (this.atKind('StitchMarker')) {
      node.stitches.push(this.parseStitch());
    }
    finishBlockSpan(node.body, marker.span);
    const last =
      node.stitches.length > 0
        ? (node.stitches[node.stitches.length - 1] as StitchNode).span
        : node.body.span;
    setSpan(node, mergeSpans(marker.span, last));
    return node;
  }

  private parseStitch(): StitchNode {
    const marker = this.next();
    const nameTok = this.expect('Identifier', 'a stitch name after "="');
    const name: IdentifierNode = nameTok
      ? identifier(nameTok)
      : { kind: 'Identifier', span: marker.span, name: '<error>' };
    if (!nameTok) {
      this.bag.add('FORGE106', marker.span, 'stitch header must be "= stitch_name"');
      this.syncToLineEnd();
    }
    const node: StitchNode = {
      kind: 'Stitch',
      span: marker.span,
      name,
      body: { kind: 'Block', span: pointSpan(marker.span.end), items: [] },
    };
    this.applyLeading(node);
    if (nameTok) this.endLine(node);
    this.parseBlockInto(node.body.items);
    finishBlockSpan(node.body, marker.span);
    setSpan(node, mergeSpans(marker.span, node.body.span));
    return node;
  }

  // ── weave blocks ─────────────────────────────────────────────────────────

  /**
   * Parse weave lines into `items` until a knot/stitch header or EOF.
   * Choices own everything deeper than themselves; gathers close choices at
   * their own depth (F323).
   */
  private parseBlockInto(items: BlockItem[]): BlockNode {
    const stack: { depth: number; choice: ChoiceNode }[] = [];
    const currentItems = (): BlockItem[] => {
      const top = stack[stack.length - 1];
      return top ? top.choice.body.items : items;
    };

    for (;;) {
      this.skipBlankLines();
      const t = this.peek();
      if (
        t.kind === 'EOF' ||
        t.kind === 'KnotMarker' ||
        t.kind === 'StitchMarker' ||
        t.kind === 'IncludeKeyword'
      ) {
        break;
      }
      if (t.kind === 'VarKeyword' || t.kind === 'ConstKeyword') {
        this.parseVarDecl();
        continue;
      }
      if (t.kind === 'ChoiceStar' || t.kind === 'ChoicePlus') {
        const choice = this.parseChoiceLine();
        while (stack.length > 0 && (stack[stack.length - 1] as { depth: number }).depth >= choice.depth) {
          this.popChoice(stack);
        }
        if (choice.depth > stack.length + 1) {
          this.bag.add(
            'FORGE107',
            choice.span,
            `choice at depth ${choice.depth} skips a nesting level (deepest open choice is ${stack.length})`,
          );
        }
        currentItems().push(choice);
        stack.push({ depth: choice.depth, choice });
        continue;
      }
      if (t.kind === 'GatherDash') {
        const gather = this.parseGatherLine();
        while (stack.length > 0 && (stack[stack.length - 1] as { depth: number }).depth >= gather.depth) {
          this.popChoice(stack);
        }
        currentItems().push(gather);
        continue;
      }
      if (t.kind === 'Tilde') {
        currentItems().push(this.parseLogicLine());
        continue;
      }
      if (t.kind === 'Divert' || t.kind === 'TunnelReturn') {
        currentItems().push(this.parseDivertLine());
        continue;
      }
      if (t.kind === 'Error') {
        this.next();
        continue;
      }
      currentItems().push(this.parseTextLine());
    }
    while (stack.length > 0) this.popChoice(stack);
    const block: BlockNode = {
      kind: 'Block',
      span: items.length > 0 ? mergeSpans((items[0] as BlockItem).span, (items[items.length - 1] as BlockItem).span) : pointSpan(this.peek().span.start),
      items,
    };
    return block;
  }

  private popChoice(stack: { depth: number; choice: ChoiceNode }[]): void {
    const frame = stack.pop();
    if (!frame) return;
    const { choice } = frame;
    if (choice.body.items.length > 0) {
      const first = choice.body.items[0] as BlockItem;
      const last = choice.body.items[choice.body.items.length - 1] as BlockItem;
      setSpan(choice.body, mergeSpans(first.span, last.span));
      setSpan(choice, mergeSpans(choice.span, choice.body.span));
    }
  }

  // ── lines ────────────────────────────────────────────────────────────────

  private parseChoiceLine(): ChoiceNode {
    const first = this.peek();
    const sticky = first.kind === 'ChoicePlus';
    let depth = 0;
    while (this.atKind(sticky ? 'ChoicePlus' : 'ChoiceStar')) {
      this.next();
      depth++;
    }
    let label: IdentifierNode | undefined;
    if (this.atKind('LParen') && this.atKind('Identifier', 1) && this.atKind('RParen', 2)) {
      this.next();
      label = identifier(this.next());
      this.next();
    }
    // Leading `{...}` interpolation-shaped groups are conditions (F323).
    const conditions: ExprNode[] = [];
    const firstSegments: InlineNode[] = [];
    for (;;) {
      // Skip whitespace-only text between condition groups: `* {a} {b} text`.
      const t = this.peek();
      if (
        t.kind === 'Text' &&
        String(t.value ?? t.text).trim() === '' &&
        this.atKind('LBrace', 1)
      ) {
        this.next();
        continue;
      }
      if (t.kind !== 'LBrace') break;
      const seg = this.parseInlineBlock();
      if (seg.kind === 'Interpolation') {
        conditions.push(seg.expr);
      } else {
        firstSegments.push(seg);
        break;
      }
    }
    const tags: TagNode[] = [];
    const prefix: InlineNode[] = [...firstSegments];
    let choiceOnly: InlineNode[] | undefined;
    let outputOnly: InlineNode[] = [];
    let bucket = prefix;
    for (;;) {
      const t = this.peek();
      if (t.kind === 'Newline' || t.kind === 'EOF') break;
      if (t.kind === 'LBracket') {
        this.next();
        if (choiceOnly === undefined) {
          choiceOnly = [];
          bucket = choiceOnly;
        } else {
          this.bag.add('FORGE101', t.span, 'a choice may contain only one "[...]" group');
        }
        continue;
      }
      if (t.kind === 'RBracket') {
        this.next();
        if (choiceOnly !== undefined && bucket === choiceOnly) {
          outputOnly = [];
          bucket = outputOnly;
        } else {
          this.bag.add('FORGE101', t.span, 'unmatched "]" in choice line');
        }
        continue;
      }
      if (t.kind === 'Tag') {
        tags.push(this.parseTag());
        continue;
      }
      const seg = this.parseInlineSegment();
      if (seg === undefined) break;
      bucket.push(seg);
    }
    const node: ChoiceNode = {
      kind: 'Choice',
      span: first.span,
      sticky,
      depth,
      ...(label !== undefined ? { label } : {}),
      conditions,
      prefix,
      ...(choiceOnly !== undefined ? { choiceOnly } : {}),
      outputOnly,
      tags,
      body: { kind: 'Block', span: pointSpan(this.peek().span.start), items: [] },
    };
    this.applyLeading(node);
    setSpan(node, mergeSpans(first.span, this.lastConsumedSpan() ?? first.span));
    this.endLine(node);
    return node;
  }

  private parseGatherLine(): GatherNode {
    const first = this.peek();
    let depth = 0;
    while (this.atKind('GatherDash')) {
      this.next();
      depth++;
    }
    let label: IdentifierNode | undefined;
    if (this.atKind('LParen') && this.atKind('Identifier', 1) && this.atKind('RParen', 2)) {
      this.next();
      label = identifier(this.next());
      this.next();
    }
    const { segments, tags } = this.parseSegmentsToLineEnd();
    const node: GatherNode = {
      kind: 'Gather',
      span: mergeSpans(first.span, this.lastConsumedSpan() ?? first.span),
      depth,
      ...(label !== undefined ? { label } : {}),
      segments,
      tags,
    };
    this.applyLeading(node);
    this.endLine(node);
    return node;
  }

  private parseTextLine(): TextLineNode {
    const first = this.peek();
    const { segments, tags } = this.parseSegmentsToLineEnd();
    const node: TextLineNode = {
      kind: 'TextLine',
      span: mergeSpans(first.span, this.lastConsumedSpan() ?? first.span),
      segments,
      tags,
    };
    this.applyLeading(node);
    this.endLine(node);
    return node;
  }

  private parseDivertLine(): BlockItem {
    const first = this.peek();
    const divert = this.parseDivert();
    const node: DivertLineNode = {
      kind: 'DivertLine',
      span: divert.span,
      divert,
    };
    this.applyLeading(node);
    // Allow trailing tags on divert lines.
    const tags: TagNode[] = [];
    while (this.atKind('Tag')) tags.push(this.parseTag());
    if (tags.length > 0) {
      const line: TextLineNode = {
        kind: 'TextLine',
        span: mergeSpans(first.span, this.lastConsumedSpan() ?? first.span),
        segments: [divert],
        tags,
      };
      if (node.leadingComments) line.leadingComments = node.leadingComments;
      this.endLine(line);
      return line;
    }
    this.endLine(node);
    return node;
  }

  private parseDivert(): DivertNode | TunnelReturnNode {
    const t = this.next();
    if (t.kind === 'TunnelReturn') {
      return { kind: 'TunnelReturn', span: t.span };
    }
    const targetPath: string[] = [];
    let end = t.span;
    if (this.atKind('Identifier')) {
      const id = this.next();
      targetPath.push(id.text);
      end = id.span;
      while (this.atKind('Dot')) {
        this.next();
        const part = this.expect('Identifier', 'an identifier after "." in a divert target');
        if (!part) break;
        targetPath.push(part.text);
        end = part.span;
      }
    }
    let tunnel = false;
    if (this.atKind('Divert') && !this.atKind('Identifier', 1)) {
      const arrow = this.next();
      tunnel = true;
      end = arrow.span;
    }
    if (targetPath.length === 0) {
      this.bag.add('FORGE105', t.span, 'divert "->" must name a target knot, stitch, or label');
    }
    return { kind: 'Divert', span: mergeSpans(t.span, end), targetPath, tunnel };
  }

  private parseSegmentsToLineEnd(): { segments: InlineNode[]; tags: TagNode[] } {
    const segments: InlineNode[] = [];
    const tags: TagNode[] = [];
    for (;;) {
      const t = this.peek();
      if (t.kind === 'Newline' || t.kind === 'EOF') break;
      if (t.kind === 'Tag') {
        tags.push(this.parseTag());
        continue;
      }
      const seg = this.parseInlineSegment();
      if (seg === undefined) break;
      segments.push(seg);
    }
    return { segments, tags };
  }

  /** Parse one inline segment, or undefined when the current token cannot start one. */
  private parseInlineSegment(): InlineNode | undefined {
    const t = this.peek();
    switch (t.kind) {
      case 'Text': {
        this.next();
        return { kind: 'Text', span: t.span, text: String(t.value ?? t.text) };
      }
      case 'Glue':
        this.next();
        return { kind: 'Glue', span: t.span };
      case 'Divert':
      case 'TunnelReturn':
        return this.parseDivert();
      case 'LBrace':
        return this.parseInlineBlock();
      case 'At':
        return this.parseEntityRef();
      case 'NoteRefOpen':
        return this.parseNoteRef();
      case 'Error':
        this.next();
        return undefined;
      default:
        this.bag.add('FORGE101', t.span, `unexpected ${describeToken(t)} in story text`);
        this.next();
        return undefined;
    }
  }

  private parseEntityRef(): InlineNode {
    const at = this.next();
    let end = at.span;
    const nameTok = this.expect('Identifier', 'an entity name after "@"');
    const name = nameTok ? nameTok.text : '<error>';
    if (nameTok) end = nameTok.span;
    let displayName: string | undefined;
    if (this.atKind('LParen')) {
      this.next();
      const raw = this.eat('Text');
      displayName = raw ? String(raw.value ?? raw.text) : '';
      const close = this.eat('RParen');
      end = close?.span ?? raw?.span ?? end;
    }
    let field: string | undefined;
    if (this.atKind('Dot')) {
      this.next();
      const fieldTok = this.expect('Identifier', 'a field name after "."');
      if (fieldTok) {
        field = fieldTok.text;
        end = fieldTok.span;
      }
    }
    return {
      kind: 'EntityRef',
      span: mergeSpans(at.span, end),
      name,
      ...(displayName !== undefined ? { displayName } : {}),
      ...(field !== undefined ? { field } : {}),
    };
  }

  private parseNoteRef(): InlineNode {
    const open = this.next();
    const titleTok = this.eat('Text');
    const close = this.eat('NoteRefClose');
    return {
      kind: 'NoteRef',
      span: mergeSpans(open.span, close?.span ?? titleTok?.span ?? open.span),
      title: titleTok ? String(titleTok.value ?? titleTok.text).trim() : '',
    };
  }

  // ── inline `{...}` blocks ────────────────────────────────────────────────

  private parseInlineBlock(): InlineNode {
    const open = this.next(); // LBrace
    if (this.atKind('Ampersand') || this.atKind('ShuffleMarker')) {
      const marker = this.next();
      const flavor = marker.kind === 'Ampersand' ? 'cycle' : 'shuffle';
      const branches = this.parseBranches();
      const close = this.eat('RBrace');
      return {
        kind: 'Alternative',
        span: mergeSpans(open.span, close?.span ?? this.peek().span),
        flavor,
        branches,
      };
    }
    const flavor = this.classifyInlineTokens();
    if (flavor === 'expr') {
      const expr = this.parseExpression();
      const close = this.expect('RBrace', '"}" to close the inline expression');
      return {
        kind: 'Interpolation',
        span: mergeSpans(open.span, close?.span ?? expr.span),
        expr,
      };
    }
    if (flavor === 'cond') {
      const condition = this.parseExpression();
      this.expect('Colon', '":" after the inline condition');
      const thenBranch = this.parseBranch();
      let elseBranch: BranchNode | undefined;
      if (this.atKind('Pipe')) {
        this.next();
        elseBranch = this.parseBranch();
        while (this.atKind('Pipe')) {
          const extra = this.next();
          this.bag.add('FORGE101', extra.span, 'an inline conditional has at most two branches ("{cond: then|else}")');
          this.parseBranch();
        }
      }
      const close = this.eat('RBrace');
      return {
        kind: 'InlineConditional',
        span: mergeSpans(open.span, close?.span ?? thenBranch.span),
        condition,
        thenBranch,
        ...(elseBranch !== undefined ? { elseBranch } : {}),
      };
    }
    const branches = this.parseBranches();
    const close = this.eat('RBrace');
    return {
      kind: 'Alternative',
      span: mergeSpans(open.span, close?.span ?? this.peek().span),
      flavor: 'sequence',
      branches,
    };
  }

  /** Mirror of the lexer's brace classification, over tokens (F327). */
  private classifyInlineTokens(): 'expr' | 'cond' | 'seq' {
    let j = this.i;
    let brace = 0;
    let paren = 0;
    let sawPipe = false;
    let sawColon = false;
    let sawQ = false;
    while (j < this.tokens.length) {
      const t = this.tokens[j] as Token;
      j++;
      if (t.kind === 'EOF' || t.kind === 'Newline') break;
      if (t.kind === 'LBrace') {
        brace++;
        continue;
      }
      if (t.kind === 'RBrace') {
        if (brace === 0) break;
        brace--;
        continue;
      }
      if (brace > 0) continue;
      if (t.kind === 'LParen') paren++;
      else if (t.kind === 'RParen') paren = Math.max(0, paren - 1);
      else if (paren === 0) {
        if (t.kind === 'Operator' && t.text === '?') sawQ = true;
        else if (t.kind === 'Colon' && !sawPipe && !sawQ) sawColon = true;
        else if (t.kind === 'Pipe') sawPipe = true;
      }
    }
    if (sawColon) return 'cond';
    return sawPipe ? 'seq' : 'expr';
  }

  private parseBranches(): BranchNode[] {
    const branches: BranchNode[] = [this.parseBranch()];
    while (this.atKind('Pipe')) {
      this.next();
      branches.push(this.parseBranch());
    }
    return branches;
  }

  private parseBranch(): BranchNode {
    const start = this.peek().span;
    const segments: InlineNode[] = [];
    for (;;) {
      const t = this.peek();
      if (t.kind === 'Pipe' || t.kind === 'RBrace' || t.kind === 'Newline' || t.kind === 'EOF') break;
      const seg = this.parseInlineSegment();
      if (seg === undefined) continue;
      segments.push(seg);
    }
    const last = segments[segments.length - 1];
    return {
      kind: 'Branch',
      span: last ? mergeSpans(start, last.span) : pointSpan(start.start),
      segments,
    };
  }

  // ── logic lines & expressions ────────────────────────────────────────────

  private parseLogicLine(): BlockItem {
    const tilde = this.next();
    const stmt = this.parseStmt();
    const node: LogicLineNode = {
      kind: 'LogicLine',
      span: mergeSpans(tilde.span, stmt.span),
      stmt,
    };
    this.applyLeading(node);
    this.endLine(node);
    return node;
  }

  private parseStmt(): StmtNode {
    if (this.atKind('TempKeyword')) {
      const kw = this.next();
      const nameTok = this.expect('Identifier', 'a variable name after "temp"');
      if (!nameTok) {
        this.syncExprError();
        return { kind: 'ExprStmt', span: kw.span, expr: { kind: 'ErrorExpr', span: kw.span } };
      }
      if (!this.atOperator('=')) {
        this.bag.add('FORGE103', this.peek().span, `temp ${nameTok.text} must be initialised with "= <expression>"`);
        this.syncExprError();
        return { kind: 'ExprStmt', span: kw.span, expr: { kind: 'ErrorExpr', span: nameTok.span } };
      }
      this.next();
      const init = this.parseExpression();
      return {
        kind: 'TempDecl',
        span: mergeSpans(kw.span, init.span),
        name: identifier(nameTok),
        init,
      };
    }
    if (this.atKind('Identifier') && this.peek(1).kind === 'Operator' && this.peek(1).text === '=') {
      const nameTok = this.next();
      this.next(); // =
      const value = this.parseExpression();
      return {
        kind: 'Assign',
        span: mergeSpans(nameTok.span, value.span),
        target: identifier(nameTok),
        value,
      };
    }
    const expr = this.parseExpression();
    return { kind: 'ExprStmt', span: expr.span, expr };
  }

  private syncExprError(): void {
    for (;;) {
      const t = this.peek();
      if (t.kind === 'Newline' || t.kind === 'EOF') return;
      this.next();
    }
  }

  /** Precedence-climbing expression parser (F324). */
  parseExpression(): ExprNode {
    const cond = this.parseBinary(1);
    if (this.atOperator('?')) {
      this.next();
      const whenTrue = this.parseExpression();
      this.expect('Colon', '":" in ternary expression');
      const whenFalse = this.parseExpression();
      return {
        kind: 'Ternary',
        span: mergeSpans(cond.span, whenFalse.span),
        condition: cond,
        whenTrue,
        whenFalse,
      };
    }
    return cond;
  }

  private parseBinary(minPrec: number): ExprNode {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.kind !== 'Operator') break;
      const word: Record<string, BinaryOp> = { and: '&&', or: '||' };
      const op = word[t.text] ?? (t.text as BinaryOp);
      const prec = BINARY_PRECEDENCE[op];
      if (prec === undefined || prec < minPrec) break;
      this.next();
      const right = this.parseBinary(prec + 1);
      left = {
        kind: 'Binary',
        span: mergeSpans(left.span, right.span),
        op,
        left,
        right,
      };
    }
    return left;
  }

  private parseUnary(): ExprNode {
    const t = this.peek();
    if (t.kind === 'Operator' && (t.text === '-' || t.text === '!' || t.text === 'not')) {
      this.next();
      const operand = this.parseUnary();
      const op: UnaryOp = t.text === '-' ? '-' : '!';
      return { kind: 'Unary', span: mergeSpans(t.span, operand.span), op, operand };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExprNode {
    const t = this.peek();
    switch (t.kind) {
      case 'Number':
        this.next();
        return { kind: 'Literal', span: t.span, value: Number(t.value ?? 0) };
      case 'String':
        this.next();
        return { kind: 'Literal', span: t.span, value: String(t.value ?? '') };
      case 'BoolLiteral':
        this.next();
        return { kind: 'Literal', span: t.span, value: t.value === true };
      case 'Identifier': {
        this.next();
        if (this.atKind('LParen')) {
          this.next();
          const args: ExprNode[] = [];
          if (!this.atKind('RParen')) {
            args.push(this.parseExpression());
            while (this.atKind('Comma')) {
              this.next();
              args.push(this.parseExpression());
            }
          }
          const close = this.expect('RParen', '")" to close the argument list');
          return {
            kind: 'Call',
            span: mergeSpans(t.span, close?.span ?? (args[args.length - 1]?.span ?? t.span)),
            callee: identifier(t),
            args,
          };
        }
        const path = [t.text];
        let end = t.span;
        while (this.atKind('Dot') && this.atKind('Identifier', 1)) {
          this.next();
          const part = this.next();
          path.push(part.text);
          end = part.span;
        }
        return { kind: 'VarRef', span: mergeSpans(t.span, end), path };
      }
      case 'At': {
        const seg = this.parseEntityRef();
        return seg as ExprNode;
      }
      case 'LParen': {
        this.next();
        const inner = this.parseExpression();
        this.expect('RParen', '")" to close the group');
        return inner;
      }
      case 'LBracket': {
        this.next();
        const elements: ExprNode[] = [];
        if (!this.atKind('RBracket')) {
          elements.push(this.parseExpression());
          while (this.atKind('Comma')) {
            this.next();
            elements.push(this.parseExpression());
          }
        }
        const close = this.expect('RBracket', '"]" to close the list');
        return {
          kind: 'ListLit',
          span: mergeSpans(t.span, close?.span ?? t.span),
          elements,
        };
      }
      default: {
        this.bag.add('FORGE102', t.span, `expected an expression but found ${describeToken(t)}`);
        if (t.kind !== 'Newline' && t.kind !== 'EOF' && t.kind !== 'RBrace' && t.kind !== 'Colon' && t.kind !== 'Pipe' && t.kind !== 'RParen' && t.kind !== 'RBracket') {
          this.next();
        }
        return { kind: 'ErrorExpr', span: t.span };
      }
    }
  }

  private lastConsumedSpan(): Span | undefined {
    for (let j = this.i - 1; j >= 0; j--) {
      const t = this.tokens[j];
      if (t !== undefined && !isTrivia(t.kind)) return t.span;
    }
    return undefined;
  }
}

function identifier(tok: Token): IdentifierNode {
  return { kind: 'Identifier', span: tok.span, name: tok.text };
}

function setSpan(node: { readonly span: Span }, s: Span): void {
  (node as { span: Span }).span = s;
}

function finishBlockSpan(block: BlockNode, fallback: Span): void {
  if (block.items.length > 0) {
    const first = block.items[0] as BlockItem;
    const last = block.items[block.items.length - 1] as BlockItem;
    setSpan(block, mergeSpans(first.span, last.span));
  } else {
    setSpan(block, pointSpan(fallback.end));
  }
}

function describeToken(t: Token): string {
  if (t.kind === 'EOF') return 'end of file';
  if (t.kind === 'Newline') return 'end of line';
  return `"${t.text.trim() === '' ? t.kind : t.text.trim()}"`;
}

/**
 * Parse Forge source into a Story AST. Never throws; all problems are
 * reported as diagnostics (F345).
 */
export function parse(source: string, options: ParseOptions = {}): ParseResult {
  const bag =
    options.bag ??
    (() => {
      const b = new DiagnosticBag(options.fileName !== undefined ? { file: options.fileName } : {});
      b.loadSuppressions(source);
      return b;
    })();
  const { tokens } = tokenize(source, bag);
  const parser = new Parser(tokens, bag, options.fileName);
  const story = parser.parseStory();
  return { story, diagnostics: bag.all };
}
