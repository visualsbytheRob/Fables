import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { parse } from './parser.js';
import { printStory } from './printer.js';
import { serializeAst } from './serialize.js';
import { loadFixtures, makeRng, pick } from './test-helpers.js';

/**
 * Property tests (F394) and the grammar-aware fuzzer (F395). The fuzzer
 * builds random-but-plausible programs from the grammar's building blocks;
 * the compiler must never throw on any of them, and printing must reach a
 * fixed point.
 */

describe('printer/parser round-trip properties (F394)', () => {
  for (const fixture of loadFixtures('corpus')) {
    it(`fixed point + AST stability: ${fixture.name}`, () => {
      const once = printStory(parse(fixture.source).story);
      const onceAst = parse(once);
      const twice = printStory(onceAst.story);
      expect(onceAst.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(twice).toBe(once);
      // The canonical form's AST serializes identically when re-parsed.
      expect(serializeAst(parse(twice).story)).toBe(serializeAst(onceAst.story));
    });
  }
});

// ── grammar-aware program generator ──────────────────────────────────────────

interface Gen {
  rng: () => number;
  knotNames: string[];
  varNames: string[];
}

const WORDS = ['fox', 'crow', 'lion', 'moss', 'river', 'shadow', 'bramble', 'moon', 'ash', 'fern'];

function genWordText(g: Gen, max = 5): string {
  const n = 1 + Math.floor(g.rng() * max);
  return Array.from({ length: n }, () => pick(g.rng, WORDS)).join(' ');
}

function genExpr(g: Gen, depth: number): string {
  const r = g.rng();
  if (depth <= 0 || r < 0.3) {
    const leaf = g.rng();
    if (leaf < 0.4) return String(Math.floor(g.rng() * 100));
    if (leaf < 0.6) return pick(g.rng, g.varNames);
    if (leaf < 0.8) return `"${pick(g.rng, WORDS)}"`;
    return pick(g.rng, ['true', 'false']);
  }
  if (r < 0.5) return `${genExpr(g, depth - 1)} ${pick(g.rng, ['+', '-', '*'])} ${genExpr(g, depth - 1)}`;
  if (r < 0.65) return `(${genExpr(g, depth - 1)} ${pick(g.rng, ['>', '<', '==', '!='])} ${genExpr(g, depth - 1)})`;
  if (r < 0.8) return `MIN(${genExpr(g, depth - 1)}, ${genExpr(g, depth - 1)})`;
  return `-${genExpr(g, depth - 1)}`;
}

function genCondition(g: Gen): string {
  return `${pick(g.rng, g.varNames)} ${pick(g.rng, ['>', '<', '>=', '<=', '==', '!='])} ${Math.floor(g.rng() * 10)}`;
}

function genInline(g: Gen): string {
  const r = g.rng();
  if (r < 0.3) return `{${pick(g.rng, g.varNames)}}`;
  if (r < 0.55) return `{${genCondition(g)}: ${genWordText(g, 2)}|${genWordText(g, 2)}}`;
  if (r < 0.7) return `{${genWordText(g, 1)}|${genWordText(g, 1)}|${genWordText(g, 1)}}`;
  if (r < 0.85) return `{&${genWordText(g, 1)}|${genWordText(g, 1)}}`;
  return `{~${genWordText(g, 1)}|${genWordText(g, 1)}}`;
}

function genContentLine(g: Gen): string {
  const r = g.rng();
  if (r < 0.5) return `${genWordText(g)} ${genInline(g)}.`;
  if (r < 0.6) return `@${pick(g.rng, WORDS)} stirs near [[${genWordText(g, 2)}]].`;
  if (r < 0.7) return `~ ${pick(g.rng, g.varNames)} = ${genExpr(g, 2)}`;
  if (r < 0.8) return `~ temp scratch_${Math.floor(g.rng() * 1000)} = ${genExpr(g, 1)}`;
  if (r < 0.9) return `${genWordText(g)} <> # ${pick(g.rng, WORDS)}`;
  return `// ${genWordText(g)}`;
}

function genChoiceBlock(g: Gen, depth: number, lines: string[]): void {
  const count = 1 + Math.floor(g.rng() * 3);
  const indent = '  '.repeat(depth - 1);
  for (let i = 0; i < count; i++) {
    const sticky = g.rng() < 0.4;
    const marker = Array(depth).fill(sticky ? '+' : '*').join(' ');
    const cond = g.rng() < 0.3 ? `{${genCondition(g)}} ` : '';
    const label = g.rng() < 0.2 ? `(lbl_${depth}_${i}) ` : '';
    const bracket = g.rng() < 0.4 ? `[${genWordText(g, 2)}] ` : '';
    lines.push(`${indent}${marker} ${label}${cond}${genWordText(g, 2)} ${bracket}${genWordText(g, 2)}`);
    if (g.rng() < 0.5) lines.push(`${indent}  ${genContentLine(g)}`);
    if (depth < 3 && g.rng() < 0.35) genChoiceBlock(g, depth + 1, lines);
    lines.push(`${indent}  -> ${pick(g.rng, g.knotNames)}`);
  }
  if (g.rng() < 0.5) {
    lines.push(`${indent}- ${genWordText(g, 3)}`);
    lines.push(`${indent}-> ${pick(g.rng, g.knotNames)}`);
  }
}

export function generateProgram(seed: number, knotCount = 4): string {
  const rng = makeRng(seed);
  const g: Gen = {
    rng,
    knotNames: [...Array.from({ length: knotCount }, (_, i) => `knot_${i}`), 'END'],
    varNames: ['vigour', 'guile', 'shade'],
  };
  const lines: string[] = ['# title: generated'];
  for (const v of g.varNames) lines.push(`VAR ${v} = ${Math.floor(rng() * 10)}`);
  lines.push('-> knot_0');
  for (let k = 0; k < knotCount; k++) {
    lines.push('', `=== knot_${k} ===`);
    const contentLines = 1 + Math.floor(rng() * 4);
    for (let i = 0; i < contentLines; i++) lines.push(genContentLine(g));
    if (rng() < 0.7) genChoiceBlock(g, 1, lines);
    lines.push(`-> ${pick(rng, g.knotNames)}`);
  }
  return lines.join('\n') + '\n';
}

describe('grammar-aware fuzzer (F395)', () => {
  it('compiles 60 generated programs without ever throwing', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const program = generateProgram(seed, 3 + (seed % 4));
      expect(() => compile(program), `seed ${seed}`).not.toThrow();
    }
  });

  it('generated programs have no syntax errors and survive format round-trips', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const program = generateProgram(seed);
      const result = parse(program);
      expect(
        result.diagnostics.filter((d) => d.severity === 'error'),
        `seed ${seed}:\n${program}`,
      ).toEqual([]);
      const once = printStory(result.story);
      const twice = printStory(parse(once).story);
      expect(twice, `print fixed point for seed ${seed}`).toBe(once);
    }
  });

  it('mutated (corrupted) programs still never crash the compiler', () => {
    const NOISE = ['{', '}', '[', ']', '->', '*', '=', '~', '"', '|', ':', '@', '(', ')'];
    for (let seed = 1; seed <= 40; seed++) {
      const rng = makeRng(seed * 31);
      let program = generateProgram(seed);
      const mutations = 1 + Math.floor(rng() * 6);
      for (let m = 0; m < mutations; m++) {
        const at = Math.floor(rng() * program.length);
        program = program.slice(0, at) + pick(rng, NOISE) + program.slice(at);
      }
      expect(() => compile(program), `seed ${seed}`).not.toThrow();
    }
  });
});
