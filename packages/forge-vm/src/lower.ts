/**
 * AST → IR lowering (F403–F406) and code generation (F421–F429).
 *
 * The front-end (`@fables/forge-dsl`) parses and resolves; this pass walks
 * the AST and emits the flat container tree described in `ir.md`. It is a
 * two-phase pass: phase A pre-assigns container indexes to every knot,
 * stitch, and labeled choice/gather (so forward diverts resolve); phase B
 * emits instructions.
 */

import type {
  BlockItem,
  ChoiceNode,
  Diagnostic,
  DivertNode,
  ExprNode,
  FileProvider,
  GatherNode,
  InlineNode,
  LiteralExprNode,
  Span,
  StmtNode,
  StoryUnit,
  TagNode,
} from '@fables/forge-dsl';
import { compile, walk } from '@fables/forge-dsl';

import type { BindingEntry, ContainerKind, IrConst, IrContainer, IrGlobal, IrProgram, SrcSpan } from './ir.js';
import { ALT_FLAVOR, BYTECODE_VERSION, CHOICE_FLAG_FALLBACK, CHOICE_FLAG_STICKY, Op } from './ir.js';
import type { ConstGlobals } from './optimize.js';
import { foldExpr, isLiteral } from './optimize.js';
import { BUILTIN_IDS, EFFECT_IDS } from './stdlib.js';

/** Raised when the AST cannot be lowered (unknown targets, assignments to CONST…). */
export class LoweringError extends Error {
  readonly span: Span | undefined;
  readonly file: string | undefined;
  constructor(message: string, span?: Span, file?: string) {
    super(message);
    this.name = 'LoweringError';
    this.span = span;
    this.file = file;
  }
}

export interface CompileToIrOptions {
  readonly fileName?: string;
  /** Resolves INCLUDE paths (front-end FileProvider). */
  readonly files?: FileProvider;
  /** Constant folding + dead-branch pruning (F409). Default true. */
  readonly optimize?: boolean;
}

export interface CompileToIrResult {
  readonly program: IrProgram;
  /** Front-end diagnostics — advisory; lowering succeeds when no hard errors. */
  readonly diagnostics: readonly Diagnostic[];
}

/** Compile Forge source straight to an IR program (parse → resolve → lower). */
export function compileToIr(source: string, options: CompileToIrOptions = {}): CompileToIrResult {
  const front = compile(source, {
    ...(options.fileName !== undefined ? { fileName: options.fileName } : {}),
    ...(options.files !== undefined ? { files: options.files } : {}),
  });
  const program = lowerStory(front.symbols.units, options);
  return { program, diagnostics: front.diagnostics };
}

// ── emission machinery ───────────────────────────────────────────────────────

interface MutableContainer extends IrContainer {
  instrs: { op: Op; args: number[]; list?: number[] }[];
}

class Emit {
  constructor(readonly c: MutableContainer) {}

  get length(): number {
    return this.c.instrs.length;
  }

  emit(op: Op, args: number[] = [], span: SrcSpan | null = null, list?: number[]): number {
    this.c.instrs.push({ op, args, ...(list !== undefined ? { list } : {}) });
    this.c.spans.push(span);
    return this.c.instrs.length - 1;
  }

  patchArg(at: number, argIndex: number, value: number): void {
    (this.c.instrs[at] as { args: number[] }).args[argIndex] = value;
  }

  patchList(at: number, listIndex: number, value: number): void {
    const instr = this.c.instrs[at] as { list?: number[] };
    if (instr.list !== undefined) instr.list[listIndex] = value;
  }
}

interface Scope {
  readonly fileIdx: number;
  readonly fileName: string | undefined;
  /** Enclosing knot name ('' for the preamble). */
  readonly knot: string;
  /** Knot or knot.stitch path used for relative target lookup + naming. */
  readonly containerPath: string;
}

type ExitSpec = { kind: 'done' } | { kind: 'divert'; container: number };

