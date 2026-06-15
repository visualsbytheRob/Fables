/**
 * FQL v2 tests (Epic 20, F1961–F1969): variables, computed-field expressions,
 * aggregations, EXPLAIN and linting.
 */

import { describe, expect, it } from 'vitest';
import { parseFql } from './parse.js';
import { extractVariables, substituteVariables } from './variables.js';
import { evalExpr, parseExpr, evaluateExpr, ExprError } from './expr.js';
import { aggregate, withComputed } from './aggregate.js';
import { explainQuery } from './explain.js';
import { lintQuery } from './lint.js';

describe('query variables (F1964)', () => {
  it('extracts distinct variables in first-seen order', () => {
    expect(extractVariables('tag:$topic updated:$since tag:$topic')).toEqual(['topic', 'since']);
  });

  it('substitutes supplied variables and quotes values with spaces', () => {
    const { query, missing } = substituteVariables('title:$t notebook:$nb', {
      t: 'two words',
      nb: 'Work',
    });
    expect(query).toBe('title:"two words" notebook:Work');
    expect(missing).toEqual([]);
  });

  it('reports missing variables and leaves them untouched', () => {
    const { query, missing } = substituteVariables('tag:$a tag:$b', { a: 'x' });
    expect(query).toBe('tag:x tag:$b');
    expect(missing).toEqual(['b']);
  });

  it('produces a query that still parses after substitution', () => {
    const { query } = substituteVariables('tag:$topic', { topic: 'project' });
    expect(() => parseFql(query)).not.toThrow();
  });
});

describe('computed-field expressions (F1963)', () => {
  it('evaluates arithmetic with precedence', () => {
    expect(evalExpr('2 + 3 * 4', {})).toBe(14);
    expect(evalExpr('(2 + 3) * 4', {})).toBe(20);
  });

  it('resolves row fields and concatenates strings', () => {
    expect(evalExpr('title + "!"', { title: 'Hi' })).toBe('Hi!');
    expect(evalExpr('words / 200', { words: 600 })).toBe(3);
  });

  it('supports functions', () => {
    expect(evalExpr('len(title)', { title: 'abcd' })).toBe(4);
    expect(evalExpr('upper(title)', { title: 'hi' })).toBe('HI');
    expect(evalExpr('round(words / 3, 2)', { words: 10 })).toBe(3.33);
    expect(evalExpr('coalesce(missing, "fallback")', {})).toBe('fallback');
  });

  it('evaluates comparisons to booleans', () => {
    expect(evalExpr('words > 100', { words: 250 })).toBe(true);
    expect(evalExpr('words > 100', { words: 50 })).toBe(false);
  });

  it('if() branches on truthiness', () => {
    expect(evalExpr('if(words > 100, "long", "short")', { words: 5 })).toBe('short');
  });

  it('missing fields are null, never throwing; division by zero is 0', () => {
    expect(evaluateExpr(parseExpr('nope + 1'), {})).toBe(1);
    expect(evalExpr('1 / 0', {})).toBe(0);
  });

  it('rejects malformed expressions', () => {
    expect(() => parseExpr('2 +')).toThrow(ExprError);
    expect(() => parseExpr('foo(')).toThrow(ExprError);
    expect(() => evalExpr('bogus(1)', {})).toThrow(ExprError);
  });
});

