import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { checkInvariants } from './invariants.js';
import { tokenize } from './lexer.js';
import { parse } from './parser.js';
import { printStory } from './printer.js';
import { renderDiagnostics } from './render.js';
import { dirFileProvider, loadFixtures } from './test-helpers.js';

/**
 * Golden test runner (F391/F392): every corpus fixture gets lex, parse,
 * resolve, and diagnostics snapshots, plus structural health checks.
 */

const files = dirFileProvider('corpus');
const fixtures = loadFixtures('corpus');

describe('fixture corpus health (F391)', () => {
  it('has at least 20 programs', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
  });

  for (const fixture of fixtures) {
    it(`${fixture.name} compiles without errors`, () => {
      const result = compile(fixture.source, { fileName: fixture.name, files });
      expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(result.ok).toBe(true);
      expect(checkInvariants(result.ast)).toEqual([]);
    });
  }
});

describe('golden snapshots per fixture (F392)', () => {
  for (const fixture of fixtures) {
    it(`lex: ${fixture.name}`, () => {
      const { tokens } = tokenize(fixture.source);
      const compact = tokens
        .filter((t) => t.kind !== 'Newline')
        .map((t) => `${t.kind}(${t.text.length > 14 ? `${t.text.slice(0, 14)}…` : t.text})`)
        .join(' ')
        .replace(/\n/g, '⏎');
      expect(compact).toMatchSnapshot();
    });

    it(`parse: ${fixture.name}`, () => {
      // Canonical print is a compact, reviewable proxy for the AST shape.
      const { story } = parse(fixture.source, { fileName: fixture.name });
      expect(printStory(story)).toMatchSnapshot();
    });

    it(`resolve+check: ${fixture.name}`, () => {
      const result = compile(fixture.source, { fileName: fixture.name, files });
      const summary = [
        `targets: ${[...result.symbols.targets.keys()].sort().join(', ') || '(none)'}`,
        `globals: ${[...result.symbols.globals.keys()].sort().join(', ') || '(none)'}`,
        `diagnostics:`,
        renderDiagnostics(result.diagnostics, fixture.source),
      ].join('\n');
      expect(summary).toMatchSnapshot();
    });
  }
});