class Ctx {
  strings: string[] = [];
  private stringIds = new Map<string, number>();
  consts: IrConst[] = [];
  private constIds = new Map<string, number>();
  containers: MutableContainer[] = [];
  private nameCounts = new Map<string, number>();
  targets = new Map<string, number>();
  nodeContainers = new Map<ChoiceNode | GatherNode, number>();
  globals = new Map<string, { index: number; declKind: 'VAR' | 'CONST' }>();
  globalList: IrGlobal[] = [];
  constGlobals = new Map<string, LiteralExprNode>();
  temps = new Map<string, Map<string, number>>();
  tempNames: Record<string, string[]> = {};
  maxTempSlots = 0;
  altCount = 0;
  bindings: BindingEntry[] = [];
  private bindingKeys = new Set<string>();
  files: string[] = [];

  constructor(readonly optimize: boolean) {}

  str(s: string): number {
    let id = this.stringIds.get(s);
    if (id === undefined) {
      id = this.strings.length;
      this.strings.push(s);
      this.stringIds.set(s, id);
    }
    return id;
  }

  constant(c: IrConst): number {
    const key = `${c.kind}:${String(c.value)}`;
    let id = this.constIds.get(key);
    if (id === undefined) {
      id = this.consts.length;
      this.consts.push(c);
      this.constIds.set(key, id);
    }
    return id;
  }

  literalConst(value: boolean | number | string): number {
    if (typeof value === 'number') return this.constant({ kind: 'number', value });
    if (typeof value === 'boolean') return this.constant({ kind: 'bool', value });
    return this.constant({ kind: 'string', value: this.str(value) });
  }

  uniqueName(base: string): string {
    const n = (this.nameCounts.get(base) ?? 0) + 1;
    this.nameCounts.set(base, n);
    return n === 1 && !base.includes('#') ? base : `${base}${n}`;
  }

  newContainer(name: string, kind: ContainerKind, visitTracked: boolean): MutableContainer {
    let unique = name;
    if (this.containers.some((c) => c.name === unique)) {
      let i = 2;
      while (this.containers.some((c) => c.name === `${name}~${i}`)) i++;
      unique = `${name}~${i}`;
    }
    const c: MutableContainer = {
      index: this.containers.length,
      name: unique,
      kind,
      visitTracked,
      instrs: [],
      spans: [],
    };
    this.containers.push(c);
    return c;
  }

  tempSlot(scope: Scope, name: string, create: boolean): number | undefined {
    const key = `${scope.fileIdx}:${scope.knot}`;
    let map = this.temps.get(key);
    if (map === undefined) {
      map = new Map();
      this.temps.set(key, map);
    }
    const existing = map.get(name);
    if (existing !== undefined) return existing;
    if (!create) return undefined;
    const slot = map.size;
    map.set(name, slot);
    const names = (this.tempNames[scope.knot === '' ? '<preamble>' : scope.knot] ??= []);
    names.push(name);
    this.maxTempSlots = Math.max(this.maxTempSlots, map.size);
    return slot;
  }

  binding(b: BindingEntry): void {
    const key = `${b.kind}|${b.name}|${b.field ?? ''}`;
    if (this.bindingKeys.has(key)) return;
    this.bindingKeys.add(key);
    this.bindings.push(b);
  }

  fold(expr: ExprNode): ExprNode {
    return this.optimize ? foldExpr(expr, this.constGlobals as ConstGlobals) : expr;
  }
}

function toSrc(scope: Scope, span: Span): SrcSpan | null {
  if (span.start.line === 0 && span.end.line === 0) return null;
  return {
    file: scope.fileIdx,
    line: span.start.line,
    col: span.start.col,
    endLine: span.end.line,
    endCol: span.end.col,
  };
}

// ── the lowering pass ────────────────────────────────────────────────────────

