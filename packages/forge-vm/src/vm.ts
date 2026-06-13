/**
 * The Forge story VM (F431–F440): a fetch/decode/execute loop over the IR
 * instruction stream, with an output buffer that resolves glue, lazy choice
 * presentation, a tunnel call stack, seeded randomness, host effects, and
 * fully serializable state. See `index.ts` for the public API overview.
 */

import { deserializeProgram, programFingerprint } from './bytecode.js';
import type { AuditEntry, ExternalFunction, StoryHost, VariableObserver } from './host.js';
import type { IrContainer, IrProgram, SrcSpan } from './ir.js';
import { CHOICE_FLAG_FALLBACK, CHOICE_FLAG_STICKY, Op } from './ir.js';
import { normalizeSeed, prngInt, prngPermutation } from './prng.js';
import type { BuiltinContext } from './stdlib.js';
import { BUILTINS, EFFECTS } from './stdlib.js';
import type {
  HistoryEntry,
  MigrationReport,
  SavedFrame,
  StorySaveState,
  TranscriptEntry,
} from './state.js';
import { STATE_VERSION, SaveError, validateSaveShape } from './state.js';
import type { Value } from './values.js';
import {
  asNumber,
  errorValue,
  isDivert,
  isErrorValue,
  isList,
  isTruthy,
  makeList,
  valueEquals,
  valueFromJson,
  valueToJson,
  valueToString,
} from './values.js';

// ── errors (F437) ────────────────────────────────────────────────────────────

export interface RuntimeLocation {
  readonly container: string;
  readonly ip: number;
  readonly file?: string;
  readonly line?: number;
  readonly col?: number;
}

/** A runtime error, mapped back to source via the bytecode source map (F437). */
export class ForgeRuntimeError extends Error {
  constructor(
    message: string,
    readonly location: RuntimeLocation | undefined,
    readonly callStack: readonly string[],
  ) {
    super(
      location?.line !== undefined
        ? `${message} (at ${location.file ?? '?'}:${location.line}:${location.col ?? 0}, in ${location.container})`
        : message,
    );
    this.name = 'ForgeRuntimeError';
  }
}

// ── public option/result types ───────────────────────────────────────────────

export interface StoryOptions {
  /** PRNG seed — identical seeds + choices replay identically (F471/F477). */
  readonly seed?: number | string;
  readonly host?: StoryHost;
  /** External functions, allowlisted by name (F481/F485). */
  readonly functions?: Readonly<Record<string, ExternalFunction>>;
  /** Read-only external state injection (F443). */
  readonly externalState?: Readonly<Record<string, Value>> | ((name: string) => Value | undefined);
  /** Step budget per continue() against runaway loops (F438). Default 1e6. */
  readonly maxSteps?: number;
  /** Tunnel call-stack depth limit (F436). Default 64. */
  readonly maxCallDepth?: number;
}

export interface ChoiceView {
  readonly index: number;
  readonly text: string;
  readonly tags: readonly string[];
  readonly sticky: boolean;
  /** Container name of the choice body (label when the choice is labeled). */
  readonly target: string;
}

export type StoryStatus = 'running' | 'choices' | 'done';

export interface InspectorFrame {
  readonly container: string;
  readonly ip: number;
  readonly kind: 'flow' | 'tunnel' | 'eval';
  readonly source: { file: string; line: number; col: number } | null;
}

/** State-inspector snapshot (F495). */
export interface InspectorState {
  readonly status: StoryStatus;
  readonly turn: number;
  readonly seed: number;
  readonly prng: number;
  readonly variables: readonly { name: string; declKind: 'VAR' | 'CONST'; value: Value }[];
  readonly temps: readonly { slot: number; name: string; value: Value }[];
  readonly visits: Readonly<Record<string, number>>;
  readonly callStack: readonly InspectorFrame[];
  readonly choiceCount: number;
}

// ── internals ────────────────────────────────────────────────────────────────

interface Frame {
  container: number;
  ip: number;
  kind: 'flow' | 'tunnel' | 'eval';
  temps: Value[] | null;
}

interface PendingChoice {
  flags: number;
  /** Condition container index + 1; 0 = none. */
  cond: number;
  text: number;
  body: number;
}

interface InternalChoiceView extends ChoiceView {
  readonly bodyIndex: number;
}

const DEFAULT_MAX_STEPS = 1_000_000;
const DEFAULT_MAX_CALL_DEPTH = 64;

/**
 * Create a running story from compiled bytecode (or a decoded IR program).
 * See the API overview in `index.ts` (F439).
 */
export function createStory(input: Uint8Array | IrProgram, options: StoryOptions = {}): Story {
  const program = input instanceof Uint8Array ? deserializeProgram(input) : input;
  return new Story(program, options);
}

export class Story {
  readonly program: IrProgram;
  private readonly fingerprint: string;
  private readonly options: StoryOptions;
  private readonly host: StoryHost;
  private readonly functions = new Map<string, ExternalFunction>();
  private readonly observers = new Map<string, Set<VariableObserver>>();
  private readonly globalIndex = new Map<string, number>();
  private readonly containerByName = new Map<string, number>();

