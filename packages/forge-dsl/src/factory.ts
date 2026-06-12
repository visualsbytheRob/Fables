import type {
  AlternativeNode,
  AssignNode,
  BinaryExprNode,
  BinaryOp,
  BlockNode,
  BranchNode,
  CallExprNode,
  ChoiceNode,
  DivertLineNode,
  DivertNode,
  EntityRefNode,
  ExprNode,
  GatherNode,
  IdentifierNode,
  IncludeNode,
  InlineConditionalNode,
  InlineNode,
  InterpolationNode,
  KnotNode,
  ListExprNode,
  LiteralExprNode,
  LogicLineNode,
  NoteRefNode,
  StitchNode,
  StmtNode,
  StoryNode,
  TagNode,
  TempDeclNode,
  TernaryExprNode,
  TextLineNode,
  TextSegmentNode,
  UnaryExprNode,
  UnaryOp,
  VarDeclNode,
  VarRefExprNode,
  BlockItem,
} from './ast.js';
import { SYNTHETIC_SPAN } from './span.js';
import type { Span } from './span.js';

/**
 * Node factories (F338) for tests and codegen tooling. All nodes get a
 * synthetic span unless one is supplied.
 */

const S = SYNTHETIC_SPAN;

export const f = {
  ident(name: string, span: Span = S): IdentifierNode {
    return { kind: 'Identifier', span, name };
  },
  story(parts: Partial<Omit<StoryNode, 'kind' | 'span'>> = {}, span: Span = S): StoryNode {
    return {
      kind: 'Story',
      span,
      headerTags: parts.headerTags ?? [],
      includes: parts.includes ?? [],
      declarations: parts.declarations ?? [],
      preamble: parts.preamble ?? f.block([]),
      knots: parts.knots ?? [],
    };
  },
  include(path: string, span: Span = S): IncludeNode {
    return { kind: 'Include', span, path };
  },
  varDecl(declKind: 'VAR' | 'CONST', name: string, init: ExprNode, span: Span = S): VarDeclNode {
    return { kind: 'VarDecl', span, declKind, name: f.ident(name), init };
  },
  knot(name: string, items: BlockItem[] = [], stitches: StitchNode[] = [], span: Span = S): KnotNode {
    return { kind: 'Knot', span, name: f.ident(name), body: f.block(items), stitches, tags: [] };
  },
  stitch(name: string, items: BlockItem[] = [], span: Span = S): StitchNode {
    return { kind: 'Stitch', span, name: f.ident(name), body: f.block(items) };
  },
  block(items: BlockItem[], span: Span = S): BlockNode {
    return { kind: 'Block', span, items };
  },
  textLine(segments: (InlineNode | string)[], tags: TagNode[] = [], span: Span = S): TextLineNode {
    return { kind: 'TextLine', span, segments: segments.map(asSegment), tags };
  },
  text(text: string, span: Span = S): TextSegmentNode {
    return { kind: 'Text', span, text };
  },
  glue(span: Span = S): InlineNode {
    return { kind: 'Glue', span };
  },
  tag(text: string, span: Span = S): TagNode {
    return { kind: 'Tag', span, text };
  },
  choice(
    parts: {
      sticky?: boolean;
      depth?: number;
      label?: string;
      conditions?: ExprNode[];
      prefix?: (InlineNode | string)[];
      choiceOnly?: (InlineNode | string)[];
      outputOnly?: (InlineNode | string)[];
      body?: BlockItem[];
    } = {},
    span: Span = S,
  ): ChoiceNode {
    return {
      kind: 'Choice',
      span,
      sticky: parts.sticky ?? false,
      depth: parts.depth ?? 1,
      ...(parts.label !== undefined ? { label: f.ident(parts.label) } : {}),
      conditions: parts.conditions ?? [],
      prefix: (parts.prefix ?? []).map(asSegment),
      ...(parts.choiceOnly !== undefined ? { choiceOnly: parts.choiceOnly.map(asSegment) } : {}),
      outputOnly: (parts.outputOnly ?? []).map(asSegment),
      tags: [],
      body: f.block(parts.body ?? []),
    };
  },
  gather(depth = 1, segments: (InlineNode | string)[] = [], label?: string, span: Span = S): GatherNode {
    return {
      kind: 'Gather',
      span,
      depth,
      ...(label !== undefined ? { label: f.ident(label) } : {}),
      segments: segments.map(asSegment),
      tags: [],
    };
  },
  logicLine(stmt: StmtNode, span: Span = S): LogicLineNode {
    return { kind: 'LogicLine', span, stmt };
  },
  tempDecl(name: string, init: ExprNode, span: Span = S): TempDeclNode {
    return { kind: 'TempDecl', span, name: f.ident(name), init };
  },
  assign(name: string, value: ExprNode, span: Span = S): AssignNode {
    return { kind: 'Assign', span, target: f.ident(name), value };
  },
  divert(targetPath: string[], tunnel = false, span: Span = S): DivertNode {
    return { kind: 'Divert', span, targetPath, tunnel };
  },
  divertLine(targetPath: string[], tunnel = false, span: Span = S): DivertLineNode {
    return { kind: 'DivertLine', span, divert: f.divert(targetPath, tunnel, span) };
  },
  tunnelReturnLine(span: Span = S): DivertLineNode {
    return { kind: 'DivertLine', span, divert: { kind: 'TunnelReturn', span } };
  },
  interpolation(expr: ExprNode, span: Span = S): InterpolationNode {
    return { kind: 'Interpolation', span, expr };
  },
  inlineConditional(
    condition: ExprNode,
    thenSegments: (InlineNode | string)[],
    elseSegments?: (InlineNode | string)[],
    span: Span = S,
  ): InlineConditionalNode {
    return {
      kind: 'InlineConditional',
      span,
      condition,
      thenBranch: f.branch(thenSegments),
      ...(elseSegments !== undefined ? { elseBranch: f.branch(elseSegments) } : {}),
    };
  },
  alternative(
    flavor: 'sequence' | 'cycle' | 'shuffle',
    branches: (InlineNode | string)[][],
    span: Span = S,
  ): AlternativeNode {
    return { kind: 'Alternative', span, flavor, branches: branches.map((b) => f.branch(b)) };
  },
  branch(segments: (InlineNode | string)[], span: Span = S): BranchNode {
    return { kind: 'Branch', span, segments: segments.map(asSegment) };
  },
  entityRef(name: string, opts: { displayName?: string; field?: string } = {}, span: Span = S): EntityRefNode {
    return {
      kind: 'EntityRef',
      span,
      name,
      ...(opts.displayName !== undefined ? { displayName: opts.displayName } : {}),
      ...(opts.field !== undefined ? { field: opts.field } : {}),
    };
  },
  noteRef(title: string, span: Span = S): NoteRefNode {
    return { kind: 'NoteRef', span, title };
  },
  lit(value: boolean | number | string, span: Span = S): LiteralExprNode {
    return { kind: 'Literal', span, value };
  },
  list(elements: ExprNode[], span: Span = S): ListExprNode {
    return { kind: 'ListLit', span, elements };
  },
  varRef(...path: string[]): VarRefExprNode {
    return { kind: 'VarRef', span: S, path };
  },
  unary(op: UnaryOp, operand: ExprNode, span: Span = S): UnaryExprNode {
    return { kind: 'Unary', span, op, operand };
  },
  binary(op: BinaryOp, left: ExprNode, right: ExprNode, span: Span = S): BinaryExprNode {
    return { kind: 'Binary', span, op, left, right };
  },
  ternary(condition: ExprNode, whenTrue: ExprNode, whenFalse: ExprNode, span: Span = S): TernaryExprNode {
    return { kind: 'Ternary', span, condition, whenTrue, whenFalse };
  },
  call(callee: string, args: ExprNode[] = [], span: Span = S): CallExprNode {
    return { kind: 'Call', span, callee: f.ident(callee), args };
  },
};

function asSegment(seg: InlineNode | string): InlineNode {
  return typeof seg === 'string' ? f.text(seg) : seg;
}