/** Lower resolved story units into an IR program (F403). */
export function lowerStory(units: StoryUnit[], options: CompileToIrOptions = {}): IrProgram {
  const ctx = new Ctx(options.optimize !== false);
  const entry = units[0];
  if (entry === undefined) throw new LoweringError('no story unit to lower');
  ctx.files = units.map((u, i) => u.fileName ?? (i === 0 ? '<entry>' : `<include ${i}>`));

  // ── phase A: pre-assign containers ─────────────────────────────────────────
  const preamble = ctx.newContainer('<preamble>', 'preamble', false);
  declareLabels(ctx, entry.story.preamble, '');
  for (let u = 0; u < units.length; u++) {
    const unit = units[u] as StoryUnit;
    for (const knot of unit.story.knots) {
      const name = knot.name.name;
      const kc = ctx.newContainer(name, 'knot', true);
      if (!ctx.targets.has(name)) ctx.targets.set(name, kc.index);
      declareLabels(ctx, knot.body, name);
      for (const stitch of knot.stitches) {
        const fullPath = `${name}.${stitch.name.name}`;
        const sc = ctx.newContainer(fullPath, 'stitch', true);
        if (!ctx.targets.has(fullPath)) ctx.targets.set(fullPath, sc.index);
        declareLabels(ctx, stitch.body, fullPath);
      }
    }
  }

  // ── globals (F422/F441) ────────────────────────────────────────────────────
  for (let u = 0; u < units.length; u++) {
    const unit = units[u] as StoryUnit;
    const scope: Scope = { fileIdx: u, fileName: unit.fileName, knot: '', containerPath: '' };
    for (const decl of unit.story.declarations) {
      const name = decl.name.name;
      if (ctx.globals.has(name)) continue; // duplicate — front-end reports FORGE201
      const index = ctx.globalList.length;
      ctx.globals.set(name, { index, declKind: decl.declKind });
      const init = ctx.newContainer(`${name}#init`, 'init', false);
      const em = new Emit(init);
      const folded = ctx.fold(decl.init);
      lowerExpr(ctx, em, folded, scope);
      em.emit(Op.RET, [], toSrc(scope, decl.span));
      ctx.globalList.push({ name, declKind: decl.declKind, initContainer: init.index });
      if (decl.declKind === 'CONST' && isLiteral(folded)) ctx.constGlobals.set(name, folded);
    }
  }

  // ── phase B: emit ──────────────────────────────────────────────────────────
  const entryScope: Scope = { fileIdx: 0, fileName: entry.fileName, knot: '', containerPath: '' };
  lowerItems(ctx, new Emit(preamble), entry.story.preamble.items, 0, entryScope, { kind: 'done' });

  for (let u = 0; u < units.length; u++) {
    const unit = units[u] as StoryUnit;
    for (const knot of unit.story.knots) {
      const name = knot.name.name;
      const kc = ctx.containers[ctx.targets.get(name) as number] as MutableContainer;
      if (kc.instrs.length > 0) continue; // duplicate knot name — first wins
      const scope: Scope = { fileIdx: u, fileName: unit.fileName, knot: name, containerPath: name };
      const em = new Emit(kc);
      em.emit(Op.VISIT, [kc.index], toSrc(scope, knot.name.span));
      lowerItems(ctx, em, knot.body.items, 0, scope, { kind: 'done' });
      for (const stitch of knot.stitches) {
        const fullPath = `${name}.${stitch.name.name}`;
        const sc = ctx.containers[ctx.targets.get(fullPath) as number] as MutableContainer;
        if (sc.instrs.length > 0) continue;
        const sScope: Scope = { fileIdx: u, fileName: unit.fileName, knot: name, containerPath: fullPath };
        const sem = new Emit(sc);
        sem.emit(Op.VISIT, [sc.index], toSrc(sScope, stitch.name.span));
        lowerItems(ctx, sem, stitch.body.items, 0, sScope, { kind: 'done' });
      }
    }
  }

  // Entry point: a non-empty preamble, otherwise the first knot.
  let entryContainer = preamble.index;
  if (entry.story.preamble.items.length === 0) {
    const firstKnot = entry.story.knots[0];
    if (firstKnot !== undefined) entryContainer = ctx.targets.get(firstKnot.name.name) ?? preamble.index;
  }

  // Header metadata.
  const meta: Record<string, string> = {};
  for (const tag of entry.story.headerTags) {
    const text = tag.text.trim();
    const colon = text.indexOf(':');
    if (colon >= 0) meta[text.slice(0, colon).trim()] = text.slice(colon + 1).trim();
    else if (text.length > 0) meta[text] = '';
  }

  // Intern every name the serializer references through the string table.
  for (const c of ctx.containers) ctx.str(c.name);
  for (const g of ctx.globalList) ctx.str(g.name);
  for (const b of ctx.bindings) {
    ctx.str(b.name);
    if (b.field !== undefined) ctx.str(b.field);
  }

  return {
    version: BYTECODE_VERSION,
    meta,
    strings: ctx.strings,
    consts: ctx.consts,
    containers: ctx.containers,
    globals: ctx.globalList,
    entryContainer,
    maxTempSlots: ctx.maxTempSlots,
    files: ctx.files,
    bindings: ctx.bindings,
    tempNames: ctx.tempNames,
    altCount: ctx.altCount,
  };
}

