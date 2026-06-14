/**
 * Eval-harness tests (F1390) — scoring (F1381), comparison report (F1387), run
 * record (F1389) — plus the quality gate (F1382): features stay graceful under a
 * weak/garbage model, and the privacy assertion (F1386): local AI ops make zero
 * network calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toModelInfo } from './model-registry.js';
import { AIRuntime } from './runtime.js';
import { renderComparisonReport, runEvalSet, toRunRecord, type EvalCase } from './eval.js';
import { summarizeNote, suggestTags } from './note-intelligence.js';
import type {
  GenerateRequest,
  GenerateResponse,
  LanguageModelAdapter,
  ModelInfo,
} from './adapter.js';

class MockAdapter implements LanguageModelAdapter {
  readonly name = 'mock';
  constructor(private readonly reply: (req: GenerateRequest) => string) {}
  async isAvailable() {
    return true;
  }
  async listModels(): Promise<ModelInfo[]> {
    return [toModelInfo('llama3.1:8b')];
  }
  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    return { text: this.reply(req), model: req.model ?? 'mock' };
  }
}

const cases: EvalCase[] = [
  {
    id: 'echo-hello',
    suite: 'demo',
    run: async (rt) => (await rt.generate({ prompt: 'x' })).text,
    score: (out) => (String(out).includes('hello') ? 1 : 0),
  },
  {
    id: 'echo-length',
    suite: 'demo',
    run: async (rt) => (await rt.generate({ prompt: 'x' })).text,
    score: (out) => (String(out).length > 0 ? 1 : 0),
  },
];

describe('eval harness (F1381/F1387/F1389)', () => {
  it('scores cases and summarises pass rate', async () => {
    const rt = new AIRuntime().register(new MockAdapter(() => 'hello world'));
    const summary = await runEvalSet(rt, cases);
    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(2);
    expect(summary.meanScore).toBe(1);
  });

  it('records a failing case without throwing', async () => {
    const rt = new AIRuntime().register(new MockAdapter(() => 'goodbye'));
    const summary = await runEvalSet(rt, cases);
    // 'echo-hello' fails (no "hello"), 'echo-length' passes.
    expect(summary.passed).toBe(1);
    expect(summary.results.find((r) => r.id === 'echo-hello')!.passed).toBe(false);
  });

  it('captures thrown errors as score 0', async () => {
    const rt = new AIRuntime(); // no backend → generate throws
    const summary = await runEvalSet(rt, cases);
    expect(summary.passed).toBe(0);
    expect(summary.results[0]!.error).toBeTruthy();
  });

  it('renders a comparison report sorted by mean score (F1387)', () => {
    const report = renderComparisonReport('demo', [
      { model: 'weak', summary: { total: 2, passed: 1, meanScore: 0.5, results: [] } },
      { model: 'strong', summary: { total: 2, passed: 2, meanScore: 1, results: [] } },
    ]);
    expect(report).toContain('| Model |');
    // 'strong' (higher mean) appears before 'weak'.
    expect(report.indexOf('strong')).toBeLessThan(report.indexOf('weak'));
  });

  it('builds a compact run record (F1389)', () => {
    const rec = toRunRecord(
      'demo',
      'llama3.1:8b',
      { total: 3, passed: 2, meanScore: 0.6667, results: [] },
      new Date('2026-06-14T00:00:00Z'),
    );
    expect(rec).toMatchObject({ suite: 'demo', model: 'llama3.1:8b', passed: 2, total: 3 });
    expect(rec.timestamp).toBe('2026-06-14T00:00:00.000Z');
  });
});

describe('quality gate: graceful under a weak/garbage model (F1382)', () => {
  it('structured tasks return ok:false rather than throwing on garbage output', async () => {
    const rt = new AIRuntime().register(
      new MockAdapter(() => 'not json at all, totally unparseable'),
    );
    const tags = await suggestTags(rt, { title: 't', body: 'b' });
    expect(tags.available).toBe(true);
    if (!tags.available) throw new Error('unreachable');
    expect(tags.ok).toBe(false); // degraded, not crashed
  });

  it('free-text tasks still return a value under a weak model', async () => {
    const rt = new AIRuntime().register(new MockAdapter(() => 'ok'));
    const sum = await summarizeNote(rt, { title: 't', body: 'b' });
    expect(sum.available).toBe(true);
  });
});

describe('privacy assertion: zero network egress for local AI ops (F1386)', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a local (mock-backend) summarize makes no fetch calls', async () => {
    const rt = new AIRuntime().register(new MockAdapter(() => 'a local summary'));
    const res = await summarizeNote(rt, { title: 't', body: 'b' });
    expect(res.available).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