  // ── mutable run state ──
  private globals: Value[] = [];
  private visitCounts: number[] = [];
  private alts = new Map<number, { count: number; deck: number[] }>();
  private seed: number;
  private prng: number;
  private turn = 0;
  private history: HistoryEntry[] = [];
  private transcriptLog: TranscriptEntry[] = [];
  private audit: AuditEntry[] = [];
  private frames: Frame[] = [];
  private stack: Value[] = [];
  private pending: PendingChoice[] = [];
  private views: InternalChoiceView[] | null = null;
  private statusValue: StoryStatus = 'running';
  private lineBuf: string[] = [];
  private glue = false;
  private lineTags: string[] = [];
  private chunkLines: string[] = [];
  private chunkTags: string[] = [];
  private stepsUsed = 0;
  private evalDepth = 0;
  private pendingAsync: Promise<Value> | null = null;

  constructor(program: IrProgram, options: StoryOptions = {}) {
    this.program = program;
    this.options = options;
    this.host = options.host ?? {};
    this.fingerprint = programFingerprint(program);
    for (const [name, fn] of Object.entries(options.functions ?? {})) this.functions.set(name, fn);
    program.globals.forEach((g, i) => this.globalIndex.set(g.name, i));
    program.containers.forEach((c) => this.containerByName.set(c.name, c.index));
    this.seed = normalizeSeed(options.seed);
    this.prng = this.seed;
    this.bootstrap();
  }

  /** (Re)initialize globals and flow position. */
  private bootstrap(): void {
    this.prng = this.seed;
    this.globals = [];
    this.visitCounts = new Array<number>(this.program.containers.length).fill(0);
    this.alts = new Map();
    this.turn = 0;
    this.history = [];
    this.transcriptLog = [];
    this.audit = [];
    this.stack = [];
    this.pending = [];
    this.views = null;
    this.lineBuf = [];
    this.glue = false;
    this.lineTags = [];
    this.statusValue = 'running';
    this.frames = [
      {
        container: this.program.entryContainer,
        ip: 0,
        kind: 'flow',
        temps: new Array<Value>(Math.max(1, this.program.maxTempSlots)).fill(false),
      },
    ];
    for (let i = 0; i < this.program.globals.length; i++) {
      const g = this.program.globals[i] as IrProgram['globals'][number];
      let v = this.evalContainer(g.initContainer);
      if (isList(v) && v.origin === undefined) v = makeList(v.items, g.name);
      this.globals[i] = v;
    }
  }

  // ── public surface (F439) ──────────────────────────────────────────────────

  get status(): StoryStatus {
    return this.statusValue;
  }

  get canContinue(): boolean {
    return this.statusValue === 'running';
  }

  get currentTurn(): number {
    return this.turn;
  }

  /** Tags attached to the lines produced by the most recent continue(). */
  get currentTags(): readonly string[] {
    return this.chunkTags;
  }

  /** Run until the next choice point or the end (F433). Returns the text produced. */
  continue(): string {
    this.beginChunk();
    this.runUntilStop();
    if (this.pendingAsync !== null) {
      this.pendingAsync.catch(() => undefined); // avoid an unhandled rejection
      this.pendingAsync = null;
      this.throwError('an async external function was called; drive this story with continueAsync()');
    }
    return this.chunkText();
  }

  /** Like continue(), but awaits suspended async external functions (F486). */
  async continueAsync(): Promise<string> {
    this.beginChunk();
    for (;;) {
      this.runUntilStop();
      if (this.pendingAsync === null) break;
      const promise = this.pendingAsync;
      this.pendingAsync = null;
      let result: Value;
      try {
        result = await promise;
      } catch (e) {
        result = errorValue(e instanceof Error ? e.message : String(e));
      }
      this.stack.push(result);
    }
    return this.chunkText();
  }

  /** Choices available at the current choice point (F434). */
  choices(): readonly ChoiceView[] {
    return this.views ?? [];
  }

  /** Take a choice by presented index and resume flow (F435). */
  choose(index: number): void {
    if (this.views === null) throw new Error('no choices are currently available');
    const view = this.views[index];
    if (view === undefined) {
      throw new Error(`choice index ${index} out of range (0..${this.views.length - 1})`);
    }
    this.history.push({ turn: this.turn, index, text: view.text });
    this.turn++;
    this.transcriptLog.push({ kind: 'choice', text: view.text });
    const frame = this.frames[this.frames.length - 1] as Frame;
    frame.container = view.bodyIndex;
    frame.ip = 0;
    this.pending = [];
    this.views = null;
    this.statusValue = 'running';
  }

  /** Alias matching the classic ink-style API name. */
  chooseIndex(index: number): void {
    this.choose(index);
  }

  // ── host & observation ─────────────────────────────────────────────────────

  /** Register an external function at runtime (F481). */
  registerFunction(name: string, fn: ExternalFunction): void {
    this.functions.set(name, fn);
  }

  /** Observe a global variable; returns an unsubscribe function (F444). */
  observeVariable(name: string, observer: VariableObserver): () => void {
    let set = this.observers.get(name);
    if (set === undefined) {
      set = new Set();
      this.observers.set(name, set);
    }
    set.add(observer);
    return () => {
      this.observers.get(name)?.delete(observer);
    };
  }

  getVariable(name: string): Value | undefined {
    const idx = this.globalIndex.get(name);
    return idx === undefined ? undefined : this.globals[idx];
  }