/** Pre-assign containers for labeled choices/gathers (addressable targets, F405). */
function declareLabels(ctx: Ctx, block: { items: BlockItem[] } | unknown, containerPath: string): void {
  walk(block as never, {
    enter(node) {
      if ((node.kind === 'Choice' || node.kind === 'Gather') && node.label !== undefined) {
        const fullPath = containerPath === '' ? node.label.name : `${containerPath}.${node.label.name}`;
        const kind: ContainerKind = node.kind === 'Choice' ? 'choiceBody' : 'gather';
        const c = ctx.newContainer(fullPath, kind, true);
        ctx.nodeContainers.set(node, c.index);
        if (!ctx.targets.has(fullPath)) ctx.targets.set(fullPath, c.index);
      }
    },
  });
}

// ── block items ──────────────────────────────────────────────────────────────

function emitExit(em: Emit, exit: ExitSpec): void {
  if (exit.kind === 'done') em.emit(Op.DONE);
  else em.emit(Op.DIVERT, [exit.container]);
}

function lowerItems(ctx: Ctx, em: Emit, items: readonly BlockItem[], start: number, scope: Scope, exit: ExitSpec): void {
  for (let i = start; i < items.length; i++) {
    const item = items[i] as BlockItem;
    switch (item.kind) {
      case 'TextLine': {
        const dead = lowerSegments(ctx, em, item.segments, scope);
        if (dead) return;
        emitTags(ctx, em, item.tags, scope);
        em.emit(Op.NEWLINE, [], toSrc(scope, item.span));
        break;
      }
      case 'LogicLine':
        lowerStmt(ctx, em, item.stmt, scope);
        break;
      case 'DivertLine': {
        if (item.divert.kind === 'TunnelReturn') {
          em.emit(Op.TUNNEL_RETURN, [], toSrc(scope, item.span));
          return; // anything after `->->` is unreachable
        }
        const terminated = emitDivert(ctx, em, item.divert, scope);
        if (terminated) return;
        break; // tunnels continue with the next item
      }
      case 'Gather': {
        const g = lowerGatherChain(ctx, items, i, scope, exit);
        em.emit(Op.DIVERT, [g], toSrc(scope, item.span));
        return;
      }
      case 'Choice': {
        lowerChoiceRun(ctx, em, items, i, scope, exit);
        return;
      }
    }
  }
  emitExit(em, exit);
}

/** Lower a gather and everything after it into a fresh container; returns its index. */
function lowerGatherChain(ctx: Ctx, items: readonly BlockItem[], i: number, scope: Scope, exit: ExitSpec): number {
  const g = items[i] as GatherNode;
  let idx = ctx.nodeContainers.get(g);
  if (idx === undefined) {
    idx = ctx.newContainer(ctx.uniqueName(`${pathBase(scope)}#g`), 'gather', false).index;
  }
  const container = ctx.containers[idx] as MutableContainer;
  const em = new Emit(container);
  if (container.visitTracked) em.emit(Op.VISIT, [idx], toSrc(scope, g.span));
  const dead = lowerSegments(ctx, em, g.segments, scope);
  if (!dead) {
    if (g.segments.length > 0 || g.tags.length > 0) {
      emitTags(ctx, em, g.tags, scope);
      em.emit(Op.NEWLINE, [], toSrc(scope, g.span));
    }
    lowerItems(ctx, em, items, i + 1, scope, exit);
  }
  return idx;
}

function pathBase(scope: Scope): string {
  return scope.containerPath === '' ? '<preamble>' : scope.containerPath;
}

// ── choices (F405/F425) ──────────────────────────────────────────────────────

