/**
 * Prompt regression harness tests (F1319).
 */

import { describe, expect, it } from 'vitest';
import {
  captureGoldens,
  runRegression,
  similarity,
  type RegressionCase,
} from './prompt-regression.js';

describe('similarity', () => {
  it('is 1 for identical text', () => {
    expect(similarity('the quick brown fox', 'the quick brown fox')).toBe(1);
  });

  it('is 0 for disjoint text', () => {
    expect(similarity('alpha beta', 'gamma delta')).toBe(0);
  });

  it('ignores case and punctuation', () => {
    expect(similarity('Hello, world!', 'hello world')).toBe(1);
  });

  it('penalises large length differences', () => {
    const short = 'cats';
    const long = 'cats cats cats cats cats cats dogs birds fish';
    expect(similarity(short, long)).toBeLessThan(0.5);
  });
});

describe('runRegression', () => {
  const cases: RegressionCase[] = [
    { id: 'c1', promptId: 'summarize', input: 'a', golden: 'the cat sat on the mat' },
    { id: 'c2', promptId: 'summarize', input: 'b', golden: 'birds fly south in winter' },
  ];

  it('passes when output matches the golden', async () => {
    const report = await runRegression(cases, async ({ input }) =>
      input === 'a' ? 'the cat sat on the mat' : 'birds fly south in winter',
    );
    expect(report.passed).toBe(2);
    expect(report.failed).toBe(0);
    expect(report.meanSimilarity).toBe(1);
  });

  it('fails when output drifts from the golden', async () => {
    const report = await runRegression(cases, async () => 'completely unrelated text here now');
    expect(report.failed).toBe(2);
    expect(report.results[0]?.passed).toBe(false);
  });

  it('respects a custom threshold', async () => {
    const report = await runRegression(
      [{ id: 'c', promptId: 'p', input: 'x', golden: 'the cat sat on the mat today' }],
      async () => 'the cat sat on the rug today',
      { threshold: 0.3 },
    );
    expect(report.passed).toBe(1);
  });

  it('captureGoldens pins fresh outputs', async () => {
    const pinned = await captureGoldens(
      [{ id: 'c', promptId: 'p', input: 'x' }],
      async () => 'fresh output',
    );
    expect(pinned[0]?.golden).toBe('fresh output');
  });
});