  /** Host-side write to a global (fires observers). */
  setVariable(name: string, value: Value): void {
    const idx = this.globalIndex.get(name);
    if (idx === undefined) throw new Error(`unknown global "${name}"`);
    this.storeGlobal(idx, value);
  }

  /** Visit count for a knot/stitch/label by name (F442). */
  visits(name: string): number {
    const idx = this.containerByName.get(name);
    return idx === undefined ? 0 : (this.visitCounts[idx] ?? 0);
  }

  /** Per-playthrough effect/function audit log (F487). */
  auditLog(): readonly AuditEntry[] {
    return this.audit;
  }

  /** Full transcript: every text line and chosen option, in order (F466). */
  transcript(): readonly TranscriptEntry[] {
    return this.transcriptLog;
  }

  /** Transcript as plain text, choices marked with `>` (F466). */
  exportTranscript(): string {
    return this.transcriptLog.map((t) => (t.kind === 'choice' ? `> ${t.text}` : t.text)).join('\n');
  }

  choiceHistory(): readonly HistoryEntry[] {
    return this.history;
  }

  // ── state save/load (F448/F449) ────────────────────────────────────────────

  saveState(): StorySaveState {
    const globals: Record<string, ReturnType<typeof valueToJson>> = {};
    this.program.globals.forEach((g, i) => {
      globals[g.name] = valueToJson(this.globals[i] as Value);
    });
    const visits: Record<string, number> = {};
    this.program.containers.forEach((c, i) => {
      const n = this.visitCounts[i] ?? 0;
      if (n > 0) visits[c.name] = n;
    });
    const alts: Record<string, { count: number; deck: number[] }> = {};
    for (const [id, a] of this.alts) alts[String(id)] = { count: a.count, deck: [...a.deck] };
    return {
      stateVersion: STATE_VERSION,
      bytecode: this.fingerprint,
      seed: this.seed,
      prng: this.prng,
      turn: this.turn,
      status: this.statusValue,
      history: [...this.history],
      globals,
      visits,
      alts,
      frames: this.frames
        .filter((f): f is Frame & { kind: 'flow' | 'tunnel' } => f.kind !== 'eval')
        .map((f) => ({
          container: (this.program.containers[f.container] as IrContainer).name,
          ip: f.ip,
          kind: f.kind,
          temps: f.temps === null ? null : f.temps.map(valueToJson),
        })),
      stack: this.stack.map(valueToJson),
      pending: this.pending.map((p) => ({
        flags: p.flags,
        cond: p.cond === 0 ? '' : (this.program.containers[p.cond - 1] as IrContainer).name,
        text: (this.program.containers[p.text] as IrContainer).name,
        body: (this.program.containers[p.body] as IrContainer).name,
      })),
      choiceViews: (this.views ?? []).map((v) => ({
        index: v.index,
        text: v.text,
        tags: [...v.tags],
        sticky: v.sticky,
        body: v.target,
      })),
      lineBuf: this.lineBuf.join(''),
      glue: this.glue,
      lineTags: [...this.lineTags],
      transcript: [...this.transcriptLog],
    };
  }

  /**
   * Restore a saved state. When the save was made against different bytecode,
   * pass `{ migrate: true }` for best-effort migration (F465) — globals and
   * visit counts carry over by name and flow restarts at the entry point.
   */
  loadState(state: unknown, options: { migrate?: boolean } = {}): MigrationReport | null {
    validateSaveShape(state);
    if (state.bytecode !== this.fingerprint) {
      if (options.migrate !== true) {
        throw new SaveError(
          `save was created against different bytecode (${state.bytecode} != ${this.fingerprint}); ` +
            'recompile-safe loading requires { migrate: true }',
        );
      }
      return this.migrateState(state);
    }

    const resolve = (name: string): number => {
      const idx = this.containerByName.get(name);
      if (idx === undefined) throw new SaveError(`save references unknown container "${name}"`);
      return idx;
    };
    this.bootstrap();
    this.seed = state.seed;
    this.prng = state.prng;
    this.turn = state.turn;
    this.history = [...state.history];
    this.transcriptLog = [...state.transcript];
    for (const [name, json] of Object.entries(state.globals)) {
      const idx = this.globalIndex.get(name);
      if (idx === undefined) throw new SaveError(`save references unknown global "${name}"`);
      this.globals[idx] = valueFromJson(json, resolve);
    }
    this.visitCounts.fill(0);
    for (const [name, count] of Object.entries(state.visits)) this.visitCounts[resolve(name)] = count;
    this.alts = new Map();
    for (const [id, a] of Object.entries(state.alts)) {
      this.alts.set(Number(id), { count: a.count, deck: [...a.deck] });
    }
    this.frames = state.frames.map((f: SavedFrame) => ({
      container: resolve(f.container),
      ip: f.ip,
      kind: f.kind,
      temps: f.temps === null ? null : f.temps.map((t) => valueFromJson(t, resolve)),
    }));
    if (this.frames.length === 0) throw new SaveError('save has no flow frames');
    this.stack = state.stack.map((v) => valueFromJson(v, resolve));
    this.pending = state.pending.map((p) => ({
      flags: p.flags,
      cond: p.cond === '' ? 0 : resolve(p.cond) + 1,
      text: resolve(p.text),
      body: resolve(p.body),
    }));
    this.views =
      state.status === 'choices'
        ? state.choiceViews.map((v) => ({
            index: v.index,
            text: v.text,
            tags: [...v.tags],
            sticky: v.sticky,
            target: v.body,
            bodyIndex: resolve(v.body),
          }))
        : null;
    this.statusValue = state.status;
    this.lineBuf = state.lineBuf === '' ? [] : [state.lineBuf];
    this.glue = state.glue;
    this.lineTags = [...state.lineTags];
    return null;
  }

