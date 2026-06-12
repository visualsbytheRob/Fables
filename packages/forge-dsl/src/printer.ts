import type {
  BlockItem,
  BlockNode,
  BranchNode,
  ChoiceNode,
  CommentTrivia,
  DivertNode,
  ExprNode,
  GatherNode,
  InlineNode,
  StoryNode,
  TagNode,
  TunnelReturnNode,
} from './ast.js';
import { BINARY_PRECEDENCE } from './parser.js';

/**
 * AST printer (F333): AST → canonical Forge source. This is the engine behind
 * `format()` (F371); printing then re-parsing must produce an equivalent tree,
 * and printing twice must produce identical text (F375).
 */

export interface PrintOptions {
  /** Spaces per weave nesting level. Default 2. */
  readonly indentSize?: number;
  /** `spaced` prints nested markers as `* * `, `compact` as `** `. Default spaced. */
  readonly choiceMarkerStyle?: 'spaced' | 'compact';
  /**
   * Advisory maximum line width (F379). Prose is never hard-wrapped (line
   * breaks are meaningful in Forge), so this only suppresses cosmetic padding.
   */
  readonly maxWidth?: number;
}

interface Ctx {
  readonly indentSize: number;
  readonly markerStyle: 'spaced' | 'compact';
  readonly lines: string[];
}

export function printStory(story: StoryNode, options: PrintOptions = {}): string {
  const ctx: Ctx = {
    indentSize: options.indentSize ?? 2,
    markerStyle: options.choiceMarkerStyle ?? 'spaced',
    lines: [],
  };

  if (story.headerTags.length > 0) {
    for (const tag of story.headerTags) ctx.lines.push(`# ${tag.text}`);
    ctx.lines.push('');
  }
  if (story.includes.length > 0) {
    for (const inc of story.includes) {
      pushLeading(ctx, inc.leadingComments, 0);
      ctx.lines.push(withTrailing(`INCLUDE ${inc.path}`, inc.trailingComment));
    }
    ctx.lines.push('');
  }
  if (story.declarations.length > 0) {
    for (const decl of story.declarations) {
      pushLeading(ctx, decl.leadingComments, 0);
      ctx.lines.push(
        withTrailing(
          `${decl.declKind} ${decl.name.name} = ${printExpr(decl.init)}`,
          decl.trailingComment,
        ),
      );
    }
    ctx.lines.push('');
  }
  printBlock(ctx, story.preamble, 0);
  for (const knot of story.knots) {
    if (ctx.lines.length > 0 && ctx.lines[ctx.lines.length - 1] !== '') ctx.lines.push('');
    pushLeading(ctx, knot.leadingComments, 0);
    const tags = knot.tags.map((t) => ` # ${t.text}`).join('');
    ctx.lines.push(withTrailing(`=== ${knot.name.name} ===${tags}`, knot.trailingComment));
    printBlock(ctx, knot.body, 0);
    for (const stitch of knot.stitches) {
      pushLeading(ctx, stitch.leadingComments, 0);
      ctx.lines.push(withTrailing(`= ${stitch.name.name}`, stitch.trailingComment));
      printBlock(ctx, stitch.body, 0);
    }
  }
  // Comments that trailed all content in the file.
  pushLeading(ctx, story.leadingComments, 0);

  while (ctx.lines.length > 0 && ctx.lines[ctx.lines.length - 1] === '') ctx.lines.pop();
  return ctx.lines.join('\n') + (ctx.lines.length > 0 ? '\n' : '');
}

// ── blocks & weave ──────────────────────────────────────────────────────────

function printBlock(ctx: Ctx, block: BlockNode, depth: number): void {
  for (const item of block.items) printItem(ctx, item, depth);
}

