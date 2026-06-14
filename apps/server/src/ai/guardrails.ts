/**
 * AI guardrails (F1383–F1385, F1388) — pure safety checks layered around the
 * model. None of these call a model; they constrain and classify what the model
 * produced, so they're cheap and exhaustively testable.
 *
 *   F1383  Hallucination tripwire: citation-coverage check for grounded answers.
 *   F1384  Latency budgets per feature, with a graceful timeout wrapper.
 *   F1385  Output scope filter: AI writes never escape the granted scope.
 *   F1388  Failure taxonomy + user-facing error language.
 */

import type { AiTask } from './prompt.js';

// ── Citation coverage / hallucination tripwire (F1383) ───────────────────────

export interface CitationReport {
  /** Distinct [n] markers found in the answer. */
  cited: number[];
  /** Cited markers that point outside 1..sourceCount (hallucinated references). */
  invalid: number[];
  hasCitations: boolean;
  allValid: boolean;
  /**
   * True when the tripwire fires: a grounded answer that either cites nothing or
   * cites a source that doesn't exist. Callers should withhold/flag such answers.
   */
  tripped: boolean;
}

/**
 * Check that a grounded answer's [n] citations all resolve to a real source
 * (F1383). A grounded answer with zero citations, or any out-of-range citation,
 * trips the wire — a strong signal the model went off its sources.
 */
export function citationCoverage(answer: string, sourceCount: number): CitationReport {
  const cited = [...answer.matchAll(/\[(\d+)\]/g)]
    .map((m) => Number(m[1]))
    .filter((n, i, arr) => arr.indexOf(n) === i);
  const invalid = cited.filter((n) => n < 1 || n > sourceCount);
  const hasCitations = cited.length > 0;
  const allValid = invalid.length === 0;
  return {
    cited,
    invalid,
    hasCitations,
    allValid,
    tripped: !hasCitations || !allValid,
  };
}

// ── Latency budgets (F1384) ──────────────────────────────────────────────────

/** Per-task soft latency budget in ms — the UX shows a timeout affordance past this. */
export const LATENCY_BUDGET_MS: Record<AiTask, number> = {
  tags: 8_000,
  title: 8_000,
  summary: 20_000,
  qa: 30_000,
  prose: 60_000,
  dialogue: 60_000,
};

export type TimeoutResult<T> = { timedOut: false; value: T } | { timedOut: true };

/**
 * Race a promise against a budget (F1384). On timeout it resolves
 * `{ timedOut: true }` rather than throwing, so the feature can degrade to a
 * "still working… / try a faster model" UX instead of an error. The timer is
 * cleared on settle so tests don't leak handles.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<TimeoutResult<T>> {
  return new Promise<TimeoutResult<T>>((resolve) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve({ timedOut: false, value });
      },
      () => {
        clearTimeout(timer);
        resolve({ timedOut: true });
      },
    );
  });
}

// ── Output scope filter (F1385) ──────────────────────────────────────────────

export interface WriteScope {
  /** Notebook ids the AI action is permitted to write to. Empty = unrestricted. */
  notebookIds?: ReadonlySet<string> | undefined;
}

export interface ScopeDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Decide whether an AI-produced write may target a notebook (F1385). When a scope
 * lists notebooks, writes outside it are refused — an AI action can never reach
 * beyond the area the user granted it.
 */
export function checkWriteScope(targetNotebookId: string, scope: WriteScope): ScopeDecision {
  if (!scope.notebookIds || scope.notebookIds.size === 0) return { allowed: true };
  return scope.notebookIds.has(targetNotebookId)
    ? { allowed: true }
    : { allowed: false, reason: 'target notebook is outside the granted scope' };
}

// ── Failure taxonomy (F1388) ─────────────────────────────────────────────────

export type FailureKind =
  | 'no-backend'
  | 'timeout'
  | 'rate-limited'
  | 'schema'
  | 'empty'
  | 'network'
  | 'unknown';

/** Map a thrown error / error string to a failure kind (F1388). */
export function classifyFailure(err: unknown): FailureKind {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes('no ai backend') || msg.includes('not configured')) return 'no-backend';
  if (msg.includes('timed out') || msg.includes('timeout')) return 'timeout';
  if (msg.includes('429') || msg.includes('rate limit')) return 'rate-limited';
  if (msg.includes('json') || msg.includes('schema')) return 'schema';
  if (msg.includes('empty')) return 'empty';
  if (msg.includes('fetch') || msg.includes('network') || msg.includes('econn')) return 'network';
  return 'unknown';
}

/** Calm, non-alarming, actionable language for each failure kind (F1388). */
export function userMessageFor(kind: FailureKind): string {
  switch (kind) {
    case 'no-backend':
      return 'No AI model is set up yet. Install a local model or add a cloud key in AI settings.';
    case 'timeout':
      return 'That took too long. Try a smaller/faster model, or a shorter input.';
    case 'rate-limited':
      return 'The AI service is busy right now. Give it a moment and try again.';
    case 'schema':
      return "The model's reply wasn't in the expected format. Try again, or pick another model.";
    case 'empty':
      return 'There was nothing to work with for that action.';
    case 'network':
      return "Couldn't reach the AI service. Check your connection and try again.";
    case 'unknown':
      return 'Something went wrong with that AI action. Please try again.';
  }
}