  private migrateState(state: StorySaveState): MigrationReport {
    this.bootstrap();
    this.seed = state.seed;
    this.prng = state.prng;
    this.turn = state.turn;
    this.history = [...state.history];
    this.transcriptLog = [...state.transcript];
    const kept: string[] = [];
    const dropped: string[] = [];
    const lenientResolve = (name: string): number => this.containerByName.get(name) ?? -1;
    for (const [name, json] of Object.entries(state.globals)) {
      const idx = this.globalIndex.get(name);
      if (idx === undefined) {
        dropped.push(name);
        continue;
      }
      const value = valueFromJson(json, lenientResolve);
      if (isDivert(value) && value.container === -1) {
        dropped.push(name);
        continue;
      }
      this.globals[idx] = value;
      kept.push(name);
    }
    let keptVisits = 0;
    let droppedVisits = 0;
    for (const [name, count] of Object.entries(state.visits)) {
      const idx = this.containerByName.get(name);
      if (idx === undefined) droppedVisits++;
      else {
        this.visitCounts[idx] = count;
        keptVisits++;
      }
    }
    return {
      migrated: true,
      keptGlobals: kept,
      droppedGlobals: dropped,
      keptVisits,
      droppedVisits,
      notes: ['flow position reset to the story entry point; alternatives and pending choices were discarded'],
    };
  }

  // ── inspector (F495) ───────────────────────────────────────────────────────

  inspect(): InspectorState {
    const visits: Record<string, number> = {};
    this.program.containers.forEach((c, i) => {
      if (c.visitTracked && (this.visitCounts[i] ?? 0) > 0) visits[c.name] = this.visitCounts[i] as number;
    });
    const tempFrame = this.currentTemps();
    const frame = this.frames[this.frames.length - 1];
    const knot = frame === undefined ? '' : this.knotOf((this.program.containers[frame.container] as IrContainer).name);
    const tempNames = this.program.tempNames[knot === '' ? '<preamble>' : knot] ?? [];
    return {
      status: this.statusValue,
      turn: this.turn,
      seed: this.seed,
      prng: this.prng,
      variables: this.program.globals.map((g, i) => ({
        name: g.name,
        declKind: g.declKind,
        value: this.globals[i] as Value,
      })),
      temps: tempNames.map((name, slot) => ({ slot, name, value: tempFrame[slot] ?? false })),
      visits,
      callStack: this.frames.map((f) => {
        const c = this.program.containers[f.container] as IrContainer;
        const span = this.spanAt(c, Math.max(0, f.ip - 1));
        return {
          container: c.name,
          ip: f.ip,
          kind: f.kind,
          source:
            span === null
              ? null
              : { file: this.program.files[span.file] ?? '?', line: span.line, col: span.col },
        };
      }),
      choiceCount: this.views?.length ?? 0,
    };
  }

  /** Current position (for the debugger): top frame container/ip and source span. */
  position(): { container: string; ip: number; span: SrcSpan | null } {
    const frame = this.frames[this.frames.length - 1] as Frame;
    const c = this.program.containers[frame.container] as IrContainer;
    return { container: c.name, ip: frame.ip, span: c.spans[frame.ip] ?? null };
  }

  // ── execution core (F431) ──────────────────────────────────────────────────

  private beginChunk(): void {
    if (this.statusValue !== 'running') {
      throw new Error(`cannot continue: story status is "${this.statusValue}"`);
    }
    this.chunkLines = [];
    this.chunkTags = [];
    this.stepsUsed = 0;
  }

  private chunkText(): string {
    const lines = this.chunkLines;
    return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
  }

  private runUntilStop(): void {
    const maxSteps = this.options.maxSteps ?? DEFAULT_MAX_STEPS;
    while (this.statusValue === 'running' && this.pendingAsync === null) {
      if (this.stepsUsed >= maxSteps) {
        this.throwError(`step budget exceeded (${maxSteps} instructions) — possible infinite loop`);
      }
      this.step();
    }
  }

  /** Execute exactly one instruction (debugger granularity, F491). */
  stepInstruction(): void {
    if (this.statusValue === 'running' && this.pendingAsync === null) {
      this.stepsUsed = 0;
      this.step();
    }
  }