function lowerChoiceRun(ctx: Ctx, em: Emit, items: readonly BlockItem[], i: number, scope: Scope, exit: ExitSpec): void {
  const run: ChoiceNode[] = [];
  let k = i;
  while (k < items.length && (items[k] as BlockItem).kind === 'Choice') {
    run.push(items[k] as ChoiceNode);
    k++;
  }

  let contExit: ExitSpec = exit;
  if (k < items.length) {
    const next = items[k] as BlockItem;
    let contIdx: number;
    if (next.kind === 'Gather') {
      contIdx = lowerGatherChain(ctx, items, k, scope, exit);
    } else {
      const c = ctx.newContainer(ctx.uniqueName(`${pathBase(scope)}#c`), 'gather', false);
      lowerItems(ctx, new Emit(c), items, k, scope, exit);
      contIdx = c.index;
    }
    contExit = { kind: 'divert', container: contIdx };
  }

  for (const choice of run) emitChoice(ctx, em, choice, scope, contExit);
  em.emit(Op.PRESENT, [], toSrc(scope, (run[run.length - 1] as ChoiceNode).span));
}

function hasPresentable(segments: readonly InlineNode[] | undefined): boolean {
  if (segments === undefined) return false;
  return segments.some((s) => {
    if (s.kind === 'Glue' || s.kind === 'Divert' || s.kind === 'TunnelReturn') return false;
    if (s.kind === 'Text') return s.text.trim().length > 0;
    return true;
  });
}

function emitChoice(ctx: Ctx, em: Emit, choice: ChoiceNode, scope: Scope, contExit: ExitSpec): void {
  const span = toSrc(scope, choice.span);
  let bodyIdx = ctx.nodeContainers.get(choice);
  if (bodyIdx === undefined) {
    bodyIdx = ctx.newContainer(ctx.uniqueName(`${pathBase(scope)}#opt`), 'choiceBody', true).index;
  }
  const body = ctx.containers[bodyIdx] as MutableContainer;
  const bodyName = body.name;

  // Presented text (F457): prefix + [choice-only], lazily evaluated each presentation.
  const text = ctx.newContainer(`${bodyName}#text`, 'choiceText', false);
  {
    const tem = new Emit(text);
    lowerSegments(ctx, tem, choice.prefix, scope);
    if (choice.choiceOnly !== undefined) lowerSegments(ctx, tem, choice.choiceOnly, scope);
    emitTags(ctx, tem, choice.tags, scope);
    tem.emit(Op.RET, [], span);
  }

  // Conditions (F453): an eval container re-run at every presentation.
  let condIdx = 0;
  if (choice.conditions.length > 0) {
    const cond = ctx.newContainer(`${bodyName}#cond`, 'eval', false);
    const cem = new Emit(cond);
    choice.conditions.forEach((c, ci) => {
      lowerExpr(ctx, cem, ctx.fold(c), scope);
      if (ci > 0) cem.emit(Op.AND, [], null);
    });
    cem.emit(Op.RET, [], span);
    condIdx = cond.index + 1;
  }

  // Body: visit marker (once-only tracking + labels), output text, nested weave.
  {
    const bem = new Emit(body);
    bem.emit(Op.VISIT, [bodyIdx], span);
    const output: InlineNode[] = [...choice.prefix, ...choice.outputOnly];
    const dead = lowerSegments(ctx, bem, output, scope);
    if (!dead) {
      if (hasPresentable(output)) {
        emitTags(ctx, bem, choice.tags, scope);
        bem.emit(Op.NEWLINE, [], span);
      }
      lowerItems(ctx, bem, choice.body.items, 0, scope, contExit);
    }
  }

  const fallback = !hasPresentable(choice.prefix) && !hasPresentable(choice.choiceOnly);
  const flags = (choice.sticky ? CHOICE_FLAG_STICKY : 0) | (fallback ? CHOICE_FLAG_FALLBACK : 0);
  em.emit(Op.CHOICE, [flags, condIdx, text.index, bodyIdx], span);
}

// ── inline segments (F421/F424) ──────────────────────────────────────────────

