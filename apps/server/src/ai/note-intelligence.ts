/**
 * Note intelligence (F1331 summarize, F1332 auto-tag, F1333 title) — built on the
 * task router. Every function is graceful: when no AI backend is available it
 * returns `{ available: false }` so the UI can simply hide the action (F1309).
 */

import { z } from 'zod';
import type { AIRuntime } from './runtime.js';
import { runStructuredTask, runTextTask } from './task-router.js';
import { TEMPLATES } from './templates.js';

export interface NoteContent {
  title: string;
  body: string;
}

export type AiOutcome<T> =
  | { available: false }
  | ({ available: true } & (({ ok: true } & T) | { ok: false; error: string }));

const tagsSchema = z.object({ tags: z.array(z.string()).max(12) });
const titleSchema = z.object({ title: z.string().min(1).max(120) });

/** Suggest topical tags for a note (F1332). */
export async function suggestTags(
  runtime: AIRuntime,
  note: NoteContent,
): Promise<AiOutcome<{ tags: string[] }>> {
  if (!(await runtime.isAvailable())) return { available: false };
  const res = await runStructuredTask(
    runtime,
    'tags',
    TEMPLATES.tagSuggest,
    { title: note.title, body: note.body },
    tagsSchema,
  );
  return res.ok
    ? { available: true, ok: true, tags: res.data.tags }
    : { available: true, ok: false, error: res.error };
}

/** Suggest a concise title for an untitled note (F1333). */
export async function suggestTitle(
  runtime: AIRuntime,
  note: NoteContent,
): Promise<AiOutcome<{ title: string }>> {
  if (!(await runtime.isAvailable())) return { available: false };
  const res = await runStructuredTask(
    runtime,
    'title',
    TEMPLATES.titleSuggest,
    { body: note.body },
    titleSchema,
  );
  return res.ok
    ? { available: true, ok: true, title: res.data.title }
    : { available: true, ok: false, error: res.error };
}

/** Summarize a note in a few sentences (F1331). */
export async function summarizeNote(
  runtime: AIRuntime,
  note: NoteContent,
): Promise<AiOutcome<{ summary: string }>> {
  if (!(await runtime.isAvailable())) return { available: false };
  const summary = await runTextTask(runtime, 'summary', TEMPLATES.summarize, {
    title: note.title,
    body: note.body,
  });
  return { available: true, ok: true, summary };
}