  private step(): void {
    this.stepsUsed++;
    const frame = this.frames[this.frames.length - 1];
    if (frame === undefined) {
      this.statusValue = 'done';
      return;
    }
    const container = this.program.containers[frame.container];
    if (container === undefined) this.throwError(`dangling container #${frame.container}`);
    if (frame.ip >= container.instrs.length) {
      this.throwError(`flow ran off the end of "${container.name}"`);
    }
    const instr = container.instrs[frame.ip] as IrContainer['instrs'][number];
    frame.ip++;
    const a = (instr.args[0] ?? 0) as number;
    const b = (instr.args[1] ?? 0) as number;

    switch (instr.op) {
      case Op.NOP:
        break;
      case Op.PUSH_CONST: {
        const c = this.program.consts[a];
        if (c === undefined) this.throwError(`bad constant #${a}`);
        if (c.kind === 'number') this.stack.push(c.value);
        else if (c.kind === 'bool') this.stack.push(c.value);
        else if (c.kind === 'string') this.stack.push(this.program.strings[c.value] ?? '');
        else {
          this.stack.push({
            kind: 'divert',
            container: c.value,
            name: (this.program.containers[c.value] as IrContainer).name,
          });
        }
        break;
      }
      case Op.POP:
        this.stack.pop();
        break;

      // ── arithmetic & logic (F423) ──
      case Op.ADD:
      case Op.SUB:
      case Op.MUL:
      case Op.DIV:
      case Op.MOD:
      case Op.EQ:
      case Op.NEQ:
      case Op.LT:
      case Op.LTE:
      case Op.GT:
      case Op.GTE:
      case Op.AND:
      case Op.OR:
      case Op.HAS:
      case Op.HASNT: {
        const right = this.pop();
        const left = this.pop();
        this.stack.push(this.binaryOp(instr.op, left, right));
        break;
      }
      case Op.NEG: {
        const v = this.pop();
        const n = asNumber(v);
        this.stack.push(n === null ? (isErrorValue(v) ? v : errorValue('cannot negate a non-number')) : -n);
        break;
      }
      case Op.NOT:
        this.stack.push(!isTruthy(this.pop()));
        break;
      case Op.LIST_NEW: {
        const items: Value[] = [];
        for (let i = 0; i < a; i++) items.unshift(this.pop());
        this.stack.push(makeList(items));
        break;
      }

      // ── variables (F441) ──
      case Op.LOAD_GLOBAL:
        this.stack.push(this.globals[a] ?? false);
        break;
      case Op.STORE_GLOBAL:
        this.storeGlobal(a, this.pop());
        break;
      case Op.LOAD_TEMP:
        this.stack.push(this.currentTemps()[a] ?? false);
        break;
      case Op.STORE_TEMP:
        this.currentTemps()[a] = this.pop();
        break;
      case Op.LOAD_DYNAMIC: {
        const name = this.program.strings[a] ?? '';
        const v = this.lookupExternal(name);
        if (v === undefined) this.throwError(`unknown variable "${name}"`);
        this.stack.push(v);
        break;
      }
      case Op.LOAD_VISITS:
        this.stack.push(this.visitCounts[a] ?? 0);
        break;
      case Op.TURNS:
        this.stack.push(this.turn);
        break;

      // ── output (F432/F446) ──
      case Op.TEXT:
        this.append(this.program.strings[a] ?? '');
        break;
      case Op.PRINT:
        this.append(valueToString(this.pop()));
        break;
      case Op.NEWLINE:
        this.endLine();
        break;
      case Op.GLUE:
        this.glue = true;
        break;
      case Op.TAG:
        this.lineTags.push(this.program.strings[a] ?? '');
        break;

      // ── intra-container flow ──
      case Op.JUMP:
        frame.ip = a;
        break;
      case Op.JUMP_IF_FALSE:
        if (!isTruthy(this.pop())) frame.ip = a;
        break;
      case Op.ALT: {
        const branches = instr.list ?? [];
        const n = branches.length;
        if (n === 0) break;
        let alt = this.alts.get(a);
        if (alt === undefined) {
          alt = { count: 0, deck: [] };
          this.alts.set(a, alt);
        }
        let index: number;
        if (b === 1) {
          index = alt.count % n; // cycle
        } else if (b === 2) {
          // shuffle (F473): draw without replacement from a PRNG-shuffled deck
          if (alt.deck.length === 0) {
            const perm = prngPermutation(this.prng, n);
            this.prng = perm.state;
            alt.deck = perm.order;
          }
          index = alt.deck.shift() as number;
        } else {
          index = Math.min(alt.count, n - 1); // sequence
        }
        alt.count++;
        frame.ip = branches[index] as number;
        break;
      }

      // ── inter-container flow (F426/F436) ──
      case Op.DIVERT:
        this.divertTo(a);
        break;
      case Op.DIVERT_DYN: {
        const v = this.pop();
        if (isDivert(v)) this.divertTo(v.container);
        else if (isErrorValue(v)) this.throwError(`cannot divert: ${v.message}`);
        else this.throwError(`cannot divert to a ${typeof v === 'object' ? v.kind : typeof v} value`);
        break;
      }
      case Op.TUNNEL: {
        const depth = this.frames.filter((f) => f.kind === 'tunnel').length;
        const limit = this.options.maxCallDepth ?? DEFAULT_MAX_CALL_DEPTH;
        if (depth + 1 >= limit) {
          this.throwError(`tunnel call stack overflow (depth limit ${limit})`);
        }
        this.frames.push({
          container: a,
          ip: 0,
          kind: 'tunnel',
          temps: new Array<Value>(Math.max(1, this.program.maxTempSlots)).fill(false),
        });
        break;
      }
      case Op.TUNNEL_RETURN: {
        const top = this.frames[this.frames.length - 1] as Frame;
        if (top.kind !== 'tunnel') this.throwError('"->->" outside of a tunnel');
        this.frames.pop();
        break;
      }
      case Op.END_STORY:
      case Op.DONE:
        this.requireFlow(instr.op === Op.END_STORY ? '-> END' : '-> DONE');
        this.flushPartialLine();
        this.statusValue = 'done';
        break;
      case Op.RET: {
        const top = this.frames[this.frames.length - 1] as Frame;
        if (top.kind !== 'eval') this.throwError('RET outside of an expression container');
        this.frames.pop();
        break;
      }

      // ── choices (F434/F435/F451–F454) ──
      case Op.CHOICE:
        this.pending.push({
          flags: a,
          cond: b,
          text: instr.args[2] as number,
          body: instr.args[3] as number,
        });
        break;
      case Op.PRESENT:
        this.present();
        break;

      // ── instrumentation & host (F429/F481–F488) ──
      case Op.VISIT:
        this.visitCounts[a] = (this.visitCounts[a] ?? 0) + 1;
        break;
      case Op.ENTITY_PRINT: {
        const name = this.program.strings[a] ?? '';
        const display = b === 0 ? undefined : this.program.strings[b - 1];
        let text: string;
        try {
          text =
            this.host.resolveEntityDisplay !== undefined
              ? this.host.resolveEntityDisplay(name, display)
              : (display ?? name);
        } catch (e) {
          text = display ?? name;
          this.auditEntry('entity-read', name, [], false, e);
        }
        this.append(text);
        break;
      }
      case Op.ENTITY_READ: {
        const name = this.program.strings[a] ?? '';
        const field = b === 0 ? undefined : this.program.strings[b - 1];
        if (this.host.readEntityField === undefined) {
          this.stack.push(errorValue(`no host binding for @${name}${field !== undefined ? `.${field}` : ''}`));
          break;
        }
        try {
          this.stack.push(this.host.readEntityField(name, field));
        } catch (e) {
          this.stack.push(errorValue(e instanceof Error ? e.message : String(e)));
          this.auditEntry('entity-read', name, field !== undefined ? [field] : [], false, e);
        }
        break;
      }
      case Op.NOTE_PRINT: {
        const title = this.program.strings[a] ?? '';
        let text = title;
        if (this.host.resolveNote !== undefined) {
          try {
            text = this.host.resolveNote(title);
          } catch {
            text = title;
          }
        }
        this.append(text);
        break;
      }
      case Op.EFFECT: {
        const entry = EFFECTS[a];
        const args: Value[] = [];
        for (let i = 0; i < b; i++) args.unshift(this.pop());
        const name = entry?.name ?? `effect#${a}`;
        if (this.host.onEffect === undefined) {
          this.auditEntry('effect', name, args.map(valueToString), true);
          this.stack.push(true);
          break;
        }
        try {
          this.host.onEffect(name, args);
          this.auditEntry('effect', name, args.map(valueToString), true);
          this.stack.push(true);
        } catch (e) {
          // F488: effect failure becomes a story-visible error value.
          this.auditEntry('effect', name, args.map(valueToString), false, e);
          this.stack.push(errorValue(e instanceof Error ? e.message : String(e)));
        }
        break;
      }
      case Op.CALL_BUILTIN: {
        const entry = BUILTINS[a];
        const args: Value[] = [];
        for (let i = 0; i < b; i++) args.unshift(this.pop());
        if (entry === undefined) {
          this.stack.push(errorValue(`unknown builtin #${a}`));
          break;
        }
        if (args.length < entry.minArgs || args.length > entry.maxArgs) {
          this.stack.push(errorValue(`${entry.name} expects ${entry.minArgs}–${entry.maxArgs} arguments`));
          break;
        }
        this.stack.push(entry.impl(this.builtinContext(), args));
        break;
      }
      case Op.CALL_HOST: {
        const name = this.program.strings[a] ?? '';
        const args: Value[] = [];
        for (let i = 0; i < b; i++) args.unshift(this.pop());
        const fn = this.functions.get(name);
        if (fn === undefined) {
          // F485: sandbox — only allowlisted functions are reachable.
          this.auditEntry('function', name, args.map(valueToString), false, new Error('not registered'));
          this.stack.push(errorValue(`external function "${name}" is not registered`));
          break;
        }
        let result: Value | Promise<Value>;
        try {
          result = fn(...args);
        } catch (e) {
          this.auditEntry('function', name, args.map(valueToString), false, e);
          this.stack.push(errorValue(e instanceof Error ? e.message : String(e)));
          break;
        }
        if (result instanceof Promise) {
          if (this.evalDepth > 0) {
            this.throwError(
              `async external function "${name}" cannot be called from a choice condition, choice text, or initializer`,
            );
          }
          // F486: suspend; continueAsync() awaits and resumes after this instruction.
          this.auditEntry('function', name, args.map(valueToString), true);
          this.pendingAsync = result;
          break;
        }
        this.auditEntry('function', name, args.map(valueToString), true);
        this.stack.push(result);
        break;
      }
      default:
        this.throwError(`unimplemented opcode ${instr.op as number}`);
    }
  }