/** Lower inline content. Returns true when flow diverted away (rest of line is dead). */
function lowerSegments(ctx: Ctx, em: Emit, segments: readonly InlineNode[], scope: Scope): boolean {
  for (const seg of segments) {
    switch (seg.kind) {
      case 'Text':
        if (seg.text.length > 0) em.emit(Op.TEXT, [ctx.str(seg.text)], toSrc(scope, seg.span));
        break;
      case 'Glue':
        em.emit(Op.GLUE, [], toSrc(scope, seg.span));
        break;
      case 'Interpolation':
        lowerExpr(ctx, em, ctx.fold(seg.expr), scope);
        em.emit(Op.PRINT, [], toSrc(scope, seg.span));
        break;
      case 'Divert': {
        const terminated = emitDivert(ctx, em, seg, scope);
        if (terminated) return true;
        break;
      }
      case 'TunnelReturn':
        em.emit(Op.TUNNEL_RETURN, [], toSrc(scope, seg.span));
        return true;
      case 'InlineConditional': {
        const cond = ctx.fold(seg.condition);
        if (ctx.optimize && isLiteral(cond)) {
          // Dead-branch pruning (F409): emit only the taken branch.
          const taken = literalTruthy(cond.value) ? seg.thenBranch : seg.elseBranch;
          if (taken !== undefined) lowerSegments(ctx, em, taken.segments, scope);
          break;
        }
        lowerExpr(ctx, em, cond, scope);
        const jf = em.emit(Op.JUMP_IF_FALSE, [0], toSrc(scope, seg.span));
        lowerSegments(ctx, em, seg.thenBranch.segments, scope);
        if (seg.elseBranch !== undefined) {
          const j = em.emit(Op.JUMP, [0], null);
          em.patchArg(jf, 0, em.length);
          lowerSegments(ctx, em, seg.elseBranch.segments, scope);
          em.patchArg(j, 0, em.length);
        } else {
          em.patchArg(jf, 0, em.length);
        }
        break;
      }
      case 'Alternative': {
        const id = ctx.altCount++;
        const flavor = ALT_FLAVOR[seg.flavor];
        const alt = em.emit(
          Op.ALT,
          [id, flavor],
          toSrc(scope, seg.span),
          seg.branches.map(() => 0),
        );
        const jumps: number[] = [];
        seg.branches.forEach((branch, bi) => {
          em.patchList(alt, bi, em.length);
          lowerSegments(ctx, em, branch.segments, scope);
          jumps.push(em.emit(Op.JUMP, [0], null));
        });
        for (const j of jumps) em.patchArg(j, 0, em.length);
        break;
      }
      case 'EntityRef': {
        if (seg.name === 'journal' && seg.displayName !== undefined) {
          // `@journal(entry text)` — knowledge effect (F483).
          ctx.binding({ kind: 'journal', name: seg.displayName });
          em.emit(Op.PUSH_CONST, [ctx.literalConst(seg.displayName)], toSrc(scope, seg.span));
          em.emit(Op.EFFECT, [EFFECT_IDS.get('JOURNAL') as number, 1], toSrc(scope, seg.span));
          em.emit(Op.POP, [], null);
          break;
        }
        ctx.binding({ kind: 'entity', name: seg.displayName ?? seg.name, ...(seg.field !== undefined ? { field: seg.field } : {}) });
        if (seg.field !== undefined) {
          em.emit(Op.ENTITY_READ, [ctx.str(seg.displayName ?? seg.name), ctx.str(seg.field) + 1], toSrc(scope, seg.span));
          em.emit(Op.PRINT, [], null);
        } else {
          em.emit(
            Op.ENTITY_PRINT,
            [ctx.str(seg.name), seg.displayName !== undefined ? ctx.str(seg.displayName) + 1 : 0],
            toSrc(scope, seg.span),
          );
        }
        break;
      }
      case 'NoteRef':
        ctx.binding({ kind: 'note', name: seg.title });
        em.emit(Op.NOTE_PRINT, [ctx.str(seg.title)], toSrc(scope, seg.span));
        break;
    }
  }
  return false;
}

function literalTruthy(v: boolean | number | string): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return v.length > 0;
}

function emitTags(ctx: Ctx, em: Emit, tags: readonly TagNode[], scope: Scope): void {
  for (const tag of tags) em.emit(Op.TAG, [ctx.str(tag.text)], toSrc(scope, tag.span));
}

// ── diverts & tunnels (F406/F426) ────────────────────────────────────────────

