/**
 * The VM standard library (F472–F476, F479): a single registry that drives
 * lowering (name → CALL_BUILTIN id), execution, and the generated reference
 * doc (`stdlib.md`, via {@link generateStdlibDoc}).
 *
 * Effects (F482–F484) live in a parallel registry: they lower to `EFFECT`
 * ops and are dispatched to the host as opaque commands.
 */

import type { Value, ListValue } from './values.js';
import { errorValue, isList, makeList, valueEquals, asNumber } from './values.js';

/** Execution context handed to builtin implementations. */
export interface BuiltinContext {
  /** Deterministic random integer in [min, max], advancing the state PRNG. */
  randInt(min: number, max: number): number;
  /** Visit count of a knot/stitch/label by (possibly relative) name. */
  visits(name: string): number;
  /** Turn counter (choices taken so far). */
  turns(): number;
  /** Resolve a container name to an index, or null. */
  resolveTarget(name: string): { container: number; name: string } | null;
}

export interface BuiltinEntry {
  readonly name: string;
  readonly signature: string;
  readonly category: 'math' | 'random' | 'string' | 'list' | 'story';
  readonly doc: string;
  readonly minArgs: number;
  readonly maxArgs: number;
  readonly impl: (ctx: BuiltinContext, args: Value[]) => Value;
}

function num1(name: string, args: Value[], f: (x: number) => number): Value {
  const x = asNumber(args[0] ?? 0);
  if (x === null) return errorValue(`${name} expects a number`);
  return f(x);
}

function num2(name: string, args: Value[], f: (a: number, b: number) => number): Value {
  const a = asNumber(args[0] ?? 0);
  const b = asNumber(args[1] ?? 0);
  if (a === null || b === null) return errorValue(`${name} expects numbers`);
  return f(a, b);
}

function str1(name: string, args: Value[], f: (s: string) => Value): Value {
  const s = args[0];
  if (typeof s !== 'string') return errorValue(`${name} expects a string`);
  return f(s);
}

function list1(name: string, args: Value[], f: (l: ListValue) => Value): Value {
  const l = args[0];
  if (l === undefined || !isList(l)) return errorValue(`${name} expects a list`);
  return f(l);
}

/** Parse a dice expression: `d20`, `3d6`, `3d6+2`, `2d8-1` (F472). */
export function parseDice(expr: string): { count: number; sides: number; modifier: number } | null {
  const m = /^\s*(\d*)[dD](\d+)\s*([+-]\s*\d+)?\s*$/.exec(expr);
  if (!m) return null;
  const count = m[1] === '' || m[1] === undefined ? 1 : Number(m[1]);
  const sides = Number(m[2]);
  const modifier = m[3] !== undefined ? Number(m[3].replace(/\s+/g, '')) : 0;
  if (count < 1 || count > 1000 || sides < 1) return null;
  return { count, sides, modifier };
}

function rollDice(ctx: BuiltinContext, count: number, sides: number, modifier: number): number {
  let total = modifier;
  for (let i = 0; i < count; i++) total += ctx.randInt(1, sides);
  return total;
}

