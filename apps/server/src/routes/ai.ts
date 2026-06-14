/**
 * Note-intelligence routes (F1331 summarize, F1332 tags, F1333 title).
 *
 *  GET  /ai/status                 — whether an AI backend is available + models
 *  POST /notes/:id/ai/summary      — summarize the note
 *  POST /notes/:id/ai/tags         — suggest tags
 *  POST /notes/:id/ai/title        — suggest a title
 *
 * Every action degrades gracefully: when no backend is available the response is
 * `{ data: { available: false } }` so the UI can hide the feature (F1309). The
 * suggestions are advisory — applying them is a normal note edit, so they're
 * undoable and clearly attributable to the user's action (F1339).
 */

import { notFound } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import type { NoteId } from '@fables/core';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { z } from 'zod';
import { notesRepo } from '../db/repos/notes.js';
import { suggestTags, suggestTitle, summarizeNote } from '../ai/note-intelligence.js';
import { ragAnswer, saveQaNote, suggestFollowUps } from '../ai/rag.js';

registerRoute({ method: 'GET', path: '/ai/status', summary: 'AI availability + models' });
registerRoute({
  method: 'POST',
  path: '/notes/:id/ai/summary',
  summary: 'Summarize a note (F1331)',
});
registerRoute({
  method: 'POST',
  path: '/notes/:id/ai/tags',
  summary: 'Suggest tags for a note (F1332)',
});
registerRoute({
  method: 'POST',
  path: '/notes/:id/ai/title',
  summary: 'Suggest a title for a note (F1333)',
});
registerRoute({
  method: 'POST',
  path: '/ai/ask',
  summary: 'Ask your vault: grounded, cited answer (F1321/F1322)',
});
registerRoute({
  method: 'POST',
  path: '/ai/follow-ups',
  summary: 'Suggest follow-up questions after an answer (F1328)',
});

const idParams = z.object({ id: z.string().min(1) });

const turnSchema = z.object({
  question: z.string().min(1).max(1000),
  answer: z.string().min(1).max(8000),
});

const askBody = z.object({
  question: z.string().min(1).max(1000),
  /** Restrict retrieval to one notebook (F1323 scope). */
  notebookId: z.string().min(1).optional(),
  /** Max sources to retrieve. */
  limit: z.number().int().min(1).max(12).optional(),
  /** Earlier turns in this Q&A session for context (F1324). */
  history: z.array(turnSchema).max(20).optional(),
  /** Opt in to filing the answer as a searchable note (F1327). */
  save: z.boolean().optional(),
});

const followUpsBody = z.object({
  question: z.string().min(1).max(1000),
  answer: z.string().min(1).max(8000),
});

export const aiRoutes: FastifyPluginAsync = async (app) => {
  app.get('/ai/status', async () => {
    const available = await app.ai.isAvailable();
    return { data: { available, models: available ? await app.ai.listModels() : [] } };
  });

  function loadNote(id: string) {
    const note = notesRepo(app.db).get(id as NoteId);
    if (!note) throw notFound('Note', id);
    return note;
  }

  app.post('/notes/:id/ai/summary', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    const note = loadNote(id);
    return { data: await summarizeNote(app.ai, { title: note.title, body: note.body }) };
  });

  app.post('/notes/:id/ai/tags', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    const note = loadNote(id);
    return { data: await suggestTags(app.ai, { title: note.title, body: note.body }) };
  });

  app.post('/notes/:id/ai/title', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    const note = loadNote(id);
    return { data: await suggestTitle(app.ai, { title: note.title, body: note.body }) };
  });

  app.post('/ai/ask', async (request) => {
    const body = parseWith(askBody, request.body, 'body');
    const result = await ragAnswer(app.ai, app.intel, app.db, body.question, {
      ...(body.notebookId !== undefined ? { notebookId: body.notebookId } : {}),
      ...(body.limit !== undefined ? { limit: body.limit } : {}),
      ...(body.history !== undefined ? { history: body.history } : {}),
    });
    // F1327: optionally file the answer as a searchable note.
    if (body.save && result.available && result.ok) {
      const note = saveQaNote(app.db, body.question, result);
      return { data: { ...result, savedNoteId: note.id } };
    }
    return { data: result };
  });

  app.post('/ai/follow-ups', async (request) => {
    const body = parseWith(followUpsBody, request.body, 'body');
    return { data: await suggestFollowUps(app.ai, body.question, body.answer) };
  });
};
