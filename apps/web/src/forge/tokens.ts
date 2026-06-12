/**
 * Tokenizer adapter (F381/F382): runs the real Forge lexer from
 * @fables/forge-dsl over a document and maps token kinds onto stable CSS
 * classes. The classes are styled in forge.css against the app's --code-*
 * variables, so Forge highlighting matches the markdown editor palette.
 */
import { tokenize, type TokenKind } from '@fables/forge-dsl';

/** Semantic highlight buckets. Each becomes a `tok-forge-<name>` CSS class. */
export type ForgeTokenClass =
  | 'keyword' // VAR / CONST / INCLUDE / temp / ~
  | 'heading' // === knot markers, = stitch markers, and their names
  | 'choice' // * + choice markers and - gathers
  | 'label' // (label) names on choices and gathers
  | 'divert' // -> ->-> targets, <> glue
  | 'string'
  | 'number'
  | 'bool'
  | 'operator'
  | 'variable' // identifiers in logic mode
  | 'brace' // { } | : & and the ~ shuffle marker
  | 'tag' // # tags
  | 'binding' // @entity bindings and [[note]] references
  | 'comment'
  | 'invalid'; // lexer error tokens

export interface HighlightSpan {
  readonly from: number;
  readonly to: number;
  readonly cls: ForgeTokenClass;
}

export function tokenClassName(cls: ForgeTokenClass): string {
  return `tok-forge-${cls}`;
}

const DIRECT: Partial<Record<TokenKind, ForgeTokenClass>> = {
  KnotMarker: 'heading',
  StitchMarker: 'heading',
  ChoiceStar: 'choice',
  ChoicePlus: 'choice',
  GatherDash: 'choice',
  Tilde: 'keyword',
  VarKeyword: 'keyword',
  ConstKeyword: 'keyword',
  IncludeKeyword: 'keyword',
  TempKeyword: 'keyword',
  Divert: 'divert',
  TunnelReturn: 'divert',
  Glue: 'divert',
  Tag: 'tag',
  LBrace: 'brace',
  RBrace: 'brace',
  Pipe: 'brace',
  Colon: 'brace',
  Ampersand: 'brace',
  ShuffleMarker: 'brace',
  Number: 'number',
  String: 'string',
  BoolLiteral: 'bool',
  Operator: 'operator',
  CommentLine: 'comment',
  CommentBlock: 'comment',
  NoteRefOpen: 'binding',
  NoteRefClose: 'binding',
  At: 'binding',
  Error: 'invalid',
};

/**
 * Context for classifying Identifier and raw Text tokens, which carry no mode
 * flag of their own:
 *   heading      — after `===` / `=` markers (knot and stitch names)
 *   divert       — inside a `-> a.b` target chain
 *   binding      — `@name`, `@name.field`, `@name(Display Name)`
 *   binding-args — between the `(` and `)` of a binding display name
 *   note         — between `[[` and `]]`
 *   marker       — right after choice/gather markers (a `(` opens a label)
 *   label        — inside `(label)` on a choice or gather line
 */
type Ctx = 'none' | 'heading' | 'divert' | 'binding' | 'binding-args' | 'note' | 'marker' | 'label';

/** Run the package lexer and produce ordered, non-overlapping highlight spans. */
export function forgeHighlightSpans(source: string): HighlightSpan[] {
  const { tokens } = tokenize(source);
  const out: HighlightSpan[] = [];
  const push = (from: number, to: number, cls: ForgeTokenClass): void => {
    if (to > from) out.push({ from, to, cls });
  };

  let ctx: Ctx = 'none';
  for (const t of tokens) {
    const from = t.span.start.offset;
    const to = t.span.end.offset;
    switch (t.kind) {
      case 'Identifier': {
        if (ctx === 'heading') push(from, to, 'heading');
        else if (ctx === 'divert') push(from, to, 'divert');
        else if (ctx === 'binding') push(from, to, 'binding');
        else if (ctx === 'label') push(from, to, 'label');
        else push(from, to, 'variable');
        // divert targets and bindings may continue with `.part` / `(args)`
        if (ctx !== 'divert' && ctx !== 'binding') ctx = 'none';
        break;
      }
      case 'Dot':
        push(from, to, ctx === 'divert' || ctx === 'binding' ? ctx : 'operator');
        break;
      case 'Text':
        if (ctx === 'note' || ctx === 'binding-args') {
          if (t.text.trim() !== '') push(from, to, 'binding');
        } else {
          ctx = 'none'; // plain prose resets any dangling context
        }
        break;
      case 'LParen':
        if (ctx === 'marker') ctx = 'label';
        else if (ctx === 'binding') ctx = 'binding-args';
        else ctx = 'none';
        break;
      case 'RParen':
        if (ctx === 'binding-args')
          ctx = 'binding'; // a `.field` may follow
        else ctx = 'none';
        break;
      case 'KnotMarker':
      case 'StitchMarker':
        push(from, to, 'heading');
        ctx = 'heading';
        break;
      case 'ChoiceStar':
      case 'ChoicePlus':
      case 'GatherDash':
        push(from, to, 'choice');
        ctx = 'marker';
        break;
      case 'Divert':
        push(from, to, 'divert');
        ctx = 'divert';
        break;
      case 'At':
        push(from, to, 'binding');
        ctx = 'binding';
        break;
      case 'NoteRefOpen':
        push(from, to, 'binding');
        ctx = 'note';
        break;
      case 'NoteRefClose':
        push(from, to, 'binding');
        ctx = 'none';
        break;
      case 'CommentLine':
      case 'CommentBlock':
        push(from, to, 'comment');
        break; // trivia does not break the surrounding context
      case 'Newline':
      case 'EOF':
        ctx = 'none';
        break;
      default: {
        const cls = DIRECT[t.kind];
        if (cls !== undefined) push(from, to, cls);
        ctx = 'none';
        break;
      }
    }
  }
  return out;
}

/** Exposed for tests: the context-free kind → class table. */
export function directTokenClass(kind: TokenKind): ForgeTokenClass | undefined {
  return DIRECT[kind];
}