/** The builtin function registry, in stable id order. Never reorder entries (F419). */
export const BUILTINS: readonly BuiltinEntry[] = [
  {
    name: 'RANDOM',
    signature: 'RANDOM(min, max)',
    category: 'random',
    doc: 'Uniform random integer in [min, max], inclusive, from the seeded story PRNG.',
    minArgs: 2,
    maxArgs: 2,
    impl: (ctx, args) => num2('RANDOM', args, (a, b) => ctx.randInt(a, b)),
  },
  {
    name: 'DICE',
    signature: 'DICE(count, sides[, modifier])',
    category: 'random',
    doc: 'Roll `count` dice with `sides` faces and sum them, plus an optional modifier.',
    minArgs: 2,
    maxArgs: 3,
    impl: (ctx, args) => {
      const c = asNumber(args[0] ?? 0);
      const s = asNumber(args[1] ?? 0);
      const m = args.length > 2 ? asNumber(args[2] ?? 0) : 0;
      if (c === null || s === null || m === null) return errorValue('DICE expects numbers');
      if (c < 1 || s < 1) return errorValue('DICE expects count >= 1 and sides >= 1');
      return rollDice(ctx, Math.floor(c), Math.floor(s), m);
    },
  },
  {
    name: 'ROLL',
    signature: 'ROLL("NdS+M")',
    category: 'random',
    doc: 'Roll a dice expression string such as `"d20"`, `"3d6"`, or `"3d6+2"`.',
    minArgs: 1,
    maxArgs: 1,
    impl: (ctx, args) =>
      str1('ROLL', args, (s) => {
        const d = parseDice(s);
        if (d === null) return errorValue(`ROLL: invalid dice expression "${s}"`);
        return rollDice(ctx, d.count, d.sides, d.modifier);
      }),
  },
  {
    name: 'FLOOR',
    signature: 'FLOOR(x)',
    category: 'math',
    doc: 'Largest integer ≤ x.',
    minArgs: 1,
    maxArgs: 1,
    impl: (_ctx, args) => num1('FLOOR', args, Math.floor),
  },
  {
    name: 'CEILING',
    signature: 'CEILING(x)',
    category: 'math',
    doc: 'Smallest integer ≥ x.',
    minArgs: 1,
    maxArgs: 1,
    impl: (_ctx, args) => num1('CEILING', args, Math.ceil),
  },
  {
    name: 'ABS',
    signature: 'ABS(x)',
    category: 'math',
    doc: 'Absolute value of x.',
    minArgs: 1,
    maxArgs: 1,
    impl: (_ctx, args) => num1('ABS', args, Math.abs),
  },
  {
    name: 'MIN',
    signature: 'MIN(a, b)',
    category: 'math',
    doc: 'Smaller of a and b.',
    minArgs: 2,
    maxArgs: 2,
    impl: (_ctx, args) => num2('MIN', args, Math.min),
  },
  {
    name: 'MAX',
    signature: 'MAX(a, b)',
    category: 'math',
    doc: 'Larger of a and b.',
    minArgs: 2,
    maxArgs: 2,
    impl: (_ctx, args) => num2('MAX', args, Math.max),
  },
  {
    name: 'CLAMP',
    signature: 'CLAMP(x, lo, hi)',
    category: 'math',
    doc: 'x clamped into the range [lo, hi].',
    minArgs: 3,
    maxArgs: 3,
    impl: (_ctx, args) => {
      const x = asNumber(args[0] ?? 0);
      const lo = asNumber(args[1] ?? 0);
      const hi = asNumber(args[2] ?? 0);
      if (x === null || lo === null || hi === null) return errorValue('CLAMP expects numbers');
      return Math.min(hi, Math.max(lo, x));
    },
  },
  {
    name: 'UPPER',
    signature: 'UPPER(s)',
    category: 'string',
    doc: 'Uppercase a string.',
    minArgs: 1,
    maxArgs: 1,
    impl: (_ctx, args) => str1('UPPER', args, (s) => s.toUpperCase()),
  },
  {
    name: 'LOWER',
    signature: 'LOWER(s)',
    category: 'string',
    doc: 'Lowercase a string.',
    minArgs: 1,
    maxArgs: 1,
    impl: (_ctx, args) => str1('LOWER', args, (s) => s.toLowerCase()),
  },
  {
    name: 'CONTAINS',
    signature: 'CONTAINS(s, sub)',
    category: 'string',
    doc: 'True when string s contains substring sub.',
    minArgs: 2,
    maxArgs: 2,
    impl: (_ctx, args) => {
      const s = args[0];
      const sub = args[1];
      if (typeof s !== 'string' || typeof sub !== 'string') {
        return errorValue('CONTAINS expects strings');
      }
      return s.includes(sub);
    },
  },
  {
    name: 'LENGTH',
    signature: 'LENGTH(s)',
    category: 'string',
    doc: 'Length of a string (or element count of a list).',
    minArgs: 1,
    maxArgs: 1,
    impl: (_ctx, args) => {
      const v = args[0];
      if (typeof v === 'string') return v.length;
      if (v !== undefined && isList(v)) return v.items.length;
      return errorValue('LENGTH expects a string or list');
    },
  },
  {
    name: 'COUNT',
    signature: 'COUNT(list)',
    category: 'list',
    doc: 'Number of elements in a list.',
    minArgs: 1,
    maxArgs: 1,
    impl: (_ctx, args) => list1('COUNT', args, (l) => l.items.length),
  },
  {
    name: 'LIST_MIN',
    signature: 'LIST_MIN(list)',
    category: 'list',
    doc: 'Smallest numeric element of a list (errors on empty/non-numeric lists).',
    minArgs: 1,
    maxArgs: 1,
    impl: (_ctx, args) =>
      list1('LIST_MIN', args, (l) => {
        const nums = l.items.filter((i): i is number => typeof i === 'number');
        if (nums.length === 0) return errorValue('LIST_MIN: no numeric elements');
        return Math.min(...nums);
      }),
  },
  {
    name: 'LIST_MAX',
    signature: 'LIST_MAX(list)',
    category: 'list',
    doc: 'Largest numeric element of a list (errors on empty/non-numeric lists).',
    minArgs: 1,
    maxArgs: 1,
    impl: (_ctx, args) =>
      list1('LIST_MAX', args, (l) => {
        const nums = l.items.filter((i): i is number => typeof i === 'number');
        if (nums.length === 0) return errorValue('LIST_MAX: no numeric elements');
        return Math.max(...nums);
      }),
  },
  {
    name: 'RANDOM_FROM',
    signature: 'RANDOM_FROM(list)',
    category: 'list',
    doc: 'A uniformly random element of the list, drawn from the story PRNG.',
    minArgs: 1,
    maxArgs: 1,
    impl: (ctx, args) =>
      list1('RANDOM_FROM', args, (l) => {
        if (l.items.length === 0) return errorValue('RANDOM_FROM: empty list');
        return l.items[ctx.randInt(0, l.items.length - 1)] as Value;
      }),
  },
  {
    name: 'INTERSECTION',
    signature: 'INTERSECTION(a, b)',
    category: 'list',
    doc: 'Elements present in both lists, in the order of the first.',
    minArgs: 2,
    maxArgs: 2,
    impl: (_ctx, args) => {
      const a = args[0];
      const b = args[1];
      if (a === undefined || b === undefined || !isList(a) || !isList(b)) {
        return errorValue('INTERSECTION expects two lists');
      }
      return makeList(a.items.filter((x) => b.items.some((y) => valueEquals(x, y))));
    },
  },
  {
    name: 'TURNS',
    signature: 'TURNS()',
    category: 'story',
    doc: 'Number of choices taken so far this playthrough.',
    minArgs: 0,
    maxArgs: 0,
    impl: (ctx) => ctx.turns(),
  },
  {
    name: 'VISITED',
    signature: 'VISITED("knot")',
    category: 'story',
    doc: 'Visit count of a knot, stitch, or label by name (0 when never visited).',
    minArgs: 1,
    maxArgs: 1,
    impl: (ctx, args) => str1('VISITED', args, (s) => ctx.visits(s)),
  },
  {
    name: 'TARGET',
    signature: 'TARGET("knot.stitch")',
    category: 'story',
    doc: 'A divert-target value for the named knot/stitch/label; store it in a variable and `-> that_variable` later.',
    minArgs: 1,
    maxArgs: 1,
    impl: (ctx, args) =>
      str1('TARGET', args, (s) => {
        const t = ctx.resolveTarget(s);
        if (t === null) return errorValue(`TARGET: unknown destination "${s}"`);
        return { kind: 'divert', container: t.container, name: t.name };
      }),
  },
];