  // ── choice presentation (F434/F451–F454) ──────────────────────────────────

  private present(): void {
    const visible: InternalChoiceView[] = [];
    const fallbacks: PendingChoice[] = [];
    for (const p of this.pending) {
      const sticky = (p.flags & CHOICE_FLAG_STICKY) !== 0;
      if (!sticky && (this.visitCounts[p.body] ?? 0) > 0) continue; // once-only (F451)
      if (p.cond !== 0 && !isTruthy(this.evalContainer(p.cond - 1))) continue; // lazy (F453)
      if ((p.flags & CHOICE_FLAG_FALLBACK) !== 0) {
        fallbacks.push(p);
        continue;
      }
      const { text, tags } = this.evalTextContainer(p.text);
      visible.push({
        index: visible.length,
        text,
        tags,
        sticky,
        target: (this.program.containers[p.body] as IrContainer).name,
        bodyIndex: p.body,
      });
    }
    if (visible.length > 0) {
      this.flushPartialLine();
      this.views = visible;
      this.statusValue = 'choices';
      return;
    }
    if (fallbacks.length > 0) {
      // F454: a fallback is taken silently when nothing is presentable.
      const fb = fallbacks[0] as PendingChoice;
      this.pending = [];
      const frame = this.frames[this.frames.length - 1] as Frame;
      frame.container = fb.body;
      frame.ip = 0;
      return;
    }
    this.throwError('ran out of content: no choices are available and there is no fallback choice');
  }

