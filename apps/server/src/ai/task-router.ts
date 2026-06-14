/**
 * Per-task model router (F1314) with schema re-ask (F1315).
 *
 * Ties the pieces together: render a template, pick a model by the task's speed
 * class, apply the task's determinism preset, call the runtime, and — for
 * structured tasks — validate the JSON reply, re-asking once on failure before
 * giving up. The note-intelligence and RAG features call these helpers.
 */

import type { z } from 'zod';
import type { AIRuntime } from './runtime.js';
import type { PromptTemplate } from './prompt.js';
import { render, parseJsonResponse, TASK_TEMPERATURE, type AiTask } from './prompt.js';
import type { SpeedClass } from './adapter.js';

/** Default speed class per task — small for extraction, large for prose (F1314). */
const TASK_SPEED: Record<AiTask, SpeedClass> = {
  tags: 'fast',
  title: 'fast',
  summary: 'balanced',
  qa: 'balanced',
  prose: 'large',
  dialogue: 'large',
};

/** Run a free-text task (e.g. summary, prose). Returns the model's text. */
export async function runTextTask<S extends string>(
  runtime: AIRuntime,
  task: AiTask,
  template: PromptTemplate<S>,
  slots: Record<S, string>,
): Promise<string> {
  const { system, prompt } = render(template, slots);
  const model = await runtime.pickModel(TASK_SPEED[task]);
  const res = await runtime.generate({
    prompt,
    ...(system !== undefined ? { system } : {}),
    ...(model ? { model: model.name } : {}),
    temperature: TASK_TEMPERATURE[task],
  });
  return res.text.trim();
}

export type StructuredResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Run a structured task, validating the JSON reply against `schema`. On a parse
 * or schema failure the model is re-asked once with a corrective nudge (F1315)
 * before returning `{ ok: false }`.
 */
export async function runStructuredTask<S extends string, T>(
  runtime: AIRuntime,
  task: AiTask,
  template: PromptTemplate<S>,
  slots: Record<S, string>,
  schema: z.ZodType<T>,
): Promise<StructuredResult<T>> {
  const { system, prompt } = render(template, slots);
  const model = await runtime.pickModel(TASK_SPEED[task]);
  const base = {
    ...(system !== undefined ? { system } : {}),
    ...(model ? { model: model.name } : {}),
    temperature: TASK_TEMPERATURE[task],
  };

  const first = await runtime.generate({ ...base, prompt });
  const parsed = parseJsonResponse(first.text, schema);
  if (parsed.ok) return parsed;

  // Re-ask once, telling the model exactly what was wrong (F1315).
  const retry = await runtime.generate({
    ...base,
    prompt: `${prompt}\n\nYour previous reply was not valid: ${parsed.error}\nReply with ONLY the requested JSON.`,
  });
  return parseJsonResponse(retry.text, schema);
}
