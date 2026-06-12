import type { Span } from './span.js';

/**
 * Forge AST (F331): a discriminated-union node hierarchy. Every node has a
 * `kind` tag and a `span`. `parent` is populated by the parent-pointer pass
 * (F336) and is excluded from serialization.
 */

/** Comment attached to the line-level node that follows (or ends) it (F374). */
export interface CommentTrivia {
  readonly text: string;
  readonly block: boolean;
  readonly span: Span;
}

export interface BaseNode {
  readonly kind: string;
  readonly span: Span;
  /** Set by `attachParents`; undefined on freshly parsed trees. */
  parent?: AnyNode | undefined;
  /** Full-line comments that appeared before this node. */
  leadingComments?: CommentTrivia[];
  /** Comment on the same line, after the content. */
  trailingComment?: CommentTrivia;
}

// ── top level ───────────────────────────────────────────────────────────────

export interface StoryNode extends BaseNode {
  readonly kind: 'Story';
  readonly fileName?: string;
  /** `# key: value` tags before any content — the story header (F322/F307). */
  readonly headerTags: TagNode[];
  readonly includes: IncludeNode[];
  readonly declarations: VarDeclNode[];
  /** Content before the first knot. */
  readonly preamble: BlockNode;
  readonly knots: KnotNode[];
}

export interface IncludeNode extends BaseNode {
  readonly kind: 'Include';
  readonly path: string;
}

export interface VarDeclNode extends BaseNode {
  readonly kind: 'VarDecl';
  readonly declKind: 'VAR' | 'CONST';
  readonly name: IdentifierNode;
  readonly init: ExprNode;
}

export interface KnotNode extends BaseNode {
  readonly kind: 'Knot';
  readonly name: IdentifierNode;
  readonly body: BlockNode;
  readonly stitches: StitchNode[];
  readonly tags: TagNode[];
}

export interface StitchNode extends BaseNode {
  readonly kind: 'Stitch';
  readonly name: IdentifierNode;
  readonly body: BlockNode;
}

export interface IdentifierNode extends BaseNode {
  readonly kind: 'Identifier';
  readonly name: string;
}

// ── blocks (weave) ──────────────────────────────────────────────────────────

export interface BlockNode extends BaseNode {
  readonly kind: 'Block';
  readonly items: BlockItem[];
}

export type BlockItem = TextLineNode | ChoiceNode | GatherNode | LogicLineNode | DivertLineNode;

export interface TextLineNode extends BaseNode {
  readonly kind: 'TextLine';
  readonly segments: InlineNode[];
  readonly tags: TagNode[];
}

export interface ChoiceNode extends BaseNode {
  readonly kind: 'Choice';
  /** `+` choices are sticky; `*` choices are once-only (F303). */
  readonly sticky: boolean;
  readonly depth: number;
  readonly label?: IdentifierNode;
  /** `{cond}` groups between the marker and the choice text. */
  readonly conditions: ExprNode[];
  /** Text shown in both the choice list and the output (before `[`). */
  readonly prefix: InlineNode[];
  /** `[choice-only]` text. Undefined when no brackets are used. */
  readonly choiceOnly?: InlineNode[];
  /** Text after `]`, only shown in output. */
  readonly outputOnly: InlineNode[];
  readonly tags: TagNode[];
  /** Nested content owned by this choice. */
  readonly body: BlockNode;
}

export interface GatherNode extends BaseNode {
  readonly kind: 'Gather';
  readonly depth: number;
  readonly label?: IdentifierNode;
  readonly segments: InlineNode[];
  readonly tags: TagNode[];
}

export interface LogicLineNode extends BaseNode {
  readonly kind: 'LogicLine';
  readonly stmt: StmtNode;
}

export interface DivertLineNode extends BaseNode {
  readonly kind: 'DivertLine';
  readonly divert: DivertNode | TunnelReturnNode;
}

// ── flow ────────────────────────────────────────────────────────────────────

export interface DivertNode extends BaseNode {
  readonly kind: 'Divert';
  /** Dotted target path, e.g. `["forest", "clearing"]`. `END`/`DONE` are special. */
  readonly targetPath: string[];
  /** True for tunnel calls: `-> target ->`. */
  readonly tunnel: boolean;
}

export interface TunnelReturnNode extends BaseNode {
  readonly kind: 'TunnelReturn';
}

// ── inline content ──────────────────────────────────────────────────────────

export type InlineNode =
  | TextSegmentNode
  | InterpolationNode
  | InlineConditionalNode
  | AlternativeNode
  | GlueNode
  | DivertNode
  | TunnelReturnNode
  | EntityRefNode
  | NoteRefNode;

export interface TextSegmentNode extends BaseNode {
  readonly kind: 'Text';
  readonly text: string;
}

export interface InterpolationNode extends BaseNode {
  readonly kind: 'Interpolation';
  readonly expr: ExprNode;
}

