/**
 * Prompt infrastructure (F1311, F1312, F1315, F1318).
 *
 * Pure logic between the AI runtime and the AI features:
 *   - typed prompt templates with named slots (F1311)
 *   - a context budget manager that fits notes into a model's window (F1312)
 *   - JSON response extraction + schema validation for re-ask-on-failure (F1315)
 *   - per-task determinism presets (F1318)
 *
 * None of this touches a model runtime, so it is exhaustively unit-testable.
 */

import type { z } from 'zod';
import { validation } from '@fables/core';

// ── Typed prompt templates (F1311) ──────────────────────────────────────────

export interface PromptTemplate<Slots extends string> {
  readonly id: string;
  readonly system?: string;
  /** Body with `{{slot}}` placeholders. */
  readonly template: string;
  /** The slot names this template requires. */
  readonly slots: readonly Slots[];
}

export function defineTemplate<Slots extends string>(
  t: PromptTemplate<Slots>,
): PromptTemplate<Slots> {
  // Validate at definition time that every {{slot}} in the body is declared.
  const used = new Set([...t.template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]!));
  for (const u of used) {
    if (!t.slots.includes(u as Slots)) {
      throw new Error(`template "${t.id}" uses undeclared slot "${u}"`);
    }
  }
  return t;
}

/** Render a template, requiring every declared slot to be provided. */
export function render<Slots extends string>(
  t: PromptTemplate<Slots>,
  values: Record<Slots, string>,
): { system?: string; prompt: string } {
  let prompt = t.template;
  for (const slot of t.slots) {
    if (!(slot in values)) throw validation(`missing prompt slot "${slot}"`, { template: t.id });
    prompt = prompt.replaceAll(new RegExp(`\\{\\{\\s*${slot}\\s*\\}\\}`, 'g'), values[slot]);
  }
  return t.system !== undefined ? { system: t.system, prompt } : { prompt };
}

// ── Context budget manager (F1312) ──────────────────────────────────────────

/** Rough token estimate: ~4 chars/token, a safe overestimate for English+markup. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface BudgetedItem {
  id: string;
  text: string;
}

export interface BudgetResult {
  included: BudgetedItem[];
  droppedCount: number;
  usedTokens: number;
}

/**
 * Greedily include items (already in priority order) until `maxTokens` is hit,
 * reserving `reserveTokens` for the rest of the prompt + the model's reply.
 */
export function fitToBudget(
  items: BudgetedItem[],
  maxTokens: number,
  reserveTokens = 0,
): BudgetResult {
  const budget = Math.max(0, maxTokens - reserveTokens);
  const included: BudgetedItem[] = [];
  let used = 0;
  for (const item of items) {
    const cost = estimateTokens(item.text);
    if (used + cost > budget) break;
    included.push(item);
    used += cost;
  }
  return { included, droppedCount: items.length - included.length, usedTokens: used };
}

// ── JSON response validation (F1315) ────────────────────────────────────────

/** Pull the first JSON object/array out of a model reply (handles ``` fences). */
export function extractJson(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced?.[1] ?? text;
  const start = body.search(/[[{]/);
  if (start === -1) return null;
  // Walk to the matching close bracket.
  const open = body[start]!;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = start; i < body.length; i++) {
    if (body[i] === open) depth++;
    else if (body[i] === close) {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return null;
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Extract + parse + schema-validate a JSON response. On failure returns
 * `{ ok: false, error }` so the caller can re-ask the model (F1315).
 */
export function parseJsonResponse<T>(text: string, schema: z.ZodType<T>): ParseResult<T> {
  const json = extractJson(text);
  if (json === null) return { ok: false, error: 'no JSON found in model response' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${String(e)}` };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => i.message).join('; ') };
  }
  return { ok: true, data: result.data };
}

// ── Determinism presets per task (F1318) ────────────────────────────────────

export type AiTask =
  | 'tags' // structured extraction → deterministic
  | 'title'
  | 'summary'
  | 'qa' // grounded answer → low but non-zero
  | 'prose' // creative writing → high
  | 'dialogue';

export const TASK_TEMPERATURE: Record<AiTask, number> = {
  tags: 0,
  title: 0.2,
  summary: 0.3,
  qa: 0.2,
  prose: 0.8,
  dialogue: 0.9,
};