  // ── evaluation helpers ─────────────────────────────────────────────────────

  private evalContainer(index: number): Value {
    const stackBase = this.stack.length;
    const frameBase = this.frames.length;
    this.frames.push({ container: index, ip: 0, kind: 'eval', temps: null });
    this.evalDepth++;
    const maxSteps = this.options.maxSteps ?? DEFAULT_MAX_STEPS;
    try {
      while (this.frames.length > frameBase) {
        if (this.stepsUsed >= maxSteps) {
          this.throwError(`step budget exceeded (${maxSteps} instructions) — possible infinite loop`);
        }
        this.step();
      }
    } finally {
      this.evalDepth--;
    }
    const value = this.stack.length > stackBase ? (this.stack.pop() as Value) : false;
    this.stack.length = stackBase;
    return value;
  }

  /** Run a choiceText container with output captured (presented text, F457). */
  private evalTextContainer(index: number): { text: string; tags: string[] } {
    const savedLineBuf = this.lineBuf;
    const savedTags = this.lineTags;
    const savedGlue = this.glue;
    const savedChunk = this.chunkLines;
    this.lineBuf = [];
    this.lineTags = [];
    this.glue = false;
    this.chunkLines = [];
    try {
      this.evalContainer(index);
      const pieces = [...this.chunkLines, this.lineBuf.join('')];
      const text = pieces.join(' ').replace(/\s+/g, ' ').trim();
      return { text, tags: this.lineTags };
    } finally {
      this.lineBuf = savedLineBuf;
      this.lineTags = savedTags;
      this.glue = savedGlue;
      this.chunkLines = savedChunk;
    }
  }

  private builtinContext(): BuiltinContext {
    return {
      randInt: (min, max) => {
        const r = prngInt(this.prng, min, max);
        this.prng = r.state;
        return r.value;
      },
      visits: (name) => this.visits(name),
      turns: () => this.turn,
      resolveTarget: (name) => {
        const idx = this.containerByName.get(name);
        return idx === undefined ? null : { container: idx, name };
      },
    };
  }

  private binaryOp(op: Op, left: Value, right: Value): Value {
    if (isErrorValue(left)) return left;
    if (isErrorValue(right)) return right;
    switch (op) {
      case Op.ADD: {
        if (typeof left === 'number' && typeof right === 'number') return left + right;
        if (isList(left)) {
          const items = isList(right) ? right.items : [right];
          const merged = makeList([...left.items, ...items]);
          return left.origin !== undefined ? makeList(merged.items, left.origin) : merged;
        }
        if (typeof left === 'string' || typeof right === 'string') {
          return valueToString(left) + valueToString(right);
        }
        return errorValue('cannot add these values');
      }
      case Op.SUB: {
        if (typeof left === 'number' && typeof right === 'number') return left - right;
        if (isList(left)) {
          const removals = isList(right) ? right.items : [right];
          const items = left.items.filter((i) => !removals.some((r) => valueEquals(i, r)));
          return left.origin !== undefined ? makeList(items, left.origin) : makeList(items);
        }
        return errorValue('cannot subtract these values');
      }
      case Op.MUL: {
        const l = asNumber(left);
        const r = asNumber(right);
        return l === null || r === null ? errorValue('cannot multiply non-numbers') : l * r;
      }
      case Op.DIV: {
        const l = asNumber(left);
        const r = asNumber(right);
        if (l === null || r === null) return errorValue('cannot divide non-numbers');
        return r === 0 ? errorValue('division by zero') : l / r;
      }
      case Op.MOD: {
        const l = asNumber(left);
        const r = asNumber(right);
        if (l === null || r === null) return errorValue('cannot take modulo of non-numbers');
        return r === 0 ? errorValue('modulo by zero') : l % r;
      }
      case Op.EQ:
        return valueEquals(left, right);
      case Op.NEQ:
        return !valueEquals(left, right);
      case Op.LT:
      case Op.LTE:
      case Op.GT:
      case Op.GTE: {
        if (typeof left === 'string' && typeof right === 'string') {
          return this.compareOp(op, left < right ? -1 : left > right ? 1 : 0);
        }
        const l = asNumber(left);
        const r = asNumber(right);
        if (l === null || r === null) return errorValue('cannot compare these values');
        return this.compareOp(op, l < r ? -1 : l > r ? 1 : 0);
      }
      case Op.AND:
        return isTruthy(left) && isTruthy(right);
      case Op.OR:
        return isTruthy(left) || isTruthy(right);
      case Op.HAS:
      case Op.HASNT: {
        let result: boolean;
        if (isList(left)) result = left.items.some((i) => valueEquals(i, right));
        else if (typeof left === 'string') result = left.includes(valueToString(right));
        else return errorValue('"has" expects a list or string on the left');
        return op === Op.HAS ? result : !result;
      }
      default:
        return errorValue('bad binary operator');
    }
  }