export interface InlineConditionalNode extends BaseNode {
  readonly kind: 'InlineConditional';
  readonly condition: ExprNode;
  readonly thenBranch: BranchNode;
  readonly elseBranch?: BranchNode;
}

export interface AlternativeNode extends BaseNode {
  readonly kind: 'Alternative';
  readonly flavor: 'sequence' | 'cycle' | 'shuffle';
  readonly branches: BranchNode[];
}

export interface BranchNode extends BaseNode {
  readonly kind: 'Branch';
  readonly segments: InlineNode[];
}

export interface GlueNode extends BaseNode {
  readonly kind: 'Glue';
}

export interface EntityRefNode extends BaseNode {
  readonly kind: 'EntityRef';
  /** Identifier after `@`. When `displayName` is set this is the binding kind (`entity`). */
  readonly name: string;
  /** `@entity(Display Name)` form. */
  readonly displayName?: string;
  /** `@hero.health` field access. */
  readonly field?: string;
}

export interface NoteRefNode extends BaseNode {
  readonly kind: 'NoteRef';
  readonly title: string;
}

export interface TagNode extends BaseNode {
  readonly kind: 'Tag';
  readonly text: string;
}

// ── statements ──────────────────────────────────────────────────────────────

export type StmtNode = TempDeclNode | AssignNode | ExprStmtNode;

export interface TempDeclNode extends BaseNode {
  readonly kind: 'TempDecl';
  readonly name: IdentifierNode;
  readonly init: ExprNode;
}

export interface AssignNode extends BaseNode {
  readonly kind: 'Assign';
  readonly target: IdentifierNode;
  readonly value: ExprNode;
}

export interface ExprStmtNode extends BaseNode {
  readonly kind: 'ExprStmt';
  readonly expr: ExprNode;
}

// ── expressions ─────────────────────────────────────────────────────────────

export type ExprNode =
  | LiteralExprNode
  | ListExprNode
  | VarRefExprNode
  | UnaryExprNode
  | BinaryExprNode
  | TernaryExprNode
  | CallExprNode
  | EntityRefNode
  | ErrorExprNode;

export interface LiteralExprNode extends BaseNode {
  readonly kind: 'Literal';
  readonly value: boolean | number | string;
}

export interface ListExprNode extends BaseNode {
  readonly kind: 'ListLit';
  readonly elements: ExprNode[];
}

export interface VarRefExprNode extends BaseNode {
  readonly kind: 'VarRef';
  /** Dotted path: plain `x` or read-count refs like `forest.clearing`. */
  readonly path: string[];
}

export type UnaryOp = '-' | '!';
export type BinaryOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | '&&'
  | '||'
  | 'has'
  | 'hasnt';

export interface UnaryExprNode extends BaseNode {
  readonly kind: 'Unary';
  readonly op: UnaryOp;
  readonly operand: ExprNode;
}

export interface BinaryExprNode extends BaseNode {
  readonly kind: 'Binary';
  readonly op: BinaryOp;
  readonly left: ExprNode;
  readonly right: ExprNode;
}

export interface TernaryExprNode extends BaseNode {
  readonly kind: 'Ternary';
  readonly condition: ExprNode;
  readonly whenTrue: ExprNode;
  readonly whenFalse: ExprNode;
}

export interface CallExprNode extends BaseNode {
  readonly kind: 'Call';
  readonly callee: IdentifierNode;
  readonly args: ExprNode[];
}

/** Placeholder produced by parser error recovery (F329). */
export interface ErrorExprNode extends BaseNode {
  readonly kind: 'ErrorExpr';
}

// ── the full union ──────────────────────────────────────────────────────────

export type AnyNode =
  | StoryNode
  | IncludeNode
  | VarDeclNode
  | KnotNode
  | StitchNode
  | IdentifierNode
  | BlockNode
  | TextLineNode
  | ChoiceNode
  | GatherNode
  | LogicLineNode
  | DivertLineNode
  | DivertNode
  | TunnelReturnNode
  | TextSegmentNode
  | InterpolationNode
  | InlineConditionalNode
  | AlternativeNode
  | BranchNode
  | GlueNode
  | EntityRefNode
  | NoteRefNode
  | TagNode
  | TempDeclNode
  | AssignNode
  | ExprStmtNode
  | LiteralExprNode
  | ListExprNode
  | VarRefExprNode
  | UnaryExprNode
  | BinaryExprNode
  | TernaryExprNode
  | CallExprNode
  | ErrorExprNode;

export type NodeKind = AnyNode['kind'];

/** Special divert targets understood by the runtime. */
export const SPECIAL_TARGETS = new Set(['END', 'DONE']);

export function isExprNode(node: AnyNode): node is ExprNode {
  switch (node.kind) {
    case 'Literal':
    case 'ListLit':
    case 'VarRef':
    case 'Unary':
    case 'Binary':
    case 'Ternary':
    case 'Call':
    case 'EntityRef':
    case 'ErrorExpr':
      return true;
    default:
      return false;
  }
}
