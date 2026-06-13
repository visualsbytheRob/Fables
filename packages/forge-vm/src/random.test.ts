import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_SEED, normalizeSeed, prngFloat, prngInt, prngNext, prngPermutation } from './prng.js';
import { generateStdlibDoc, parseDice } from './stdlib.js';
import { createStoryFromSource, runStory } from './harness.js';
import { fixture, testRng, corpusFiles } from './test-helpers.js';

/** F471–F479: seeded randomness, dice, stdlib, and determinism guarantees. */

describe('seedable PRNG (F471)', () => {
  it('is a pure function of its uint32 state', () => {
    let s = normalizeSeed(42);
    const a = [prngFloat((s = prngNext(s))), prngFloat((s = prngNext(s)))];
    let t = normalizeSeed(42);
    const b = [prngFloat((t = prngNext(t))), prngFloat((t = prngNext(t)))];
    expect(a).toEqual(b);
  });

  it('normalizes string seeds and defaults deterministically', () => {
    expect(normalizeSeed('fox')).toBe(normalizeSeed('fox'));
    expect(normalizeSeed('fox')).not.toBe(normalizeSeed('crow'));
    expect(normalizeSeed(undefined)).toBe(DEFAULT_SEED);
  });

  it('prngInt stays within inclusive bounds', () => {
    let s = 12345;
    for (let i = 0; i < 500; i++) {
      const r = prngInt(s, 1, 6);
      s = r.state;
      expect(r.value).toBeGreaterThanOrEqual(1);
      expect(r.value).toBeLessThanOrEqual(6);
    }
  });

  it('permutations cover every index exactly once', () => {
    const { order } = prngPermutation(99, 7);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('the PRNG state lives in VM state (replays after save/load)', () => {
    const src = '-> roll\n=== roll ===\nRolled {RANDOM(1, 100)}.\n+ Again.\n  -> roll\n';
    const a = createStoryFromSource(src, { seed: 7 });
    a.continue();
    const json = JSON.parse(JSON.stringify(a.saveState())) as unknown;
    const b = createStoryFromSource(src, { seed: 7 });
    b.loadState(json);
    a.choose(0);
    b.choose(0);
    expect(b.continue()).toBe(a.continue());
  });
});

describe('RANDOM and dice expressions (F472)', () => {
  it('RANDOM(min,max) is inclusive and deterministic per seed', () => {
    const src = 'Rolls: {RANDOM(1,2)} {RANDOM(1,2)} {RANDOM(1,2)} {RANDOM(1,2)}.\n-> END\n';
    const a = runStory(src, [], { seed: 3 }).transcript;
    expect(a).toBe(runStory(src, [], { seed: 3 }).transcript);
    expect(a).toMatch(/Rolls: [12] [12] [12] [12]\./);
  });

  it('parses dice expressions', () => {
    expect(parseDice('d20')).toEqual({ count: 1, sides: 20, modifier: 0 });
    expect(parseDice('3d6')).toEqual({ count: 3, sides: 6, modifier: 0 });
    expect(parseDice('3d6+2')).toEqual({ count: 3, sides: 6, modifier: 2 });
    expect(parseDice('2d8-1')).toEqual({ count: 2, sides: 8, modifier: -1 });
    expect(parseDice('banana')).toBeNull();
    expect(parseDice('0d6')).toBeNull();
  });

  it('DICE and ROLL stay within bounds', () => {
    const r = runStory('VAR x = ROLL("3d6+2")\nVAR y = DICE(2, 4)\nGot {x} and {y}.\n-> END\n', [], { seed: 13 });
    const m = /Got (\d+) and (\d+)\./.exec(r.transcript);
    expect(m).not.toBeNull();
    const x = Number(m?.[1]);
    const y = Number(m?.[2]);
    expect(x).toBeGreaterThanOrEqual(5);
    expect(x).toBeLessThanOrEqual(20);
    expect(y).toBeGreaterThanOrEqual(2);
    expect(y).toBeLessThanOrEqual(8);
  });

  it('invalid dice are story-visible errors, not crashes', () => {
    expect(runStory('Oops {ROLL("nope")}.\n-> END\n').transcript).toContain('(error: ROLL: invalid dice expression');
  });
});

describe('shuffle alternatives use the state PRNG (F473)', () => {
  it('draws each branch once per cycle, reshuffling between cycles', () => {
    const src = '-> spin\n=== spin ===\nCard: {~ace|king|queen}\n+ Again.\n  -> spin\n';
    const r = runStory(src, [0, 0, 0, 0, 0, 0, 0, 0], { seed: 21 });
    const cards = r.transcript.split('\n').filter((l) => l.startsWith('Card: ')).map((l) => l.slice(6));
    expect(cards).toHaveLength(9);
    expect([...cards.slice(0, 3)].sort()).toEqual(['ace', 'king', 'queen']);
    expect([...cards.slice(3, 6)].sort()).toEqual(['ace', 'king', 'queen']);
    expect([...cards.slice(6, 9)].sort()).toEqual(['ace', 'king', 'queen']);
  });

  it('different seeds produce different shuffle orders (eventually)', () => {
    const src = '-> s\n=== s ===\n{~a|b|c|d|e}{~a|b|c|d|e}{~a|b|c|d|e}\n-> END\n';
    const outs = new Set([1, 2, 3, 4, 5].map((seed) => runStory(src, [], { seed }).transcript));
    expect(outs.size).toBeGreaterThan(1);
  });
});

describe('stdlib functions (F474–F476)', () => {
  it('math: floor/ceiling/abs/min/max/clamp', () => {
    const r = runStory(
      '{FLOOR(3.7)} {CEILING(3.2)} {ABS(-5)} {MIN(2, 9)} {MAX(2, 9)} {CLAMP(15, 0, 10)}\n-> END\n',
    );
    expect(r.transcript).toBe('3 4 5 2 9 10');
  });

  it('strings: upper/lower/contains/length', () => {
    const r = runStory(
      'VAR s = "Reynard"\n{UPPER(s)} {LOWER(s)} {CONTAINS(s, "yna"): yes|no} {LENGTH(s)}\n-> END\n',
    );
    expect(r.transcript).toBe('REYNARD reynard yes 7');
  });

  it('lists: count/min/max/random-from/intersection', () => {
    const r = runStory(
      `VAR nums = [3, 1, 4, 1, 5]
VAR mine = ["fish", "fig"]
VAR yours = ["fig", "honey"]
{COUNT(nums)} {LIST_MIN(nums)} {LIST_MAX(nums)} {INTERSECTION(mine, yours)}
Pick: {RANDOM_FROM(mine)}
-> END
`,
      [],
      { seed: 8 },
    );
    expect(r.transcript).toContain('4 1 5 fig'); // duplicate 1 deduplicated
    expect(r.transcript).toMatch(/Pick: (fish|fig)/);
  });

  it('type errors yield error values, never throws', () => {
    expect(runStory('{FLOOR("wet")}\n-> END\n').transcript).toContain('(error: FLOOR expects a number)');
    expect(runStory('{COUNT(5)}\n-> END\n').transcript).toContain('(error: COUNT expects a list)');
  });
});

describe('replay determinism (F477)', () => {
  const STORIES: [string, (number | string)[]][] = [
    ['10-alternatives', [0, 0, 0, 0, 1]],
    ['22-builtins', []],
    ['24-lion-court-epic', ['Present', 'river', 'feast']],
  ];

  it('same seed + same choices = byte-identical transcript', () => {
    for (const [name, choices] of STORIES) {
      for (const seed of [1, 99, 'wolf']) {
        const a = runStory(fixture(name), choices, { seed, files: corpusFiles() });
        const b = runStory(fixture(name), choices, { seed, files: corpusFiles() });
        expect(b.transcript, `${name} seed ${String(seed)}`).toBe(a.transcript);
        expect(b.turns).toEqual(a.turns);
      }
    }
  });

  it('different seeds can diverge on random content', () => {
    const outs = new Set(
      [1, 2, 3, 4, 5, 6].map((seed) => runStory(fixture('22-builtins'), [], { seed }).transcript),
    );
    expect(outs.size).toBeGreaterThan(1);
  });
});

describe('expression fuzz (F478)', () => {
  function genExpr(rng: () => number, depth: number): string {
    if (depth === 0 || rng() < 0.3) return String(1 + Math.floor(rng() * 9));
    const ops = ['+', '-', '*'];
    const op = ops[Math.floor(rng() * ops.length)] as string;
    return `(${genExpr(rng, depth - 1)} ${op} ${genExpr(rng, depth - 1)})`;
  }

  it('random integer expressions match a JS oracle', () => {
    const rng = testRng(0xf00d);
    for (let i = 0; i < 120; i++) {
      const expr = genExpr(rng, 3);
      const r = runStory(`Result {${expr}}.\n-> END\n`);
      const oracle = new Function(`return (${expr});`)() as number;
      expect(r.transcript, expr).toBe(`Result ${oracle}.`);
    }
  });

  it('optimized and unoptimized lowering agree on fuzzed expressions', () => {
    const rng = testRng(0xbeef);
    for (let i = 0; i < 80; i++) {
      const expr = genExpr(rng, 3);
      const cmp = ['<', '<=', '>', '>=', '==', '!='][Math.floor(rng() * 6)] as string;
      const src = `Result {${expr} ${cmp} ${genExpr(rng, 2)}: yes|no}.\n-> END\n`;
      expect(runStory(src, [], { optimize: true }).transcript, src).toBe(
        runStory(src, [], { optimize: false }).transcript,
      );
    }
  });

  it('division and modulo by zero are error values under both modes', () => {
    for (const optimize of [true, false]) {
      expect(runStory('{1 / 0}\n-> END\n', [], { optimize }).transcript).toContain('division by zero');
      expect(runStory('{1 % 0}\n-> END\n', [], { optimize }).transcript).toContain('modulo by zero');
    }
  });
});

describe('stdlib reference doc (F479)', () => {
  it('stdlib.md is exactly the generated registry doc', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const onDisk = readFileSync(join(here, 'stdlib.md'), 'utf8');
    expect(onDisk).toBe(generateStdlibDoc());
  });

  it('documents every builtin and effect', () => {
    const doc = generateStdlibDoc();
    for (const name of ['RANDOM', 'DICE', 'ROLL', 'CLAMP', 'UPPER', 'INTERSECTION', 'VISITED', 'TARGET']) {
      expect(doc).toContain(name);
    }
    for (const name of ['PLAY_AUDIO', 'SET_THEME', 'VIBRATE', 'PAUSE', 'JOURNAL', 'ENTITY_SET']) {
      expect(doc).toContain(name);
    }
  });
});