function printItem(ctx: Ctx, item: BlockItem, depth: number): void {
  const indent = ' '.repeat(depth * ctx.indentSize);
  pushLeading(ctx, item.leadingComments, depth * ctx.indentSize);
  switch (item.kind) {
    case 'TextLine': {
      const body = printSegments(item.segments, 'line').trim();
      const text = (body + printTags(item.tags)).trim();
      ctx.lines.push(withTrailing(indent + text, item.trailingComment));
      return;
    }
    case 'LogicLine': {
      const stmt = item.stmt;
      let body: string;
      if (stmt.kind === 'TempDecl') body = `temp ${stmt.name.name} = ${printExpr(stmt.init)}`;
      else if (stmt.kind === 'Assign') body = `${stmt.target.name} = ${printExpr(stmt.value)}`;
      else body = printExpr(stmt.expr);
      ctx.lines.push(withTrailing(`${indent}~ ${body}`, item.trailingComment));
      return;
    }
    case 'DivertLine': {
      ctx.lines.push(withTrailing(indent + printDivert(item.divert), item.trailingComment));
      return;
    }
    case 'Choice':
      printChoice(ctx, item);
      return;
    case 'Gather':
      printGather(ctx, item);
      return;
  }
}

function printChoice(ctx: Ctx, choice: ChoiceNode): void {
  const indent = ' '.repeat((choice.depth - 1) * ctx.indentSize);
  const markerChar = choice.sticky ? '+' : '*';
  const marker =
    ctx.markerStyle === 'spaced'
      ? Array(choice.depth).fill(markerChar).join(' ')
      : markerChar.repeat(choice.depth);
  const parts: string[] = [marker];
  if (choice.label) parts.push(`(${choice.label.name})`);
  for (const cond of choice.conditions) parts.push(`{${printExpr(cond)}}`);
  const prefix = printSegments(choice.prefix, 'choice').trim();
  if (prefix.length > 0) parts.push(prefix);
  if (choice.choiceOnly !== undefined) {
    const inner = printSegments(choice.choiceOnly, 'choice').trim();
    const after = printSegments(choice.outputOnly, 'choice').replace(/\s+$/, '');
    parts.push(`[${inner}]${after}`);
  } else {
    const output = printSegments(choice.outputOnly, 'choice').trim();
    if (output.length > 0) parts.push(output);
  }
  const tags = printTags(choice.tags);
  ctx.lines.push(withTrailing(indent + parts.join(' ') + tags, choice.trailingComment));
  printBlock(ctx, choice.body, choice.depth);
}

function printGather(ctx: Ctx, gather: GatherNode): void {
  const indent = ' '.repeat((gather.depth - 1) * ctx.indentSize);
  const marker = Array(gather.depth).fill('-').join(' ');
  const parts: string[] = [marker];
  if (gather.label) parts.push(`(${gather.label.name})`);
  const text = printSegments(gather.segments, 'line').trim();
  if (text.length > 0) parts.push(text);
  const tags = printTags(gather.tags);
  ctx.lines.push(withTrailing(indent + parts.join(' ') + tags, gather.trailingComment));
}

// ── inline content ──────────────────────────────────────────────────────────

type TextContext = 'line' | 'choice' | 'branch';

export function printSegments(segments: InlineNode[], context: TextContext): string {
  let out = '';
  for (const seg of segments) {
    switch (seg.kind) {
      case 'Text':
        out += escapeText(seg.text, context, out.length === 0);
        break;
      case 'Glue':
        out += '<>';
        break;
      case 'Divert':
      case 'TunnelReturn': {
        if (out.length > 0 && !/\s$/.test(out)) out += ' ';
        out += printDivert(seg);
        break;
      }
      case 'Interpolation':
        out += `{${printExpr(seg.expr)}}`;
        break;
      case 'InlineConditional': {
        const thenPart = printBranch(seg.thenBranch);
        const elsePart = seg.elseBranch ? `|${printBranch(seg.elseBranch)}` : '';
        out += `{${printExpr(seg.condition)}: ${thenPart}${elsePart}}`;
        break;
      }
      case 'Alternative': {
        const markers = { sequence: '', cycle: '&', shuffle: '~' } as const;
        out += `{${markers[seg.flavor]}${seg.branches.map(printBranch).join('|')}}`;
        break;
      }
      case 'EntityRef':
        out += printEntityRef(seg.name, seg.displayName, seg.field);
        break;
      case 'NoteRef':
        out += `[[${seg.title}]]`;
        break;
    }
  }
  return out;
}

function printBranch(branch: BranchNode): string {
  // Branch padding is normalised away: `{ a | b }` prints as `{a|b}`.
  return printSegments(branch.segments, 'branch').trim();
}

