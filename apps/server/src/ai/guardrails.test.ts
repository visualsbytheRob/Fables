/**
 * Guardrail tests (F1390) — citation tripwire (F1383), latency budgets (F1384),
 * output scope filter (F1385), and the failure taxonomy (F1388).
 */

import { describe, expect, it } from 'vitest';
import {
  checkWriteScope,
  citationCoverage,
  classifyFailure,
  LATENCY_BUDGET_MS,
  userMessageFor,
  withTimeout,
  type FailureKind,
} from './guardrails.js';

describe('citation coverage / hallucination tripwire (F1383)', () => {
  it('passes a grounded answer that cites valid sources', () => {
    const r = citationCoverage('Dragons fear iron [1] and cold [2].', 3);
    expect(r.cited).toEqual([1, 2]);
    expect(r.tripped).toBe(false);
  });

  it('trips when the answer cites nothing', () => {
    const r = citationCoverage('Dragons fear iron.', 3);
    expect(r.hasCitations).toBe(false);
    expect(r.tripped).toBe(true);
  });

  it('trips on an out-of-range (hallucinated) citation', () => {
    const r = citationCoverage('See [5].', 3);
    expect(r.invalid).toEqual([5]);
    expect(r.allValid).toBe(false);
    expect(r.tripped).toBe(true);
  });

  it('de-duplicates repeated markers', () => {
    expect(citationCoverage('[1] and again [1]', 2).cited).toEqual([1]);
  });
});

describe('latency budgets (F1384)', () => {
  it('resolves with the value when the promise beats the budget', async () => {
    const res = await withTimeout(Promise.resolve('done'), 1000);
    expect(res).toEqual({ timedOut: false, value: 'done' });
  });

  it('reports timeout for a slow promise without throwing', async () => {
    const slow = new Promise<string>((r) => setTimeout(() => r('late'), 50));
    const res = await withTimeout(slow, 1);
    expect(res).toEqual({ timedOut: true });
  });

  it('treats a rejection as a (graceful) timeout-style failure', async () => {
    const res = await withTimeout(Promise.reject(new Error('boom')), 1000);
    expect(res).toEqual({ timedOut: true });
  });

  it('has a budget for every task', () => {
    expect(LATENCY_BUDGET_MS.tags).toBeGreaterThan(0);
    expect(LATENCY_BUDGET_MS.prose).toBeGreaterThanOrEqual(LATENCY_BUDGET_MS.tags);
  });
});

describe('output scope filter (F1385)', () => {
  it('allows writes within an unrestricted scope', () => {
    expect(checkWriteScope('nb_any', {}).allowed).toBe(true);
  });

  it('allows writes to a granted notebook', () => {
    expect(checkWriteScope('nb_1', { notebookIds: new Set(['nb_1']) }).allowed).toBe(true);
  });

  it('refuses writes outside the granted scope', () => {
    const d = checkWriteScope('nb_2', { notebookIds: new Set(['nb_1']) });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/scope/);
  });
});

describe('failure taxonomy (F1388)', () => {
  it('classifies common failures', () => {
    const cases: [unknown, FailureKind][] = [
      [new Error('no AI backend available'), 'no-backend'],
      [new Error('Claude API key not configured'), 'no-backend'],
      [new Error('request timed out'), 'timeout'],
      [new Error('HTTP 429 rate limit'), 'rate-limited'],
      [new Error('invalid JSON in response'), 'schema'],
      [new Error('no journal entries — empty'), 'empty'],
      [new Error('fetch failed ECONNREFUSED'), 'network'],
      [new Error('something weird'), 'unknown'],
    ];
    for (const [err, kind] of cases) expect(classifyFailure(err)).toBe(kind);
  });

  it('gives friendly, non-empty language for every kind', () => {
    const kinds: FailureKind[] = [
      'no-backend',
      'timeout',
      'rate-limited',
      'schema',
      'empty',
      'network',
      'unknown',
    ];
    for (const k of kinds) expect(userMessageFor(k).length).toBeGreaterThan(10);
  });
});