function lookupTarget(ctx: Ctx, path: readonly string[], scope: Scope): number | undefined {
  const joined = path.join('.');
  const direct = ctx.targets.get(joined);
  if (direct !== undefined) return direct;
  if (scope.knot !== '') {
    const inKnot = ctx.targets.get(`${scope.knot}.${joined}`);
    if (inKnot !== undefined) return inKnot;
    if (scope.containerPath !== scope.knot) {
      const inStitch = ctx.targets.get(`${scope.containerPath}.${joined}`);
      if (inStitch !== undefined) return inStitch;
    }
  }
  return undefined;
}

/** Emit a divert/tunnel. Returns true when flow cannot continue past it. */
function emitDivert(ctx: Ctx, em: Emit, node: DivertNode, scope: Scope): boolean {
  const span = toSrc(scope, node.span);
  const joined = node.targetPath.join('.');
  if (node.targetPath.length === 1 && (joined === 'END' || joined === 'DONE')) {
    em.emit(joined === 'END' ? Op.END_STORY : Op.DONE, [], span);
    return true;
  }
  const target = lookupTarget(ctx, node.targetPath, scope);
  if (target !== undefined) {
    if (node.tunnel) {
      em.emit(Op.TUNNEL, [target], span);
      return false; // flow resumes after `->->`
    }
    em.emit(Op.DIVERT, [target], span);
    return true;
  }
  // Divert-targets-as-values (F459): `-> some_variable`.
  if (node.targetPath.length === 1) {
    const name = node.targetPath[0] as string;
    const temp = ctx.tempSlot(scope, name, false);
    const global = ctx.globals.get(name);
    if (temp !== undefined || global !== undefined) {
      if (node.tunnel) {
        throw new LoweringError(`tunnel target "${name}" cannot be a variable`, node.span, scope.fileName);
      }
      if (temp !== undefined) em.emit(Op.LOAD_TEMP, [temp], span);
      else em.emit(Op.LOAD_GLOBAL, [(global as { index: number }).index], span);
      em.emit(Op.DIVERT_DYN, [], span);
      return true;
    }
  }
  throw new LoweringError(`unknown divert target "${joined}"`, node.span, scope.fileName);
}

// ── statements (F422) ────────────────────────────────────────────────────────

function lowerStmt(ctx: Ctx, em: Emit, stmt: StmtNode, scope: Scope): void {
  const span = toSrc(scope, stmt.span);
  switch (stmt.kind) {
    case 'TempDecl': {
      const slot = ctx.tempSlot(scope, stmt.name.name, true) as number;
      lowerExpr(ctx, em, ctx.fold(stmt.init), scope);
      em.emit(Op.STORE_TEMP, [slot], span);
      break;
    }
    case 'Assign': {
      const name = stmt.target.name;
      lowerExpr(ctx, em, ctx.fold(stmt.value), scope);
      const temp = ctx.tempSlot(scope, name, false);
      if (temp !== undefined) {
        em.emit(Op.STORE_TEMP, [temp], span);
        break;
      }
      const global = ctx.globals.get(name);
      if (global !== undefined) {
        if (global.declKind === 'CONST') {
          throw new LoweringError(`cannot assign to constant "${name}"`, stmt.span, scope.fileName);
        }
        em.emit(Op.STORE_GLOBAL, [global.index], span);
        break;
      }
      throw new LoweringError(`cannot assign to unknown variable "${name}"`, stmt.span, scope.fileName);
    }
    case 'ExprStmt':
      lowerExpr(ctx, em, ctx.fold(stmt.expr), scope);
      em.emit(Op.POP, [], span);
      break;
  }
}

// ── expressions (F404/F423) ──────────────────────────────────────────────────

const BINARY_OPS: Record<string, Op> = {
  '+': Op.ADD,
  '-': Op.SUB,
  '*': Op.MUL,
  '/': Op.DIV,
  '%': Op.MOD,
  '==': Op.EQ,
  '!=': Op.NEQ,
  '<': Op.LT,
  '<=': Op.LTE,
  '>': Op.GT,
  '>=': Op.GTE,
  '&&': Op.AND,
  '||': Op.OR,
  has: Op.HAS,
  hasnt: Op.HASNT,
};

