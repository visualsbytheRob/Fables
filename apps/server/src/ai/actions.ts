/**
 * AI command surface — server side (F1376–F1379).
 *
 *   F1377  User-defined AI actions: a saved prompt + scope, persisted and run on
 *          a selection or note. Templates are validated at save time so a bad
 *          `{{slot}}` is rejected before it can fail at run time.
 *   F1376  Multi-step workflows: run an ordered set of built-in note-intelligence
 *          steps in one call (e.g. summarize → tag → title) so the UI can present
 *          and apply them together.
 *   F1379  Abuse guard: actions never auto-run across many items without an
 *          explicit confirmation — a single chokepoint used by bulk endpoints.
 *   F1378  Usage stats reuse the local usage meter (feature key `action:<name>`).
 */

import { nowIso, validation, AppError } from '@fables/core';
import type { Db } from '../db/connection.js';
import type { AIRuntime } from './runtime.js';
import type { AiOutcome, NoteContent } from './note-intelligence.js';
import { suggestTags, suggestTitle, summarizeNote } from './note-intelligence.js';
import { outlineNote } from './note-transform.js';
import { defineTemplate, type AiTask } from './prompt.js';
import { runTextTask } from './task-router.js';
import { extractJson } from './prompt.js';

// ── Custom actions (F1377) ───────────────────────────────────────────────────

export type AiActionScope = 'selection' | 'note';
export type AiActionOutput = 'text' | 'json';

const AI_TASKS: readonly AiTask[] = ['tags', 'title', 'summary', 'qa', 'prose', 'dialogue'];

export interface AiAction {
  id: string;
  name: string;
  description: string;
  system: string | null;
  template: string;
  task: AiTask;
  scope: AiActionScope;
  output: AiActionOutput;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  name: string;
  description: string;
  system: string | null;
  template: string;
  task: string;
  scope: string;
  output: string;
  created_at: string;
  updated_at: string;
}

