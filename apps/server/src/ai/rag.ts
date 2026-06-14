/**
 * Ask-your-vault RAG pipeline (F1321 retrieval→grounded answer, F1322 citations,
 * F1325 confidence signal, F1326 honest no-sources refusal).
 *
 * The pipeline is deliberately conservative:
 *   1. Retrieve the top-k sources with the Tier-1 hybrid/semantic search.
 *   2. If nothing clears the relevance floor, REFUSE without calling the model —
 *      an honest "I don't have that" beats a confident hallucination (F1326).
 *   3. Otherwise build a numbered, budget-fitted sources block and ask the model
 *      to answer using ONLY those sources, citing them by their [n] markers
 *      (F1322). The caller renders each [n] as a link to the source note.
 *
 * Like the rest of Epic 14 it degrades gracefully: with no AI backend it returns
 * `{ available: false }` so the UI hides the feature (F1309).
 */

import type { Db } from '../db/connection.js';
import type { IntelligenceService } from '../intelligence/index.js';
import type { SemanticSearchResult } from '../intelligence/vector-store.js';
import type { AIRuntime } from './runtime.js';
import type { AiOutcome } from './note-intelligence.js';
import { fitToBudget } from './prompt.js';
import { runTextTask } from './task-router.js';
import { TEMPLATES } from './templates.js';

/** A retrieved source, numbered so the answer's [n] citations resolve to it. */
export interface RagSource {
  /** 1-based citation marker used in the answer ([1], [2], …). */
  n: number;
  id: string;
  title: string;
  sourceType: string;
  /** Normalised retrieval similarity [0,1]. */
  score: number;
}

/** Coverage-based confidence in the answer (F1325). */
export type RagConfidence = 'high' | 'medium' | 'low' | 'none';

export interface RagAnswer {
  answer: string;
  sources: RagSource[];
  confidence: RagConfidence;
  /** False when we refused for lack of sources (F1326) — answer is the refusal. */
  grounded: boolean;
}

export interface RagScope {
  /** Restrict retrieval to a single notebook (F1323 scope). */
  notebookId?: string | undefined;
  /** Max sources to retrieve (default 6). */
  limit?: number | undefined;
  /** Relevance floor; below this a source is treated as no match (default 0.5). */
  minScore?: number | undefined;
}

const DEFAULT_LIMIT = 6;
const DEFAULT_MIN_SCORE = 0.5;
/** Conservative window for the sources block; reserves room for Q + reply. */
const SOURCES_TOKEN_BUDGET = 3000;
const SOURCES_TOKEN_RESERVE = 600;
/** Per-source body cap before budgeting — keeps any one note from crowding out the rest. */
const PER_SOURCE_CHARS = 800;

const REFUSAL =
  "I couldn't find anything in your vault that answers that. Try rephrasing the " +
  'question, or add a note on the topic and ask again.';

/**
 * Answer a question grounded in the vault. Returns the answer plus the numbered
 * sources its [n] citations refer to.
 */
export async function ragAnswer(
  runtime: AIRuntime,
  intel: IntelligenceService,
  db: Db,
  question: string,
  scope: RagScope = {},
): Promise<AiOutcome<RagAnswer>> {
  if (!(await runtime.isAvailable())) return { available: false };

  const limit = scope.limit ?? DEFAULT_LIMIT;
  const minScore = scope.minScore ?? DEFAULT_MIN_SCORE;

  const hits = await intel.store.search(question, {
    limit,
    minScore,
    ...(scope.notebookId !== undefined ? { notebookId: scope.notebookId } : {}),
  });

  // F1326: nothing relevant enough → refuse honestly, never call the model.
  if (hits.length === 0) {
    return {
      available: true,
      ok: true,
      answer: REFUSAL,
      sources: [],
      confidence: 'none',
      grounded: false,
    };
  }

  const sources: RagSource[] = hits.map((h, i) => ({
    n: i + 1,
    id: h.id,
    title: h.title || '(untitled)',
    sourceType: h.sourceType,
    score: h.score,
  }));

  // Build the numbered grounding block, fitting it to the context budget (F1312).
  const items = hits.map((h, i) => ({
    id: String(i + 1),
    text: `[${i + 1}] ${h.title || '(untitled)'}\n${sourceBody(db, h)}`,
  }));
  const { included } = fitToBudget(items, SOURCES_TOKEN_BUDGET, SOURCES_TOKEN_RESERVE);
  // Always include at least the top source even if it alone exceeds the budget.
  const blocks = included.length > 0 ? included : items.slice(0, 1);
  const sourcesText = blocks.map((b) => b.text).join('\n\n');

  const answer = await runTextTask(runtime, 'qa', TEMPLATES.qaAnswer, {
    sources: sourcesText,
    question,
  });

  return {
    available: true,
    ok: true,
    answer,
    sources,
    confidence: confidenceFrom(hits),
    grounded: true,
  };
}

/** Full note body for grounding (falls back to the search snippet for other types). */
function sourceBody(db: Db, hit: SemanticSearchResult): string {
  if (hit.sourceType === 'note') {
    const row = db.prepare('SELECT body FROM notes WHERE id = ?').get(hit.id) as
      | { body: string }
      | undefined;
    if (row) return truncate(row.body, PER_SOURCE_CHARS);
  }
  return hit.snippet;
}

/**
 * Retrieval-coverage confidence (F1325): driven by the best match's strength and
 * the breadth of corroborating sources. A single weak hit is `low`; several
 * strong hits are `high`.
 */
function confidenceFrom(hits: SemanticSearchResult[]): RagConfidence {
  if (hits.length === 0) return 'none';
  const top = hits[0]!.score;
  const strong = hits.filter((h) => h.score >= 0.7).length;
  if (top >= 0.8 && strong >= 2) return 'high';
  if (top >= 0.7) return 'medium';
  return 'low';
}

function truncate(text: string, maxLen: number): string {
  const trimmed = text.trim();
  return trimmed.length <= maxLen ? trimmed : trimmed.slice(0, maxLen - 1) + '…';
}