export function printDivert(d: DivertNode | TunnelReturnNode): string {
  if (d.kind === 'TunnelReturn') return '->->';
  const target = d.targetPath.join('.');
  return d.tunnel ? `-> ${target} ->` : `-> ${target}`;
}

function printEntityRef(name: string, displayName: string | undefined, field: string | undefined): string {
  let out = `@${name}`;
  if (displayName !== undefined) out += `(${displayName})`;
  if (field !== undefined) out += `.${field}`;
  return out;
}

function printTags(tags: TagNode[]): string {
  return tags.map((t) => ` # ${t.text}`).join('');
}

/**
 * Escape prose so it re-lexes to the same text (F333/F375): inline markers,
 * comments, diverts, glue, bindings, and (contextually) brackets and pipes.
 */
export function escapeText(text: string, context: TextContext, atLineStart: boolean): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    const next = text[i + 1] ?? '';
    const lineStart = atLineStart && out.length === 0;
    if (c === '\\' || c === '{' || c === '}' || c === '#') out += `\\${c}`;
    else if (c === '-' && next === '>') out += '\\-';
    else if (c === '<' && next === '>') out += '\\<';
    else if (c === '/' && (next === '/' || next === '*')) out += '\\/';
    else if (c === '@' && /[A-Za-z_]/.test(next)) out += '\\@';
    else if (c === '[' || c === ']') out += context === 'line' && !(c === '[' && next === '[') ? c : `\\${c}`;
    else if (c === '|' && context === 'branch') out += `\\|`;
    else if (c === ':' && context === 'branch') out += `\\:`;
    else if (lineStart && (c === '*' || c === '+' || c === '=' || c === '~' || c === '-')) out += `\\${c}`;
    else out += c;
  }
  return out;
}

// ── expressions ─────────────────────────────────────────────────────────────

const TERNARY_PREC = 0;
const UNARY_PREC = 7;

export function printExpr(expr: ExprNode): string {
  return printExprPrec(expr, -1);
}

function printExprPrec(expr: ExprNode, parentPrec: number): string {
  switch (expr.kind) {
    case 'Literal':
      return typeof expr.value === 'string' ? quoteString(expr.value) : String(expr.value);
    case 'ListLit':
      return `[${expr.elements.map((e) => printExprPrec(e, -1)).join(', ')}]`;
    case 'VarRef':
      return expr.path.join('.');
    case 'EntityRef':
      return printEntityRef(expr.name, expr.displayName, expr.field);
    case 'Call':
      return `${expr.callee.name}(${expr.args.map((a) => printExprPrec(a, -1)).join(', ')})`;
    case 'Unary': {
      const inner = printExprPrec(expr.operand, UNARY_PREC);
      const text = `${expr.op}${inner}`;
      return UNARY_PREC < parentPrec ? `(${text})` : text;
    }
    case 'Binary': {
      const prec = BINARY_PRECEDENCE[expr.op];
      const left = printExprPrec(expr.left, prec);
      const right = printExprPrec(expr.right, prec + 1);
      const text = `${left} ${expr.op} ${right}`;
      return prec < parentPrec ? `(${text})` : text;
    }
    case 'Ternary': {
      const text = `${printExprPrec(expr.condition, 1)} ? ${printExprPrec(expr.whenTrue, 1)} : ${printExprPrec(expr.whenFalse, TERNARY_PREC)}`;
      return parentPrec > TERNARY_PREC ? `(${text})` : text;
    }
    case 'ErrorExpr':
      return '0';
  }
}

function quoteString(value: string): string {
  let out = '"';
  for (const c of value) {
    if (c === '"') out += '\\"';
    else if (c === '\\') out += '\\\\';
    else if (c === '\n') out += '\\n';
    else if (c === '\t') out += '\\t';
    else out += c;
  }
  return out + '"';
}

// ── comments ────────────────────────────────────────────────────────────────

function pushLeading(ctx: Ctx, comments: CommentTrivia[] | undefined, indentCols: number): void {
  if (!comments) return;
  const indent = ' '.repeat(indentCols);
  for (const c of comments) {
    ctx.lines.push(indent + c.text.trim());
  }
}

function withTrailing(line: string, comment: CommentTrivia | undefined): string {
  if (!comment) return line;
  return `${line} ${comment.text.trim()}`;
}