export const BUILTIN_IDS: ReadonlyMap<string, number> = new Map(BUILTINS.map((b, i) => [b.name, i]));

// ── effects (F482–F484) ──────────────────────────────────────────────────────

export interface EffectEntry {
  readonly name: string;
  readonly signature: string;
  readonly doc: string;
  readonly minArgs: number;
  readonly maxArgs: number;
}

/** Effect registry, in stable id order. Dispatched to the host as opaque commands. */
export const EFFECTS: readonly EffectEntry[] = [
  {
    name: 'PLAY_AUDIO',
    signature: 'PLAY_AUDIO("track")',
    doc: 'Ask the host player to play an audio cue.',
    minArgs: 1,
    maxArgs: 2,
  },
  {
    name: 'SET_THEME',
    signature: 'SET_THEME("theme")',
    doc: 'Ask the host player to switch its visual theme.',
    minArgs: 1,
    maxArgs: 1,
  },
  {
    name: 'VIBRATE',
    signature: 'VIBRATE([ms])',
    doc: 'Ask the host device to vibrate (mobile haptics).',
    minArgs: 0,
    maxArgs: 1,
  },
  {
    name: 'PAUSE',
    signature: 'PAUSE(ms)',
    doc: 'Ask the host player to pause dramatically before continuing.',
    minArgs: 1,
    maxArgs: 1,
  },
  {
    name: 'JOURNAL',
    signature: 'JOURNAL("entry text") / @journal(entry text)',
    doc: 'Write a journal/note entry into the knowledge base from story flow.',
    minArgs: 1,
    maxArgs: 2,
  },
  {
    name: 'ENTITY_SET',
    signature: 'ENTITY_SET("entity", "field", value)',
    doc: 'Mutate a knowledge-base entity field (e.g. hero health) via the host.',
    minArgs: 3,
    maxArgs: 3,
  },
];

