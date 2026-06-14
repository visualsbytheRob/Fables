/**
 * Story co-writer (F1341–F1346, F1348) — creative AI assists for the author
 * workspace, built on the task router. Every function is *advisory*: it returns
 * suggestions or draft text and never edits the story. The author accepts a
 * suggestion as a normal edit, so AI contributions stay undoable and attributable
 * (the same discipline as note intelligence). All generative output can be tagged
 * with a provenance marker (F1348) so AI-drafted source is visible at a glance.
 *
 * Graceful: `{ available: false }` when no backend is present (F1309).
 */

import { z } from 'zod';
import type { AIRuntime } from './runtime.js';
import type { AiOutcome } from './note-intelligence.js';
import { runStructuredTask, runTextTask } from './task-router.js';
import { TEMPLATES } from './templates.js';

/** Optional captured style, formatted as a leading guidance block for prompts. */
export interface StyleGuidance {
  tone: string;
  traits: string[];
}

function styleBlock(style?: StyleGuidance): string {
  if (!style) return '';
  const traits = style.traits.length > 0 ? ` Traits: ${style.traits.join(', ')}.` : '';
  return `Style guidance — tone: ${style.tone}.${traits}\n\n`;
}

// ── Beat suggestions (F1341) ─────────────────────────────────────────────────

const beatsSchema = z.object({ beats: z.array(z.string().min(1)).max(8) });

/** Propose possible next beats from the current scene (F1341). */
export async function suggestBeats(
  runtime: AIRuntime,
  scene: string,
  style?: StyleGuidance,
): Promise<AiOutcome<{ beats: string[] }>> {
  if (!(await runtime.isAvailable())) return { available: false };
  const res = await runStructuredTask(
    runtime,
    'prose',
    TEMPLATES.beatSuggest,
    { style: styleBlock(style), scene },
    beatsSchema,
  );
  return res.ok
    ? { available: true, ok: true, beats: res.data.beats }
    : { available: true, ok: false, error: res.error };
}

// ── Choice expansion (F1342) ─────────────────────────────────────────────────

const choicesSchema = z.object({ choices: z.array(z.string().min(1)).max(6) });

/** Draft a set of in-voice player choices for a scene (F1342). */
export async function expandChoices(
  runtime: AIRuntime,
  scene: string,
  style?: StyleGuidance,
): Promise<AiOutcome<{ choices: string[] }>> {
  if (!(await runtime.isAvailable())) return { available: false };
  const res = await runStructuredTask(
    runtime,
    'dialogue',
    TEMPLATES.choiceExpand,
    { style: styleBlock(style), scene },
    choicesSchema,
  );
  return res.ok
    ? { available: true, ok: true, choices: res.data.choices }
    : { available: true, ok: false, error: res.error };
}

// ── Scene prose draft (F1343) ────────────────────────────────────────────────

/** Expand an outline into scene prose, honouring captured style (F1343). */
export async function draftScene(
  runtime: AIRuntime,
  outline: string,
  style?: StyleGuidance,
): Promise<AiOutcome<{ prose: string }>> {
  if (!(await runtime.isAvailable())) return { available: false };
  const prose = await runTextTask(runtime, 'prose', TEMPLATES.sceneDraft, {
    style: styleBlock(style),
    outline,
  });
  return { available: true, ok: true, prose };
}

// ── Style capture (F1344) ────────────────────────────────────────────────────

const styleSchema = z.object({
  tone: z.string().min(1),
  traits: z.array(z.string().min(1)).max(8),
});

/** Learn an author's style from a prose sample (F1344). */
export async function captureStyle(
  runtime: AIRuntime,
  sample: string,
): Promise<AiOutcome<StyleGuidance>> {
  if (!(await runtime.isAvailable())) return { available: false };
  const res = await runStructuredTask(
    runtime,
    'tags',
    TEMPLATES.styleCapture,
    { sample },
    styleSchema,
  );
  return res.ok
    ? { available: true, ok: true, tone: res.data.tone, traits: res.data.traits }
    : { available: true, ok: false, error: res.error };
}

// ── Consistency checker (F1345) ──────────────────────────────────────────────

export type IssueSeverity = 'low' | 'medium' | 'high';

export interface ConsistencyIssue {
  claim: string;
  conflict: string;
  severity: IssueSeverity;
}

const issuesSchema = z.object({
  issues: z
    .array(
      z.object({
        claim: z.string().min(1),
        conflict: z.string().min(1),
        severity: z.enum(['low', 'medium', 'high']),
      }),
    )
    .max(30),
});

/**
 * Check a scene against established entity facts for contradictions (F1345).
 * Facts are supplied by the caller (e.g. from the entity codex), keeping the
 * check grounded — the model is told never to invent facts.
 */
export async function checkConsistency(
  runtime: AIRuntime,
  scene: string,
  facts: string[],
): Promise<AiOutcome<{ issues: ConsistencyIssue[] }>> {
  if (!(await runtime.isAvailable())) return { available: false };
  if (facts.length === 0) return { available: true, ok: true, issues: [] };
  const res = await runStructuredTask(
    runtime,
    'qa',
    TEMPLATES.consistencyCheck,
    { facts: facts.map((f) => `- ${f}`).join('\n'), scene },
    issuesSchema,
  );
  return res.ok
    ? { available: true, ok: true, issues: res.data.issues }
    : { available: true, ok: false, error: res.error };
}

// ── Branch gap analysis (F1346) ──────────────────────────────────────────────

const suggestionsSchema = z.object({ suggestions: z.array(z.string().min(1)).max(8) });

/** Suggest ways to develop a thin or dead-end branch (F1346). */
export async function analyzeBranchGap(
  runtime: AIRuntime,
  branch: string,
): Promise<AiOutcome<{ suggestions: string[] }>> {
  if (!(await runtime.isAvailable())) return { available: false };
  const res = await runStructuredTask(
    runtime,
    'prose',
    TEMPLATES.gapAnalysis,
    { branch },
    suggestionsSchema,
  );
  return res.ok
    ? { available: true, ok: true, suggestions: res.data.suggestions }
    : { available: true, ok: false, error: res.error };
}

// ── Provenance markers (F1348) ───────────────────────────────────────────────

/** Marker bracketing AI-generated source so it's visible in the editor (F1348). */
export const AI_PROVENANCE_OPEN = '// ⟨ai⟩';
export const AI_PROVENANCE_CLOSE = '// ⟨/ai⟩';

/**
 * Wrap generated source with provenance markers so AI-drafted content is clearly
 * attributed in the story source (F1348). The author can strip the markers once
 * they've reviewed and adopted the text.
 */
export function markGenerated(source: string): string {
  return `${AI_PROVENANCE_OPEN}\n${source}\n${AI_PROVENANCE_CLOSE}`;
}

/** Count of provenance-marked (AI-generated) regions in a source file (F1348). */
export function countGeneratedRegions(source: string): number {
  return source.split(AI_PROVENANCE_OPEN).length - 1;
}
