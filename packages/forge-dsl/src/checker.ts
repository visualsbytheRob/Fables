import type {
  BlockItem,
  BlockNode,
  ChoiceNode,
  DivertNode,
  ExprNode,
  InlineNode,
  StoryNode,
  TunnelReturnNode,
} from './ast.js';
import { SPECIAL_TARGETS } from './ast.js';
import type { DiagnosticBag } from './diagnostics.js';
import type { Diagnostic } from './diagnostics.js';
import { findAll } from './query.js';
import { didYouMean } from './suggest.js';
import type { ForgeType, SymbolTable } from './symbols.js';
import { BUILTIN_FUNCTIONS } from './symbols.js';

/**
 * Semantic checks (F361–F370): expression typing, boolean conditions, list
 * operations, weave structure rules, exhaustion analysis, tunnel pairing,
 * const reassignment, interpolation and entity-field validation.
 */

export interface CheckResult {
  readonly diagnostics: readonly Diagnostic[];
}

interface Ctx {
  readonly symbols: SymbolTable;
  readonly bag: DiagnosticBag;
  readonly globalTypes: Map<string, ForgeType>;
  /** containerKey → temp name → type. */
  readonly tempTypes: Map<string, Map<string, ForgeType>>;
  currentScope: { file: string | undefined; knot: string };
}

export function check(symbols: SymbolTable, bag: DiagnosticBag): CheckResult {
  const ctx: Ctx = {
    symbols,
    bag,
    globalTypes: new Map(),
    tempTypes: new Map(),
    currentScope: { file: undefined, knot: '' },
  };

  // Global declaration types, in declaration order (F361).
  for (const unit of symbols.units) {
    ctx.currentScope = { file: unit.fileName, knot: '' };
    for (const decl of unit.story.declarations) {
      const type = inferType(decl.init, ctx);
      if (!ctx.globalTypes.has(decl.name.name)) ctx.globalTypes.set(decl.name.name, type);
    }
  }

  for (const unit of symbols.units) {
    checkStory(unit.story, unit.fileName, ctx);
  }

  checkTunnelPairing(ctx);
  checkEntityFields(ctx);
  return { diagnostics: bag.all };
}

function checkStory(story: StoryNode, file: string | undefined, ctx: Ctx): void {
  ctx.currentScope = { file, knot: '' };
  checkBlock(story.preamble, ctx);
  for (const knot of story.knots) {
    ctx.currentScope = { file, knot: knot.name.name };
    checkBlock(knot.body, ctx);
    for (const stitch of knot.stitches) checkBlock(stitch.body, ctx);
  }
}

function tempTypeScope(ctx: Ctx): Map<string, ForgeType> {
  const key = `${ctx.currentScope.file ?? ''}::${ctx.currentScope.knot}`;
  let map = ctx.tempTypes.get(key);
  if (map === undefined) {
    map = new Map();
    ctx.tempTypes.set(key, map);
  }
  return map;
}

// ── block-level checks ───────────────────────────────────────────────────────

function checkBlock(block: BlockNode, ctx: Ctx): void {
  checkUnreachableAfterDivert(block, ctx);
  checkChoiceExhaustion(block, ctx);
  for (const item of block.items) checkItem(item, ctx);
}

function checkItem(item: BlockItem, ctx: Ctx): void {
  switch (item.kind) {
    case 'LogicLine': {
      const stmt = item.stmt;
      if (stmt.kind === 'TempDecl') {
        tempTypeScope(ctx).set(stmt.name.name, inferType(stmt.init, ctx));
      } else if (stmt.kind === 'Assign') {
        const valueType = inferType(stmt.value, ctx);
        const name = stmt.target.name;
        const global = ctx.symbols.globals.get(name);
        if (global !== undefined && global.declKind === 'CONST') {
          ctx.bag.add('FORGE307', stmt.target.span, `cannot reassign constant "${name}"`, [
            {
              span: global.span,
              message: 'declared CONST here',
              ...(global.file !== undefined ? { file: global.file } : {}),
            },
          ]);
        }
        const declared = tempTypeScope(ctx).get(name) ?? ctx.globalTypes.get(name);
        if (
          declared !== undefined &&
          declared !== 'unknown' &&
          valueType !== 'unknown' &&
          declared !== valueType &&
          !(declared === 'list' && (valueType === 'list' || valueType === 'number' || valueType === 'string'))
        ) {
          ctx.bag.add(
            'FORGE301',
            stmt.value.span,
            `cannot assign ${valueType} to "${name}", which is ${declared}`,
          );
        }
      } else {
        inferType(stmt.expr, ctx);
      }
      return;
    }
    case 'TextLine':
      checkSegments(item.segments, ctx);
      return;
    case 'Gather':
      checkSegments(item.segments, ctx);
      return;
    case 'Choice': {
      for (const cond of item.conditions) checkCondition(cond, ctx, 'choice condition');
      checkEmptyChoice(item, ctx);
      checkSegments(item.prefix, ctx);
      if (item.choiceOnly !== undefined) checkSegments(item.choiceOnly, ctx);
      checkSegments(item.outputOnly, ctx);
      checkBlock(item.body, ctx);
      return;
    }
    case 'DivertLine':
      return;
  }
}

