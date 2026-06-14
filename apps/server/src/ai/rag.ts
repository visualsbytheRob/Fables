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

import { z } from 'zod';
import type { Db } from '../db/connection.js';
import type { Note, NotebookId } from '@fables/core';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import type { IntelligenceService } from '../intelligence/index.js';
import type { SemanticSearchResult } from '../intelligence/vector-store.js';
import type { AIRuntime } from './runtime.js';
import type { AiOutcome } from './note-intelligence.js';
import { fitToBudget } from './prompt.js';
import { runStructuredTask, runTextTask } from './task-router.js';
import { TEMPLATES } from './templates.js';

/** One prior exchange in a Q&A session (F1324 conversation memory). */
export interface RagTurn {
  question: string;
  answer: string;
}

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
  /** Earlier turns in this session, oldest first (F1324). Only used for context. */
  history?: RagTurn[] | undefined;
}

/** How many prior turns to feed back as conversation context (keeps the prompt bounded). */
const MAX_HISTORY_TURNS = 4;

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

  // With prior turns, use the conversation-aware template so the model can
  // resolve references in the new question (F1324); otherwise the plain one.
  const history = (scope.history ?? []).slice(-MAX_HISTORY_TURNS);
  const answer =
    history.length > 0
      ? await runTextTask(runtime, 'qa', TEMPLATES.qaFollowUp, {
          sources: sourcesText,
          history: history.map((t) => `Q: ${t.question}\nA: ${t.answer}`).join('\n\n'),
          question,
        })
      : await runTextTask(runtime, 'qa', TEMPLATES.qaAnswer, {
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

/** Name of the notebook Q&A answers are filed under when saved (F1327). */
export const QA_HISTORY_NOTEBOOK = 'Q&A History';

/**
 * Save a Q&A exchange as a searchable note (F1327, opt-in). Files it under a
 * dedicated "Q&A History" notebook (created on first use) with the question as
 * the title and the answer + cited sources as the body, so it's findable later.
 */
export function saveQaNote(db: Db, question: string, answer: RagAnswer): Note {
  const notebooks = notebooksRepo(db);
  const existing = notebooks
    .list({ includeArchived: true })
    .find((n) => n.name === QA_HISTORY_NOTEBOOK);
  const notebookId: NotebookId = existing
    ? existing.id
    : notebooks.create({ name: QA_HISTORY_NOTEBOOK }).id;

  const sourceLines = answer.sources.map((s) => `- [${s.n}] ${s.title} (\`${s.id}\`)`);
  const body = [
    answer.answer,
    '',
    `_Confidence: ${answer.confidence}_`,
    ...(sourceLines.length > 0 ? ['', '## Sources', ...sourceLines] : []),
  ].join('\n');

  return notesRepo(db).create({
    notebookId,
    title: question.length <= 120 ? question : question.slice(0, 119) + '…',
    body,
  });
}

const followUpSchema = z.object({ questions: z.array(z.string().min(1)).max(5) });

/**
 * Suggest follow-up questions after an answer (F1328). Graceful: returns an
 * empty list rather than failing the surrounding Q&A flow if the model misbehaves.
 */
export async function suggestFollowUps(
  runtime: AIRuntime,
  question: string,
  answer: string,
): Promise<AiOutcome<{ questions: string[] }>> {
  if (!(await runtime.isAvailable())) return { available: false };
  const res = await runStructuredTask(
    runtime,
    'qa',
    TEMPLATES.followUpSuggest,
    { question, answer },
    followUpSchema,
  );
  return res.ok
    ? { available: true, ok: true, questions: res.data.questions.slice(0, 3) }
    : { available: true, ok: false, error: res.error };
}
