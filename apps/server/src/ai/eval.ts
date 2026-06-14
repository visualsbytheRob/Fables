/**
 * AI evaluation harness (F1381, F1387, F1389).
 *
 * A tiny, dependency-free harness: an eval set is a list of cases, each of which
 * runs something against an AIRuntime and scores the result in [0,1]. The harness
 * runs a set against one or more models, summarises pass rates, renders a
 * model-comparison report (F1387), and serialises a run record for tracking
 * results in-repo over time (F1389). The CLI wrapper (scripts/ai-eval) feeds
 * configured models in; this module is the engine and is fully unit-testable.
 */

import type { AIRuntime } from './runtime.js';

export interface EvalCase {
  id: string;
  /** Optional grouping (e.g. 'rag', 'dialogue'). */
  suite?: string;
  /** Produce an output for this case using the runtime. */
  run(runtime: AIRuntime): Promise<unknown>;
  /** Score the output in [0,1]; 1 is a perfect pass. */
  score(output: unknown): number;
  /** Score at/above which the case counts as passed (default 1). */
  passThreshold?: number;
}

export interface CaseResult {
  id: string;
  suite: string | undefined;
  score: number;
  passed: boolean;
  error?: string;
}

export interface EvalSummary {
  total: number;
  passed: number;
  meanScore: number;
  results: CaseResult[];
}

/** Run an eval set against a runtime, scoring each case (F1381). */
export async function runEvalSet(runtime: AIRuntime, cases: EvalCase[]): Promise<EvalSummary> {
  const results: CaseResult[] = [];
  for (const c of cases) {
    const threshold = c.passThreshold ?? 1;
    try {
      const output = await c.run(runtime);
      const score = clamp01(c.score(output));
      results.push({ id: c.id, suite: c.suite, score, passed: score >= threshold });
    } catch (e) {
      results.push({
        id: c.id,
        suite: c.suite,
        score: 0,
        passed: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const passed = results.filter((r) => r.passed).length;
  const meanScore =
    results.length === 0 ? 0 : results.reduce((s, r) => s + r.score, 0) / results.length;
  return { total: results.length, passed, meanScore, results };
}

export interface ModelEval {
  model: string;
  summary: EvalSummary;
}

/** Render a markdown model-comparison report (F1387). */
export function renderComparisonReport(suiteName: string, evals: ModelEval[]): string {
  const lines: string[] = [
    `# AI eval — ${suiteName}`,
    '',
    '| Model | Passed | Total | Pass rate | Mean score |',
    '| --- | ---: | ---: | ---: | ---: |',
  ];
  for (const e of [...evals].sort((a, b) => b.summary.meanScore - a.summary.meanScore)) {
    const { passed, total, meanScore } = e.summary;
    const rate = total === 0 ? 0 : passed / total;
    lines.push(`| ${e.model} | ${passed} | ${total} | ${pct(rate)} | ${meanScore.toFixed(2)} |`);
  }
  return lines.join('\n') + '\n';
}

export interface EvalRunRecord {
  timestamp: string;
  suite: string;
  model: string;
  total: number;
  passed: number;
  meanScore: number;
}

/** Build a compact, append-only run record for in-repo tracking (F1389). */
export function toRunRecord(
  suite: string,
  model: string,
  summary: EvalSummary,
  when = new Date(),
): EvalRunRecord {
  return {
    timestamp: when.toISOString(),
    suite,
    model,
    total: summary.total,
    passed: summary.passed,
    meanScore: Number(summary.meanScore.toFixed(4)),
  };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