function checkSegments(segments: InlineNode[], ctx: Ctx): void {
  for (const seg of segments) {
    switch (seg.kind) {
      case 'Interpolation': {
        if (seg.expr.kind === 'ErrorExpr') {
          ctx.bag.add('FORGE308', seg.span, 'this "{...}" block is not a valid expression to interpolate');
        } else {
          inferType(seg.expr, ctx);
        }
        break;
      }
      case 'InlineConditional': {
        checkCondition(seg.condition, ctx, 'inline condition');
        checkSegments(seg.thenBranch.segments, ctx);
        if (seg.elseBranch) checkSegments(seg.elseBranch.segments, ctx);
        break;
      }
      case 'Alternative':
        for (const branch of seg.branches) checkSegments(branch.segments, ctx);
        break;
      default:
        break;
    }
  }
}

/** F362: conditions must be boolean, with a coercion hint. */
function checkCondition(expr: ExprNode, ctx: Ctx, what: string): void {
  const type = inferType(expr, ctx);
  if (type !== 'bool' && type !== 'unknown') {
    const hint =
      type === 'number'
        ? ' — compare it explicitly, e.g. "x > 0"'
        : type === 'string'
          ? ' — compare it explicitly, e.g. \'name == "fox"\''
          : type === 'list'
            ? ' — test membership with "has", e.g. "items has key"'
            : '';
    ctx.bag.add('FORGE302', expr.span, `${what} must be a bool, but this is a ${type}${hint}`);
  }
}

/** F364: content following an unconditional divert in the same block is unreachable. */
function checkUnreachableAfterDivert(block: BlockNode, ctx: Ctx): void {
  let terminated: DivertNode | TunnelReturnNode | undefined;
  for (const item of block.items) {
    if (terminated !== undefined) {
      if (item.kind === 'Gather') {
        terminated = undefined; // gathers re-join flow from nested choices
        continue;
      }
      ctx.bag.add(
        'FORGE304',
        item.span,
        `this is unreachable: flow always diverts at line ${terminated.span.start.line}`,
      );
      continue;
    }
    terminated = terminalDivertOf(item);
  }
}

function terminalDivertOf(item: BlockItem): DivertNode | TunnelReturnNode | undefined {
  if (item.kind === 'DivertLine') {
    if (item.divert.kind === 'TunnelReturn') return item.divert;
    if (!item.divert.tunnel) return item.divert;
    return undefined;
  }
  if (item.kind === 'TextLine') {
    const last = item.segments[item.segments.length - 1];
    if (last !== undefined && last.kind === 'Divert' && !last.tunnel) return last;
  }
  return undefined;
}

/** F365: groups of once-only choices in revisitable knots can dead-end. */
function checkChoiceExhaustion(block: BlockNode, ctx: Ctx): void {
  const choices = block.items.filter((i): i is ChoiceNode => i.kind === 'Choice');
  if (choices.length === 0) return;
  const allOnceOnly = choices.every((c) => !c.sticky);
  if (!allOnceOnly) return;
  const hasFallback = choices.some((c) => choiceTextIsEmpty(c) && choiceHasDivert(c));
  if (hasFallback) return;
  if (!knotCanReachItself(ctx.currentScope.knot, ctx.symbols)) return;
  const first = choices[0] as ChoiceNode;
  ctx.bag.add(
    'FORGE305',
    first.span,
    `all ${choices.length === 1 ? 'of this choice point' : `${choices.length} choices here`} are once-only and "${ctx.currentScope.knot}" can be revisited — add a sticky "+" choice or a fallback "* -> target" to avoid a dead end`,
  );
}

const selfReachMemo = new WeakMap<SymbolTable, Map<string, boolean>>();