  private compareOp(op: Op, cmp: number): boolean {
    switch (op) {
      case Op.LT:
        return cmp < 0;
      case Op.LTE:
        return cmp <= 0;
      case Op.GT:
        return cmp > 0;
      default:
        return cmp >= 0;
    }
  }

  // ── output buffer (F432) ───────────────────────────────────────────────────

  private append(text: string): void {
    if (text.length === 0) return;
    this.lineBuf.push(text);
    if (text.trim().length > 0) this.glue = false;
  }

  private endLine(): void {
    if (this.glue) return; // glue swallows this line break
    this.flushPartialLine();
  }

  private flushPartialLine(): void {
    // Collapse runs of spaces left by bracket splits / empty inline branches.
    const text = this.lineBuf.join('').replace(/[ \t]+/g, ' ').trim();
    this.lineBuf = [];
    const tags = this.lineTags;
    this.lineTags = [];
    if (tags.length > 0) this.chunkTags.push(...tags);
    if (text.length === 0) return; // whitespace-only lines vanish
    this.chunkLines.push(text);
    this.transcriptLog.push({ kind: 'text', text, ...(tags.length > 0 ? { tags } : {}) });
  }

  // ── small helpers ──────────────────────────────────────────────────────────

  private pop(): Value {
    const v = this.stack.pop();
    if (v === undefined) this.throwError('value stack underflow');
    return v;
  }

  private currentTemps(): Value[] {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const t = (this.frames[i] as Frame).temps;
      if (t !== null) return t;
    }
    this.throwError('no temp frame');
  }

  private storeGlobal(index: number, value: Value): void {
    const g = this.program.globals[index];
    let v = value;
    if (g !== undefined && isList(v) && v.origin === undefined) v = makeList(v.items, g.name);
    const previous = this.globals[index];
    this.globals[index] = v;
    if (g !== undefined && (previous === undefined || !valueEquals(previous, v))) {
      const observers = this.observers.get(g.name);
      if (observers !== undefined) {
        for (const cb of observers) cb(g.name, v, previous);
      }
    }
  }

  private lookupExternal(name: string): Value | undefined {
    const ext = this.options.externalState;
    if (ext === undefined) return undefined;
    if (typeof ext === 'function') return ext(name);
    return Object.prototype.hasOwnProperty.call(ext, name) ? ext[name] : undefined;
  }

  private divertTo(container: number): void {
    const frame = this.frames[this.frames.length - 1] as Frame;
    if (frame.kind === 'eval') this.throwError('cannot divert from inside an expression');
    frame.container = container;
    frame.ip = 0;
  }

  private requireFlow(what: string): void {
    const frame = this.frames[this.frames.length - 1] as Frame;
    if (frame.kind === 'eval') this.throwError(`${what} cannot appear inside an expression`);
    // Unwind any tunnel frames: END/DONE finish the whole story.
    this.frames = this.frames.filter((f) => f.kind === 'flow');
    if (this.frames.length === 0) {
      this.frames = [{ container: 0, ip: 0, kind: 'flow', temps: null }];
    }
  }

  private knotOf(containerName: string): string {
    const base = containerName.split('#')[0] ?? containerName;
    return base.split('.')[0] ?? base;
  }

  private spanAt(container: IrContainer, ip: number): SrcSpan | null {
    for (let i = Math.min(ip, container.spans.length - 1); i >= 0; i--) {
      const s = container.spans[i];
      if (s != null) return s;
    }
    return null;
  }

  private auditEntry(kind: AuditEntry['kind'], name: string, args: string[], ok: boolean, error?: unknown): void {
    this.audit.push({
      turn: this.turn,
      kind,
      name,
      args,
      ok,
      ...(error !== undefined ? { error: error instanceof Error ? error.message : String(error) } : {}),
    });
  }

  private throwError(message: string): never {
    const frame = this.frames[this.frames.length - 1];
    let location: RuntimeLocation | undefined;
    if (frame !== undefined) {
      const c = this.program.containers[frame.container];
      if (c !== undefined) {
        const span = this.spanAt(c, Math.max(0, frame.ip - 1));
        location = {
          container: c.name,
          ip: frame.ip,
          ...(span !== null
            ? { file: this.program.files[span.file] ?? '?', line: span.line, col: span.col }
            : {}),
        };
      }
    }
    const callStack = this.frames.map(
      (f) => `${(this.program.containers[f.container] as IrContainer | undefined)?.name ?? '?'}:${f.ip}`,
    );
    throw new ForgeRuntimeError(message, location, callStack);
  }
}