export const EFFECT_IDS: ReadonlyMap<string, number> = new Map(EFFECTS.map((e, i) => [e.name, i]));

// ── reference doc generation (F479) ──────────────────────────────────────────

const CATEGORY_TITLES: Record<BuiltinEntry['category'], string> = {
  math: 'Math',
  random: 'Randomness & dice',
  string: 'Strings',
  list: 'Lists',
  story: 'Story state',
};

/** Generate the stdlib reference markdown. `stdlib.md` is asserted against this in tests. */
export function generateStdlibDoc(): string {
  const lines: string[] = [
    '# Forge stdlib reference',
    '',
    '<!-- Generated from the registry in `stdlib.ts` (`generateStdlibDoc()`). Do not edit by hand. -->',
    '',
    'All randomness is drawn from the seeded story PRNG: identical seeds and',
    'choices replay identically. Functions never throw — invalid arguments',
    'produce story-visible error values.',
    '',
  ];
  for (const cat of ['math', 'random', 'string', 'list', 'story'] as const) {
    lines.push(`## ${CATEGORY_TITLES[cat]}`, '');
    lines.push('| Function | Description |', '| --- | --- |');
    for (const b of BUILTINS) {
      if (b.category === cat) lines.push(`| \`${b.signature}\` | ${b.doc} |`);
    }
    lines.push('');
  }
  lines.push('## Effects (host-dispatched)', '');
  lines.push(
    'Effects are opaque commands interpreted by the host player. They are',
    'sandboxed (only the registry below plus host-registered external',
    'functions are reachable), audited per playthrough, and a failing effect',
    'yields an error value instead of crashing the story.',
    '',
  );
  lines.push('| Effect | Description |', '| --- | --- |');
  for (const e of EFFECTS) lines.push(`| \`${e.signature}\` | ${e.doc} |`);
  lines.push('');
  return lines.join('\n');
}