function knotCanReachItself(knot: string, symbols: SymbolTable): boolean {
  if (knot === '') return false;
  let memo = selfReachMemo.get(symbols);
  if (memo === undefined) {
    memo = new Map();
    selfReachMemo.set(symbols, memo);
  }
  const cached = memo.get(knot);
  if (cached !== undefined) return cached;
  const seen = new Set<string>();
  const queue = [...(symbols.knotGraph.get(knot) ?? [])];
  let result = false;
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    if (cur === knot) {
      result = true;
      break;
    }
    if (seen.has(cur)) continue;
    seen.add(cur);
    queue.push(...(symbols.knotGraph.get(cur) ?? []));
  }
  memo.set(knot, result);
  return result;
}

/** F346/F310: choices that render no text and have no fallback divert. */
function checkEmptyChoice(choice: ChoiceNode, ctx: Ctx): void {
  if (!choiceTextIsEmpty(choice)) return;
  if (choiceHasDivert(choice)) return; // fallback choice, idiomatic
  ctx.bag.add('FORGE310', choice.span, 'this choice has no text for the reader to pick');
}

function choiceTextIsEmpty(choice: ChoiceNode): boolean {
  const visible = [...choice.prefix, ...(choice.choiceOnly ?? [])];
  return !visible.some((seg) => {
    if (seg.kind === 'Text') return seg.text.trim() !== '';
    if (seg.kind === 'Glue' || seg.kind === 'Divert' || seg.kind === 'TunnelReturn') return false;
    return true;
  });
}

function choiceHasDivert(choice: ChoiceNode): boolean {
  const inline = [...choice.prefix, ...choice.outputOnly].some((s) => s.kind === 'Divert');
  if (inline) return true;
  const firstItem = choice.body.items[0];
  return firstItem !== undefined && firstItem.kind === 'DivertLine';
}

/** F366: tunnel call/return pairing. */
function checkTunnelPairing(ctx: Ctx): void {
  const tunnelTargets = new Set(ctx.symbols.tunnelCalls.map((c) => c.target));
  for (const [knot, spans] of ctx.symbols.tunnelReturns) {
    if (knot === '') continue;
    if (!tunnelTargets.has(knot)) {
      const span = spans[0];
      if (span !== undefined) {
        ctx.bag.add(
          'FORGE306',
          span,
          `"->->" returns from a tunnel, but knot "${knot}" is never called as one ("-> ${knot} ->")`,
        );
      }
    }
  }
  for (const call of ctx.symbols.tunnelCalls) {
    if (SPECIAL_TARGETS.has(call.target)) continue;
    if (!ctx.symbols.tunnelReturns.has(call.target)) {
      ctx.bag.add(
        'FORGE306',
        call.span,
        `tunnel call to "${call.target}", but it contains no "->->" return`,
      );
    }
  }
}

/** F369: `@entity.field` must exist on the entity schema. */
function checkEntityFields(ctx: Ctx): void {
  for (const [node, schema] of ctx.symbols.entities) {
    if (node.field === undefined) continue;
    if (!(node.field in schema.fields)) {
      ctx.bag.add(
        'FORGE309',
        node.span,
        `entity "${schema.name}" has no field "${node.field}"${didYouMean(node.field, Object.keys(schema.fields))}`,
      );
    }
  }
}

// ── expression typing (F361) ─────────────────────────────────────────────────

