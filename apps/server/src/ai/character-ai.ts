/**
 * Character & dialogue AI (F1351–F1358) — entity-grounded creative assists built
 * on the task router. Everything is grounded in author-supplied character sheets,
 * facts, and world descriptions; the model is consistently instructed never to
 * invent facts, so suggestions stay anchored to the established world. Advisory
 * and undoable like the rest of Epic 14, and graceful (`{ available: false }`)
 * when no backend is present (F1309).
 */

import { z } from 'zod';
import type { AIRuntime } from './runtime.js';
import type { AiOutcome } from './note-intelligence.js';
import { runStructuredTask, runTextTask } from './task-router.js';
import { TEMPLATES } from './templates.js';

// ── Entity-grounded dialogue (F1351) ─────────────────────────────────────────

/** Generate dialogue consistent with a character sheet (F1351). */
export async function generateDialogue(
  runtime: AIRuntime,
  sheet: string,
  situation: string,
): Promise<AiOutcome<{ dialogue: string }>> {
  if (!(await runtime.isAvailable())) return { available: false };
  const dialogue = await runTextTask(runtime, 'dialogue', TEMPLATES.dialogueGen, {
    sheet,
    situation,
  });
  return { available: true, ok: true, dialogue };
}

// ── Voice cards (F1352) ──────────────────────────────────────────────────────

export interface VoiceCard {
  register: string;
  quirks: string[];
  vocabulary: string[];
  catchphrases: string[];
}

const voiceCardSchema = z.object({
  register: z.string().min(1),
  quirks: z.array(z.string()).max(12),
  vocabulary: z.array(z.string()).max(20),
  catchphrases: z.array(z.string()).max(12),
});

/** Distil a reusable voice card from a character's sample lines (F1352). */
export async function buildVoiceCard(
  runtime: AIRuntime,
  name: string,
  lines: string,
): Promise<AiOutcome<VoiceCard>> {
  if (!(await runtime.isAvailable())) return { available: false };
  const res = await runStructuredTask(
    runtime,
    'tags',
    TEMPLATES.voiceCard,
    { name, lines },
    voiceCardSchema,
  );
  return res.ok
    ? { available: true, ok: true, ...res.data }
    : { available: true, ok: false, error: res.error };
}

// ── Dialogue polish (F1353) ──────────────────────────────────────────────────

/** Tighten dialogue for subtext and brevity (F1353). */
export async function polishDialogue(
  runtime: AIRuntime,
  dialogue: string,
): Promise<AiOutcome<{ dialogue: string }>> {
  if (!(await runtime.isAvailable())) return { available: false };
  const polished = await runTextTask(runtime, 'prose', TEMPLATES.dialoguePolish, { dialogue });
  return { available: true, ok: true, dialogue: polished };
}

// ── NPC interview mode (F1354) ───────────────────────────────────────────────

export interface InterviewTurn {
  question: string;
  answer: string;
}

/**
 * One turn of interviewing a character in-voice (F1354). The author chats with
 * the NPC to develop them; prior turns are carried for continuity.
 */
export async function interviewCharacter(
  runtime: AIRuntime,
  sheet: string,
  question: string,
  history: InterviewTurn[] = [],
): Promise<AiOutcome<{ answer: string }>> {
  if (!(await runtime.isAvailable())) return { available: false };
  const historyText =
    history.length > 0
      ? history.map((t) => `Author: ${t.question}\n${t.answer}`).join('\n\n')
      : '(start of conversation)';
  const answer = await runTextTask(runtime, 'dialogue', TEMPLATES.npcInterview, {
    sheet,
    history: historyText,
    question,
  });
  return { available: true, ok: true, answer };
}

// ── Interview → fact extraction (F1355) ──────────────────────────────────────

const factsSchema = z.object({ facts: z.array(z.string().min(1)).max(40) });

/** Extract durable character facts from an interview transcript (F1355). */
export async function extractFacts(
  runtime: AIRuntime,
  transcript: string,
): Promise<AiOutcome<{ facts: string[] }>> {
  if (!(await runtime.isAvailable())) return { available: false };
  const res = await runStructuredTask(
    runtime,
    'tags',
    TEMPLATES.factExtract,
    { transcript },
    factsSchema,
  );
  return res.ok
    ? { available: true, ok: true, facts: res.data.facts }
    : { available: true, ok: false, error: res.error };
}

// ── Relationship dynamics (F1356) ────────────────────────────────────────────

export interface RelationshipDynamic {
  between: string;
  dynamic: string;
}

const dynamicsSchema = z.object({
  dynamics: z.array(z.object({ between: z.string().min(1), dynamic: z.string().min(1) })).max(30),
});

/** Suggest relationship dynamics from an entity-graph description (F1356). */
export async function suggestRelationshipDynamics(
  runtime: AIRuntime,
  graph: string,
): Promise<AiOutcome<{ dynamics: RelationshipDynamic[] }>> {
  if (!(await runtime.isAvailable())) return { available: false };
  const res = await runStructuredTask(
    runtime,
    'prose',
    TEMPLATES.relationshipDynamics,
    { graph },
    dynamicsSchema,
  );
  return res.ok
    ? { available: true, ok: true, dynamics: res.data.dynamics }
    : { available: true, ok: false, error: res.error };
}

// ── World-consistent name generation (F1357) ─────────────────────────────────

const namesSchema = z.object({ names: z.array(z.string().min(1)).max(30) });

/** Generate names that fit the world's linguistic feel (F1357). */
export async function generateNames(
  runtime: AIRuntime,
  world: string,
  kind: string,
): Promise<AiOutcome<{ names: string[] }>> {
  if (!(await runtime.isAvailable())) return { available: false };
  const res = await runStructuredTask(
    runtime,
    'prose',
    TEMPLATES.nameGen,
    { world, kind },
    namesSchema,
  );
  return res.ok
    ? { available: true, ok: true, names: res.data.names }
    : { available: true, ok: false, error: res.error };
}

// ── Character arc tracker (F1358) ────────────────────────────────────────────

const arcSchema = z.object({
  summary: z.string().min(1),
  turningPoints: z.array(z.string().min(1)).max(20),
});

/** Summarise a character's arc and turning points across scenes/branches (F1358). */
export async function trackArc(
  runtime: AIRuntime,
  name: string,
  scenes: string,
): Promise<AiOutcome<{ summary: string; turningPoints: string[] }>> {
  if (!(await runtime.isAvailable())) return { available: false };
  const res = await runStructuredTask(
    runtime,
    'summary',
    TEMPLATES.arcTracker,
    { name, scenes },
    arcSchema,
  );
  return res.ok
    ? {
        available: true,
        ok: true,
        summary: res.data.summary,
        turningPoints: res.data.turningPoints,
      }
    : { available: true, ok: false, error: res.error };
}