function lowerExpr(ctx: Ctx, em: Emit, expr: ExprNode, scope: Scope): void {
  const span = toSrc(scope, expr.span);
  switch (expr.kind) {
    case 'Literal':
      em.emit(Op.PUSH_CONST, [ctx.literalConst(expr.value)], span);
      break;
    case 'ListLit':
      for (const el of expr.elements) lowerExpr(ctx, em, ctx.fold(el), scope);
      em.emit(Op.LIST_NEW, [expr.elements.length], span);
      break;
    case 'VarRef': {
      if (expr.path.length === 1) {
        const name = expr.path[0] as string;
        if (ctx.optimize) {
          const c = ctx.constGlobals.get(name);
          if (c !== undefined) {
            em.emit(Op.PUSH_CONST, [ctx.literalConst(c.value)], span);
            break;
          }
        }
        const temp = ctx.tempSlot(scope, name, false);
        if (temp !== undefined) {
          em.emit(Op.LOAD_TEMP, [temp], span);
          break;
        }
        const global = ctx.globals.get(name);
        if (global !== undefined) {
          em.emit(Op.LOAD_GLOBAL, [global.index], span);
          break;
        }
      }
      {
        const target = lookupTarget(ctx, expr.path, scope);
        if (target !== undefined) {
          em.emit(Op.LOAD_VISITS, [target], span); // read counts (F442)
          break;
        }
      }
      // Host-injected external state, resolved at runtime (F443).
      em.emit(Op.LOAD_DYNAMIC, [ctx.str(expr.path.join('.'))], span);
      break;
    }
    case 'Unary':
      lowerExpr(ctx, em, expr.operand, scope);
      em.emit(expr.op === '-' ? Op.NEG : Op.NOT, [], span);
      break;
    case 'Binary': {
      lowerExpr(ctx, em, expr.left, scope);
      lowerExpr(ctx, em, expr.right, scope);
      const op = BINARY_OPS[expr.op];
      if (op === undefined) throw new LoweringError(`unsupported operator "${expr.op}"`, expr.span, scope.fileName);
      em.emit(op, [], span);
      break;
    }
    case 'Ternary': {
      lowerExpr(ctx, em, expr.condition, scope);
      const jf = em.emit(Op.JUMP_IF_FALSE, [0], span);
      lowerExpr(ctx, em, expr.whenTrue, scope);
      const j = em.emit(Op.JUMP, [0], null);
      em.patchArg(jf, 0, em.length);
      lowerExpr(ctx, em, expr.whenFalse, scope);
      em.patchArg(j, 0, em.length);
      break;
    }
    case 'Call': {
      const name = expr.callee.name;
      if (name === 'TURNS' && expr.args.length === 0) {
        em.emit(Op.TURNS, [], span);
        break;
      }
      for (const arg of expr.args) lowerExpr(ctx, em, ctx.fold(arg), scope);
      const builtin = BUILTIN_IDS.get(name);
      if (builtin !== undefined) {
        em.emit(Op.CALL_BUILTIN, [builtin, expr.args.length], span);
        break;
      }
      const effect = EFFECT_IDS.get(name);
      if (effect !== undefined) {
        if (name === 'JOURNAL') ctx.binding({ kind: 'journal', name: 'JOURNAL' });
        if (name === 'ENTITY_SET' && expr.args[0]?.kind === 'Literal') {
          const target = expr.args[0].value;
          if (typeof target === 'string') ctx.binding({ kind: 'entity', name: target });
        }
        em.emit(Op.EFFECT, [effect, expr.args.length], span);
        break;
      }
      // External host function (F481) — sandboxed by the runtime registry.
      em.emit(Op.CALL_HOST, [ctx.str(name), expr.args.length], span);
      break;
    }
    case 'EntityRef': {
      ctx.binding({
        kind: 'entity',
        name: expr.displayName ?? expr.name,
        ...(expr.field !== undefined ? { field: expr.field } : {}),
      });
      em.emit(
        Op.ENTITY_READ,
        [ctx.str(expr.displayName ?? expr.name), expr.field !== undefined ? ctx.str(expr.field) + 1 : 0],
        span,
      );
      break;
    }
    case 'ErrorExpr':
      // Parser error recovery placeholder — keep the stack shape sane.
      em.emit(Op.PUSH_CONST, [ctx.literalConst(false)], span);
      break;
  }
}