describe('aggregations (F1961)', () => {
  const rows = [
    { notebook: 'Work', words: 100 },
    { notebook: 'Work', words: 300 },
    { notebook: 'Home', words: 50 },
  ];

  it('counts and sums without grouping', () => {
    const r = aggregate(rows, {
      metrics: [
        { fn: 'count', as: 'n' },
        { fn: 'sum', field: 'words', as: 'total' },
        { fn: 'avg', field: 'words', as: 'mean' },
      ],
    });
    expect(r.total.rows).toBe(3);
    expect(r.groups[0]!.values).toEqual({ n: 3, total: 450, mean: 150 });
  });

  it('groups by a field with stable ordering', () => {
    const r = aggregate(rows, {
      groupBy: 'notebook',
      metrics: [
        { fn: 'count', as: 'n' },
        { fn: 'max', field: 'words', as: 'longest' },
      ],
    });
    expect(r.groups.map((g) => g.key)).toEqual(['Home', 'Work']);
    expect(r.groups.find((g) => g.key === 'Work')!.values).toEqual({ n: 2, longest: 300 });
  });

  it('adds computed columns before aggregating (F1962/F1963 join+derive)', () => {
    const enriched = withComputed(rows, [{ as: 'pages', expr: 'round(words / 250, 1)' }]);
    expect(enriched[1]!.pages).toBe(1.2);
    const r = aggregate(enriched, { metrics: [{ fn: 'sum', field: 'pages', as: 'totalPages' }] });
    expect(r.total.values.totalPages).toBeCloseTo(1.8, 5);
  });
});

describe('EXPLAIN (F1965)', () => {
  it('flags a leading-wildcard text scan as costly', () => {
    const { ast } = parseFql('hello');
    const plan = explainQuery(ast);
    expect(plan.steps[0]!.access).toBe('scan');
    expect(plan.warnings.join(' ')).toMatch(/no index|leading-wildcard/);
  });

  it('reports the indexes a tag/notebook query leans on', () => {
    const { ast } = parseFql('tag:project notebook:Work');
    const plan = explainQuery(ast);
    expect(plan.indexes).toContain('note_tags');
    expect(plan.indexes).toContain('notebooks');
    expect(plan.estimatedCost).toBeGreaterThan(0);
  });

  it('a date filter is a cheaper range access than a text scan', () => {
    const textCost = explainQuery(parseFql('hello').ast).estimatedCost;
    const dateCost = explainQuery(parseFql('updated:>7d').ast).estimatedCost;
    expect(dateCost).toBeLessThan(textCost);
  });

  it('an empty query explains as a full scan', () => {
    const plan = explainQuery(null);
    expect(plan.warnings[0]).toMatch(/every note/);
  });
});

describe('parser hardening (F1267)', () => {
  it('rejects pathologically deep nesting instead of overflowing the stack', () => {
    const deep = `${'('.repeat(5000)}a${')'.repeat(5000)}`;
    // A typed VALIDATION error, never a RangeError stack overflow.
    expect(() => parseFql(deep)).toThrowError(/nesting too deep|syntax error/i);
  });

  it('still accepts reasonable nesting', () => {
    expect(() => parseFql('((tag:a OR tag:b) AND (tag:c OR tag:d))')).not.toThrow();
  });
});

describe('query linting (F1968)', () => {
  it('suggests the nearest field for a typo', () => {
    const findings = lintQuery('tg:project');
    const err = findings.find((f) => f.severity === 'error');
    expect(err?.message).toMatch(/unknown field/);
    expect(err?.suggestion).toMatch(/tag:/);
  });

  it('warns on lowercase boolean operators', () => {
    const findings = lintQuery('cats and dogs');
    expect(findings.some((f) => f.severity === 'warning' && /AND/.test(f.suggestion ?? ''))).toBe(
      true,
    );
  });

  it('nudges removing a leading # from a tag value', () => {
    const findings = lintQuery('tag:#project');
    expect(findings.some((f) => f.severity === 'info' && f.suggestion === 'tag:project')).toBe(
      true,
    );
  });

  it('reports an empty query as info', () => {
    expect(lintQuery('   ')).toEqual([
      { severity: 'info', message: 'empty query matches every note' },
    ]);
  });

  it('orders errors before warnings before info', () => {
    const findings = lintQuery('tg:x cats and dogs');
    const severities = findings.map((f) => f.severity);
    expect(severities.indexOf('error')).toBeLessThan(severities.lastIndexOf('warning'));
  });
});
