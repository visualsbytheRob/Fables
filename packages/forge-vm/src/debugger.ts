/**
 * Step-through debugger, breakpoints, watch expressions, and time travel
 * (F491–F493, F495–F496, library side). The authoring-mode UI panels (F494)
 * consume {@link Story.inspect} and this class from the web lane.
 */

import { parse } from '@fables/forge-dsl';
import type { ExprNode } from '@fables/forge-dsl';

import { prngInt } from './prng.js';
import type { BuiltinContext } from './stdlib.js';
import { BUILTINS } from './stdlib.js';
import type { Value } from './values.js';
import { errorValue, isErrorValue, isList, isTruthy, makeList, valueEquals, valueToString, asNumber } from './values.js';
import type { InspectorState, Story, StoryOptions } from './vm.js';
import { replayStory } from './saves.js';

// ── breakpoints (F492) ───────────────────────────────────────────────────────

export interface Breakpoint {
  /** Knot/stitch/label container name (e.g. `meeting`, `palace.throne`). */
  readonly container?: string;
  /** Source line (1-based), optionally constrained to a file. */
  readonly line?: number;
  readonly file?: string;
}

export interface DebugStop {
  readonly reason: 'breakpoint' | 'choices' | 'done' | 'step' | 'budget';
  readonly breakpoint?: Breakpoint;
  readonly container: string;
  readonly ip: number;
  readonly line?: number;
}

export interface WatchResult {
  readonly expression: string;
  readonly value: Value;
}

export class StoryDebugger {
  private breakpoints = new Map<number, Breakpoint>();
  private nextBp = 1;
  private watches = new Map<number, string>();
  private nextWatch = 1;

  constructor(
    readonly story: Story,
    /** Recreates a fresh story for time travel; defaults to same program+seed. */
    private readonly factory?: (options: StoryOptions) => Story,
  ) {}

  addBreakpoint(bp: Breakpoint): number {
    const id = this.nextBp++;
    this.breakpoints.set(id, bp);
    return id;
  }

  removeBreakpoint(id: number): void {
    this.breakpoints.delete(id);
  }

  listBreakpoints(): readonly { id: number; breakpoint: Breakpoint }[] {
    return [...this.breakpoints.entries()].map(([id, breakpoint]) => ({ id, breakpoint }));
  }

  addWatch(expression: string): number {
    const id = this.nextWatch++;
    this.watches.set(id, expression);
    return id;
  }

  removeWatch(id: number): void {
    this.watches.delete(id);
  }

  /** Evaluate all watch expressions against live state (F493). */
  watchValues(): readonly WatchResult[] {
    return [...this.watches.values()].map((expression) => ({
      expression,
      value: evaluateWatchExpression(this.story, expression),
    }));
  }

  /** Execute a single VM instruction (F491). */
  step(): DebugStop {
    this.story.stepInstruction();
    return this.stopInfo('step');
  }

  /** Run until the source line changes (or flow stops). */
  stepLine(maxInstructions = 10_000): DebugStop {
    const start = this.line();
    for (let i = 0; i < maxInstructions; i++) {
      if (this.story.status !== 'running') return this.stopInfo(this.story.status === 'choices' ? 'choices' : 'done');
      this.story.stepInstruction();
      const line = this.line();
      if (line !== undefined && line !== start) return this.stopInfo('step');
    }
    return this.stopInfo('budget');
  }

  /** Run to the next breakpoint, choice point, or story end. */
  run(maxInstructions = 1_000_000): DebugStop {
    let lastContainer = this.story.position().container;
    for (let i = 0; i < maxInstructions; i++) {
      if (this.story.status === 'choices') return this.stopInfo('choices');
      if (this.story.status === 'done') return this.stopInfo('done');
      this.story.stepInstruction();
      const pos = this.story.position();
      const entered = pos.container !== lastContainer && pos.ip === 0 ? pos.container : null;
      lastContainer = pos.container;
      const hit = this.matchBreakpoint(entered, pos.span?.line);
      if (hit !== undefined) return { ...this.stopInfo('breakpoint'), breakpoint: hit };
    }
    return this.stopInfo('budget');
  }

  /** Step over the current choice point: choose, then run to the next stop (F491). */
  stepOverChoice(index = 0): DebugStop {
    if (this.story.status !== 'choices') throw new Error('not at a choice point');
    this.story.choose(index);
    return this.run();
  }

  /** Live state inspector data (F495). */
  inspect(): InspectorState {
    return this.story.inspect();
  }

  /**
   * Time travel (F496): replay from the start to just after `turn` choices.
   * Replay-based, so it is exact: same bytecode, same seed, same choices.
   */
  timeTravel(turn: number): Story {
    const state = this.story.saveState();
    if (turn < 0 || turn > state.history.length) {
      throw new Error(`cannot time-travel to turn ${turn}: history has ${state.history.length} choices`);
    }
    const choices = state.history.slice(0, turn).map((h) => h.index);
    if (this.factory !== undefined) {
      const fresh = this.factory({ seed: state.seed });
      fresh.continue();
      for (const c of choices) {
        if (fresh.status !== 'choices') break;
        fresh.choose(c);
        fresh.continue();
      }
      return fresh;
    }
    return replayStory(this.story.program, { seed: state.seed }, choices);
  }

  private line(): number | undefined {
    return this.story.position().span?.line;
  }

  private stopInfo(reason: DebugStop['reason']): DebugStop {
    const pos = this.story.position();
    return {
      reason,
      container: pos.container,
      ip: pos.ip,
      ...(pos.span?.line !== undefined ? { line: pos.span.line } : {}),
    };
  }