function inferType(expr: ExprNode, ctx: Ctx): ForgeType {
  switch (expr.kind) {
    case 'Literal':
      return typeof expr.value === 'boolean' ? 'bool' : typeof expr.value === 'number' ? 'number' : 'string';
    case 'ListLit':
      for (const el of expr.elements) inferType(el, ctx);
      return 'list';
    case 'VarRef': {
      if (expr.path.length === 1) {
        const name = expr.path[0] as string;
        const temp = tempTypeScope(ctx).get(name);
        if (temp !== undefined) return temp;
        const global = ctx.globalTypes.get(name);
        if (global !== undefined) return global;
      }
      // Knot/stitch/label read counts are numbers (F354).
      const target = ctx.symbols.targets.get(expr.path.join('.'));
      if (target !== undefined) return 'number';
      if (ctx.symbols.knots.has(expr.path[0] ?? '') || isRelativeTarget(expr.path, ctx)) return 'number';
      return 'unknown';
    }
    case 'EntityRef': {
      const schema = ctx.symbols.entities.get(expr);
      if (schema === undefined) return expr.field !== undefined ? 'unknown' : 'string';
      if (expr.field === undefined) return 'string';
      return schema.fields[expr.field] ?? 'unknown';
    }
    case 'Unary': {
      const operand = inferType(expr.operand, ctx);
      if (expr.op === '-') {
        if (operand !== 'number' && operand !== 'unknown') {
          ctx.bag.add('FORGE301', expr.span, `unary "-" needs a number, but this is a ${operand}`);
        }
        return 'number';
      }
      if (operand !== 'bool' && operand !== 'unknown') {
        ctx.bag.add('FORGE301', expr.span, `"!" needs a bool, but this is a ${operand}`);
      }
      return 'bool';
    }
    case 'Binary':
      return inferBinary(expr.op, expr, ctx);
    case 'Ternary': {
      checkCondition(expr.condition, ctx, 'ternary condition');
      const whenTrue = inferType(expr.whenTrue, ctx);
      const whenFalse = inferType(expr.whenFalse, ctx);
      if (whenTrue === 'unknown') return whenFalse;
      if (whenFalse === 'unknown') return whenTrue;
      if (whenTrue !== whenFalse) {
        ctx.bag.add(
          'FORGE301',
          expr.span,
          `ternary branches disagree: ${whenTrue} vs ${whenFalse}`,
        );
        return 'unknown';
      }
      return whenTrue;
    }
    case 'Call': {
      const sig = BUILTIN_FUNCTIONS[expr.callee.name];
      if (sig === undefined) {
        for (const arg of expr.args) inferType(arg, ctx);
        return 'unknown';
      }
      if (expr.args.length !== sig.params.length) {
        ctx.bag.add(
          'FORGE301',
          expr.span,
          `${expr.callee.name}() takes ${sig.params.length} argument${sig.params.length === 1 ? '' : 's'}, got ${expr.args.length}`,
        );
      }
      expr.args.forEach((arg, i) => {
        const got = inferType(arg, ctx);
        const want = sig.params[i];
        if (want !== undefined && got !== 'unknown' && got !== want) {
          ctx.bag.add('FORGE301', arg.span, `${expr.callee.name}() argument ${i + 1} must be a ${want}, but this is a ${got}`);
        }
      });
      return sig.result;
    }
    case 'ErrorExpr':
      return 'unknown';
  }
}

function isRelativeTarget(path: string[], ctx: Ctx): boolean {
  if (ctx.currentScope.knot === '') return false;
  return ctx.symbols.targets.has(`${ctx.currentScope.knot}.${path.join('.')}`);
}

function inferBinary(op: string, expr: { left: ExprNode; right: ExprNode; span: ExprNode['span'] }, ctx: Ctx): ForgeType {
  const left = inferType(expr.left, ctx);
  const right = inferType(expr.right, ctx);
  const unknown = left === 'unknown' || right === 'unknown';
  switch (op) {
    case '+':
    case '-': {
      if (left === 'list') return 'list'; // list add/remove (F363)
      if (op === '+' && left === 'string' && right === 'string') return 'string';
      if (!unknown && (left !== 'number' || right !== 'number')) {
        ctx.bag.add('FORGE301', expr.span, `"${op}" needs numbers, but this is ${left} ${op} ${right}`);
      }
      return left === 'string' || right === 'string' ? 'string' : 'number';
    }
    case '*':
    case '/':
    case '%': {
      if (!unknown && (left !== 'number' || right !== 'number')) {
        ctx.bag.add('FORGE301', expr.span, `"${op}" needs numbers, but this is ${left} ${op} ${right}`);
      }
      return 'number';
    }
    case '<':
    case '<=':
    case '>':
    case '>=': {
      if (!unknown && (left !== 'number' || right !== 'number')) {
        ctx.bag.add('FORGE301', expr.span, `"${op}" compares numbers, but this is ${left} ${op} ${right}`);
      }
      return 'bool';
    }
    case '==':
    case '!=': {
      if (!unknown && left !== right) {
        ctx.bag.add('FORGE301', expr.span, `cannot compare ${left} with ${right}`);
      }
      return 'bool';
    }
    case '&&':
    case '||': {
      if (!unknown && (left !== 'bool' || right !== 'bool')) {
        ctx.bag.add('FORGE301', expr.span, `"${op}" needs bool operands, but this is ${left} ${op} ${right}`);
      }
      return 'bool';
    }
    case 'has':
    case 'hasnt': {
      if (left !== 'list' && left !== 'unknown') {
        ctx.bag.add('FORGE303', expr.span, `"${op}" needs a list on the left, but this is a ${left}`);
      }
      return 'bool';
    }
    default:
      return 'unknown';
  }
}

/** Every block in a story, for tests that sanity-check traversal coverage. */
export function allBlocks(story: StoryNode): BlockNode[] {
  return findAll(story, 'Block');
}