const toAction = (r: Row): AiAction => ({
  id: r.id,
  name: r.name,
  description: r.description,
  system: r.system,
  template: r.template,
  task: r.task as AiTask,
  scope: r.scope as AiActionScope,
  output: r.output as AiActionOutput,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const newActionId = (): string => `act_${crypto.randomUUID()}`;

export interface AiActionInput {
  name: string;
  description?: string | undefined;
  system?: string | null | undefined;
  /** Must reference only the `{{input}}` slot. */
  template: string;
  task: AiTask;
  scope?: AiActionScope | undefined;
  output?: AiActionOutput | undefined;
}

/** Validate that a template references only `{{input}}` (F1377 save-time check). */
export function assertValidActionTemplate(template: string, system?: string | null): void {
  try {
    defineTemplate({
      id: 'action-validate',
      ...(system ? { system } : {}),
      template,
      slots: ['input'] as const,
    });
  } catch (e) {
    throw validation(`invalid action template: ${(e as Error).message}`);
  }
  if (!/\{\{\s*input\s*\}\}/.test(template)) {
    throw validation('action template must reference the {{input}} slot');
  }
}

export function aiActionsRepo(db: Db) {
  return {
    create(input: AiActionInput): AiAction {
      if (!AI_TASKS.includes(input.task)) throw validation(`unknown task "${input.task}"`);
      assertValidActionTemplate(input.template, input.system);
      const now = nowIso();
      const action: AiAction = {
        id: newActionId(),
        name: input.name,
        description: input.description ?? '',
        system: input.system ?? null,
        template: input.template,
        task: input.task,
        scope: input.scope ?? 'selection',
        output: input.output ?? 'text',
        createdAt: now,
        updatedAt: now,
      };
      db.prepare(
        `INSERT INTO ai_actions (id, name, description, system, template, task, scope, output, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        action.id,
        action.name,
        action.description,
        action.system,
        action.template,
        action.task,
        action.scope,
        action.output,
        action.createdAt,
        action.updatedAt,
      );
      return action;
    },

    get(id: string): AiAction | null {
      const row = db.prepare('SELECT * FROM ai_actions WHERE id = ?').get(id) as Row | undefined;
      return row ? toAction(row) : null;
    },

    list(): AiAction[] {
      return (db.prepare('SELECT * FROM ai_actions ORDER BY name').all() as Row[]).map(toAction);
    },

    delete(id: string): boolean {
      return db.prepare('DELETE FROM ai_actions WHERE id = ?').run(id).changes > 0;
    },
  };
}

export type AiActionsRepo = ReturnType<typeof aiActionsRepo>;

export type CustomActionResult =
  | { available: false }
  | { available: true; ok: true; output: 'text'; text: string }
  | { available: true; ok: true; output: 'json'; json: unknown; text: string }
  | { available: true; ok: false; error: string };

/** Run a saved custom action against an input string (F1377). */
export async function runCustomAction(
  runtime: AIRuntime,
  action: AiAction,
  input: string,
): Promise<CustomActionResult> {
  if (!(await runtime.isAvailable())) return { available: false };
  const template = defineTemplate({
    id: `action:${action.id}`,
    ...(action.system ? { system: action.system } : {}),
    template: action.template,
    slots: ['input'] as const,
  });
  const text = await runTextTask(runtime, action.task, template, { input });
  if (action.output === 'json') {
    const raw = extractJson(text);
    if (raw === null) return { available: true, ok: false, error: 'no JSON in response' };
    try {
      return { available: true, ok: true, output: 'json', json: JSON.parse(raw), text };
    } catch (e) {
      return { available: true, ok: false, error: `invalid JSON: ${(e as Error).message}` };
    }
  }
  return { available: true, ok: true, output: 'text', text };
}

// ── Abuse guard (F1379) ──────────────────────────────────────────────────────

/** Above this many items, a bulk AI action requires explicit confirmation. */
export const BULK_CONFIRM_THRESHOLD = 5;

/**
 * Guard bulk AI actions (F1379): refuse to run across more than
 * {@link BULK_CONFIRM_THRESHOLD} items unless the caller explicitly confirmed.
 * Prevents an accidental "run on everything" from fanning out unprompted.
 */
export function assertBulkConfirmed(itemCount: number, confirmed: boolean): void {
  if (itemCount > BULK_CONFIRM_THRESHOLD && !confirmed) {
    throw new AppError(
      'BAD_REQUEST',
      `this runs on ${itemCount} items — pass confirm:true to proceed`,
      { details: { itemCount, threshold: BULK_CONFIRM_THRESHOLD } },
    );
  }
}

// ── Multi-step workflows (F1376) ─────────────────────────────────────────────

export type WorkflowStepKind = 'summarize' | 'tags' | 'title' | 'outline';

const WORKFLOW_STEPS: readonly WorkflowStepKind[] = ['summarize', 'tags', 'title', 'outline'];

export function isWorkflowStep(s: string): s is WorkflowStepKind {
  return (WORKFLOW_STEPS as readonly string[]).includes(s);
}

export interface WorkflowStepResult {
  kind: WorkflowStepKind;
  // The matching note-intelligence outcome (graceful union preserved).
  result: AiOutcome<unknown>;
}

/**
 * Run an ordered set of built-in note-intelligence steps over one note (F1376).
 * Steps are independent and advisory — the UI presents the combined results and
 * the user applies/files them. De-duplicates repeated step kinds.
 */
export async function runWorkflow(
  runtime: AIRuntime,
  note: NoteContent,
  steps: WorkflowStepKind[],
): Promise<{ available: boolean; steps: WorkflowStepResult[] }> {
  if (!(await runtime.isAvailable())) return { available: false, steps: [] };
  const seen = new Set<WorkflowStepKind>();
  const results: WorkflowStepResult[] = [];
  for (const kind of steps) {
    if (seen.has(kind)) continue;
    seen.add(kind);
    results.push({ kind, result: await runStep(runtime, kind, note) });
  }
  return { available: true, steps: results };
}

async function runStep(
  runtime: AIRuntime,
  kind: WorkflowStepKind,
  note: NoteContent,
): Promise<AiOutcome<unknown>> {
  switch (kind) {
    case 'summarize':
      return summarizeNote(runtime, note);
    case 'tags':
      return suggestTags(runtime, note);
    case 'title':
      return suggestTitle(runtime, note);
    case 'outline':
      return outlineNote(runtime, note.body);
  }
}