  private matchBreakpoint(enteredContainer: string | null, line: number | undefined): Breakpoint | undefined {
    for (const bp of this.breakpoints.values()) {
      if (bp.container !== undefined) {
        if (enteredContainer !== null && enteredContainer === bp.container) return bp;
        continue;
      }
      if (bp.line !== undefined && line === bp.line) return bp;
    }
    return undefined;
  }
}

// ── watch expressions (F493) ─────────────────────────────────────────────────

/**
 * Evaluate a Forge expression string against live story state. Side-effect
 * free: random functions draw from a throwaway copy of the PRNG state, and
 * host functions/effects are not callable from watches.
 */
export function evaluateWatchExpression(story: Story, expression: string): Value {
  const { story: ast } = parse(`VAR __watch = ${expression.replace(/\n/g, ' ')}`);
  const decl = ast.declarations[0];
  if (decl === undefined) return errorValue(`could not parse expression "${expression}"`);
  let scratchPrng = story.inspect().prng;
  const ctx: BuiltinContext = {
    randInt: (min, max) => {
      const r = prngInt(scratchPrng, min, max);
      scratchPrng = r.state;
      return r.value;
    },
    visits: (name) => story.visits(name),
    turns: () => story.currentTurn,
    resolveTarget: (name) => {
      const idx = story.program.containers.findIndex((c) => c.name === name);
      return idx === -1 ? null : { container: idx, name };
    },
  };
  return evalExpr(decl.init, story, ctx);
}

function evalExpr(expr: ExprNode, story: Story, ctx: BuiltinContext): Value {
  switch (expr.kind) {
    case 'Literal':
      return expr.value;
    case 'ListLit':
      return makeList(expr.elements.map((e) => evalExpr(e, story, ctx)));
    case 'VarRef': {
      const joined = expr.path.join('.');
      if (expr.path.length === 1) {
        const v = story.getVariable(joined);
        if (v !== undefined) return v;
      }
      if (story.program.containers.some((c) => c.name === joined)) return story.visits(joined);
      // Relative read counts are ambiguous in a watch; require full names.
      return errorValue(`unknown variable "${joined}"`);
    }
    case 'Unary': {
      const v = evalExpr(expr.operand, story, ctx);
      if (isErrorValue(v)) return v;
      if (expr.op === '!') return !isTruthy(v);
      const n = asNumber(v);
      return n === null ? errorValue('cannot negate a non-number') : -n;
    }
    case 'Binary': {
      const left = evalExpr(expr.left, story, ctx);
      const right = evalExpr(expr.right, story, ctx);
      if (isErrorValue(left)) return left;
      if (isErrorValue(right)) return right;
      return evalBinary(expr.op, left, right);
    }
    case 'Ternary':
      return isTruthy(evalExpr(expr.condition, story, ctx))
        ? evalExpr(expr.whenTrue, story, ctx)
        : evalExpr(expr.whenFalse, story, ctx);
    case 'Call': {
      const name = expr.callee.name;
      const entry = BUILTINS.find((b) => b.name === name);
      if (entry === undefined) return errorValue(`function "${name}" is not available in watches`);
      const args = expr.args.map((arg) => evalExpr(arg, story, ctx));
      if (args.length < entry.minArgs || args.length > entry.maxArgs) {
        return errorValue(`${entry.name} expects ${entry.minArgs}–${entry.maxArgs} arguments`);
      }
      return entry.impl(ctx, args);
    }
    case 'EntityRef':
      return errorValue('entity bindings are not available in watches');
    case 'ErrorExpr':
      return errorValue('could not parse expression');
  }
}

function evalBinary(op: string, left: Value, right: Value): Value {
  const num = (v: Value): number | null => asNumber(v);
  switch (op) {
    case '+': {
      if (typeof left === 'number' && typeof right === 'number') return left + right;
      if (isList(left)) return makeList([...left.items, ...(isList(right) ? right.items : [right])]);
      if (typeof left === 'string' || typeof right === 'string') return valueToString(left) + valueToString(right);
      return errorValue('cannot add these values');
    }
    case '-': {
      if (typeof left === 'number' && typeof right === 'number') return left - right;
      if (isList(left)) {
        const removals = isList(right) ? right.items : [right];
        return makeList(left.items.filter((i) => !removals.some((r) => valueEquals(i, r))));
      }
      return errorValue('cannot subtract these values');
    }
    case '*':
    case '/':
    case '%': {
      const l = num(left);
      const r = num(right);
      if (l === null || r === null) return errorValue('arithmetic on non-numbers');
      if ((op === '/' || op === '%') && r === 0) return errorValue('division by zero');
      return op === '*' ? l * r : op === '/' ? l / r : l % r;
    }
    case '==':
      return valueEquals(left, right);
    case '!=':
      return !valueEquals(left, right);
    case '<':
    case '<=':
    case '>':
    case '>=': {
      const l = num(left);
      const r = num(right);
      if (typeof left === 'string' && typeof right === 'string') {
        const cmp = left < right ? -1 : left > right ? 1 : 0;
        return op === '<' ? cmp < 0 : op === '<=' ? cmp <= 0 : op === '>' ? cmp > 0 : cmp >= 0;
      }
      if (l === null || r === null) return errorValue('cannot compare these values');
      return op === '<' ? l < r : op === '<=' ? l <= r : op === '>' ? l > r : l >= r;
    }
    case '&&':
      return isTruthy(left) && isTruthy(right);
    case '||':
      return isTruthy(left) || isTruthy(right);
    case 'has':
    case 'hasnt': {
      let result: boolean;
      if (isList(left)) result = left.items.some((i) => valueEquals(i, right));
      else if (typeof left === 'string') result = left.includes(valueToString(right));
      else return errorValue('"has" expects a list or string on the left');
      return op === 'has' ? result : !result;
    }
    default:
      return errorValue(`unsupported operator "${op}"`);
  }
}
