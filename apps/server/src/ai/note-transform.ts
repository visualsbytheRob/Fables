/**
 * Note transformation intelligence (F1334–F1338) — built on the task router.
 *
 * Every function here is *advisory*: it returns suggested text or structure and
 * never mutates a note. Applying a suggestion is an ordinary note edit made by
 * the user, which keeps every AI action undoable and clearly attributed to the
 * user's own action (F1339). Like the rest of Epic 14 they degrade gracefully —
 * `{ available: false }` when no backend is present (F1309).
 */

import { z } from 'zod';
import type { AIRuntime } from './runtime.js';
import type { AiOutcome } from './note-intelligence.js';
import { runStructuredTask, runTextTask } from './task-router.js';
import { TEMPLATES } from './templates.js';

// ── Rewrite (F1336) ──────────────────────────────────────────────────────────

export type RewriteMode = 'tighten' | 'expand' | 'formal' | 'casual' | 'simplify';

const REWRITE_INSTRUCTION: Record<RewriteMode, string> = {
  tighten: 'Make it more concise without losing meaning.',
  expand: 'Expand it with more detail, examples, and explanation.',
  formal: 'Rewrite it in a more formal, professional tone.',
  casual: 'Rewrite it in a relaxed, conversational tone.',
  simplify: 'Simplify the language so it is plain and easy to read.',
};

export const REWRITE_MODES = Object.keys(REWRITE_INSTRUCTION) as RewriteMode[];

/** Rewrite a passage in a chosen mode (F1336). */
export async function rewriteText(
  runtime: AIRuntime,
  body: string,
  mode: RewriteMode,
): Promise<AiOutcome<{ text: string }>> {
  if (!(await runtime.isAvailable())) return { available: false };
  const text = await runTextTask(runtime, 'prose', TEMPLATES.rewrite, {
    instruction: REWRITE_INSTRUCTION[mode],
    body,
  });
  return { available: true, ok: true, text };
}

// ── Outline (F1335) ──────────────────────────────────────────────────────────

/** Organise messy notes into a hierarchical markdown outline (F1335). */
export async function outlineNote(
  runtime: AIRuntime,
  body: string,
): Promise<AiOutcome<{ outline: string }>> {
  if (!(await runtime.isAvailable())) return { available: false };
  const outline = await runTextTask(runtime, 'summary', TEMPLATES.outline, { body });
  return { available: true, ok: true, outline };
}

// ── Meeting structurer (F1337) ───────────────────────────────────────────────

export interface MeetingAction {
  task: string;
  owner: string;
}

const meetingSchema = z.object({
  summary: z.string(),
  decisions: z.array(z.string()).max(30),
  actions: z.array(z.object({ task: z.string().min(1), owner: z.string() })).max(30),
});

/** Extract a summary, decisions, and action items from meeting notes (F1337). */
export async function structureMeeting(
  runtime: AIRuntime,
  body: string,
): Promise<AiOutcome<{ summary: string; decisions: string[]; actions: MeetingAction[] }>> {
  if (!(await runtime.isAvailable())) return { available: false };
  const res = await runStructuredTask(
    runtime,
    'summary',
    TEMPLATES.meetingStructure,
    { body },
    meetingSchema,
  );
  return res.ok
    ? {
        available: true,
        ok: true,
        summary: res.data.summary,
        decisions: res.data.decisions,
        actions: res.data.actions,
      }
    : { available: true, ok: false, error: res.error };
}

// ── Weekly review (F1338) ────────────────────────────────────────────────────

/** Draft a weekly review from this week's journal entries (F1338). */
export async function weeklyReview(
  runtime: AIRuntime,
  entries: string[],
): Promise<AiOutcome<{ review: string }>> {
  if (!(await runtime.isAvailable())) return { available: false };
  if (entries.length === 0) {
    return { available: true, ok: false, error: 'no journal entries this week' };
  }
  const review = await runTextTask(runtime, 'prose', TEMPLATES.weeklyReview, {
    body: entries.map((e, i) => `Entry ${i + 1}:\n${e}`).join('\n\n'),
  });
  return { available: true, ok: true, review };
}

// ── Link suggestions (F1334) ─────────────────────────────────────────────────

export interface LinkCandidate {
  id: string;
  title: string;
}

export interface LinkSuggestion {
  phrase: string;
  target: string;
  targetId: string;
}

const linksSchema = z.object({
  links: z.array(z.object({ phrase: z.string().min(1), target: z.string().min(1) })).max(30),
});

/**
 * Suggest wikilinks from a note to the supplied candidate notes (F1334). The
 * model may only propose targets drawn from `candidates`; any hallucinated title
 * is dropped, and each accepted suggestion carries the real target note id so the
 * UI can insert a resolvable wikilink.
 */
export async function suggestLinks(
  runtime: AIRuntime,
  body: string,
  candidates: LinkCandidate[],
): Promise<AiOutcome<{ links: LinkSuggestion[] }>> {
  if (!(await runtime.isAvailable())) return { available: false };
  if (candidates.length === 0) return { available: true, ok: true, links: [] };

  const res = await runStructuredTask(
    runtime,
    'tags',
    TEMPLATES.linkSuggest,
    { body, candidates: candidates.map((c) => `- ${c.title}`).join('\n') },
    linksSchema,
  );
  if (!res.ok) return { available: true, ok: false, error: res.error };

  // Resolve each suggested target back to a real candidate (case-insensitive),
  // discarding any the model invented. This is the anti-hallucination guard.
  const byTitle = new Map(candidates.map((c) => [c.title.toLowerCase(), c]));
  const links: LinkSuggestion[] = [];
  const seen = new Set<string>();
  for (const l of res.data.links) {
    const match = byTitle.get(l.target.toLowerCase());
    if (!match) continue;
    const key = `${l.phrase}→${match.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ phrase: l.phrase, target: match.title, targetId: match.id });
  }
  return { available: true, ok: true, links };
}
