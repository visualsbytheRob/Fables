/**
 * Prompt regression harness (F1319).
 *
 * Pins prompt behaviour with golden outputs: a set of cases (prompt id + input +
 * expected output) is run through a generate function, and each result is scored
 * against its golden by normalised token overlap. A case passes when similarity
 * clears a threshold. Pure — the generate function is injected, so the harness
 * runs against a mock in tests and the real runtime in production.
 */

export interface RegressionCase {
  id: string;
  /** The prompt template / feature under test. */
  promptId: string;
  input: string;
  /** The pinned expected output. */
  golden: string;
}

export interface CaseResult {
  id: string;
  promptId: string;
  output: string;
  golden: string;
  similarity: number;
  passed: boolean;
}

export interface RegressionReport {
  results: CaseResult[];
  passed: number;
  failed: number;
  total: number;
  /** Mean similarity across all cases. */
  meanSimilarity: number;
}

export type GenerateFn = (caseInput: { promptId: string; input: string }) => Promise<string>;

/** Normalise text for comparison: lowercase, collapse whitespace, strip punctuation. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Similarity in [0,1] — token-level Jaccard with a length-ratio penalty so a
 * much longer or shorter answer can't score perfectly on overlap alone.
 */
export function similarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length === 0 && tb.length === 0) return 1;
  if (ta.length === 0 || tb.length === 0) return 0;
  const setA = new Set(ta);
  const setB = new Set(tb);
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection += 1;
  const union = new Set([...setA, ...setB]).size;
  const jaccard = intersection / union;
  const lengthRatio = Math.min(ta.length, tb.length) / Math.max(ta.length, tb.length);
  return jaccard * lengthRatio;
}

export interface RegressionOptions {
  /** Pass threshold for similarity, default 0.8. */
  threshold?: number;
}

/** Run every case through `generate` and score against its golden. */
export async function runRegression(
  cases: RegressionCase[],
  generate: GenerateFn,
  opts: RegressionOptions = {},
): Promise<RegressionReport> {
  const threshold = opts.threshold ?? 0.8;
  const results: CaseResult[] = [];

  for (const c of cases) {
    const output = await generate({ promptId: c.promptId, input: c.input });
    const sim = similarity(output, c.golden);
    results.push({
      id: c.id,
      promptId: c.promptId,
      output,
      golden: c.golden,
      similarity: sim,
      passed: sim >= threshold,
    });
  }

  const passed = results.filter((r) => r.passed).length;
  const meanSimilarity =
    results.length === 0 ? 1 : results.reduce((sum, r) => sum + r.similarity, 0) / results.length;

  return {
    results,
    passed,
    failed: results.length - passed,
    total: results.length,
    meanSimilarity,
  };
}

/** Re-pin goldens from fresh outputs (operator action when a change is intended). */
export async function captureGoldens(
  cases: Pick<RegressionCase, 'id' | 'promptId' | 'input'>[],
  generate: GenerateFn,
): Promise<RegressionCase[]> {
  const out: RegressionCase[] = [];
  for (const c of cases) {
    out.push({ ...c, golden: await generate({ promptId: c.promptId, input: c.input }) });
  }
  return out;
}
