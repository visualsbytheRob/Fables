/**
 * Quick-fix tests (F515): each fix is mechanical, and applying it must
 * actually clear the diagnostic it targets when recompiled.
 */
import { describe, expect, it } from 'vitest';
import { compile } from '@fables/forge-dsl';
import { applyQuickFix, quickFixesFor } from './quickfix.js';

const diag = (source: string, code: string) => {
  const result = compile(source);
  const d = result.diagnostics.find((x) => x.code === code);
  if (d === undefined) {
    throw new Error(
      `expected ${code}, got: ${result.diagnostics.map((x) => x.code).join(', ') || 'none'}`,
    );
  }
  return d;
};

describe('quickFixesFor (F515)', () => {
  it('creates a missing knot for FORGE202 and the fix compiles clean', () => {
    const source = '-> den\n\n=== den ===\nThe fox waits.\n-> lost_warren\n';
    const d = diag(source, 'FORGE202');
    const fixes = quickFixesFor(d, source);
    expect(fixes).toHaveLength(1);
    expect(fixes[0]?.title).toBe('Create knot "lost_warren"');

    const fixed = applyQuickFix(source, fixes[0]!);
    expect(fixed).toContain('=== lost_warren ===');
    const recompiled = compile(fixed);
    expect(recompiled.diagnostics.some((x) => x.code === 'FORGE202')).toBe(false);
  });

  it('uses the knot part of a dotted target', () => {
    const source = '-> den\n\n=== den ===\n-> warren.gate\n';
    const fixes = quickFixesFor(diag(source, 'FORGE202'), source);
    expect(fixes[0]?.title).toBe('Create knot "warren"');
  });

  it('removes unreachable content for FORGE304 (whole lines)', () => {
    const source = '-> den\n\n=== den ===\nThe fox sleeps.\n-> END\nNever printed.\n';
    const d = diag(source, 'FORGE304');
    const fixes = quickFixesFor(d, source);
    expect(fixes).toHaveLength(1);
    expect(fixes[0]?.title).toBe('Remove unreachable content');

    const fixed = applyQuickFix(source, fixes[0]!);
    expect(fixed).not.toContain('Never printed.');
    expect(compile(fixed).diagnostics.some((x) => x.code === 'FORGE304')).toBe(false);
  });

  it('removes an unused VAR declaration for FORGE209', () => {
    const source = 'VAR unused_thing = 1\n-> den\n\n=== den ===\nHello.\n-> END\n';
    const d = diag(source, 'FORGE209');
    const fixes = quickFixesFor(d, source);
    expect(fixes).toHaveLength(1);

    const fixed = applyQuickFix(source, fixes[0]!);
    expect(fixed).not.toContain('unused_thing');
    expect(compile(fixed).ok).toBe(true);
    expect(compile(fixed).diagnostics.some((x) => x.code === 'FORGE209')).toBe(false);
  });

  it('offers nothing for diagnostics without a mechanical fix', () => {
    const source = '-> den\n\n=== den ===\n{1 +: broken\n-> END\n';
    const result = compile(source);
    for (const d of result.diagnostics) {
      if (d.code === 'FORGE202' || d.code === 'FORGE304' || d.code === 'FORGE209') continue;
      expect(quickFixesFor(d, source)).toEqual([]);
    }
  });
});
