/**
 * AI command-surface routes (F1376–F1379).
 *
 *   F1377  CRUD + run for user-defined actions.
 *   F1376  Multi-step workflow runner over a note.
 *   F1379  Bulk runs require explicit confirmation.
 *
 * Action runs are metered locally (feature `action:<name>`) for usage stats
 * (F1378). All degrade gracefully to `{ available: false }` without a backend.
 */

import type { FastifyPluginAsync } from 'fastify';
import { notFound } from '@fables/core';
import type { NoteId } from '@fables/core';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { notesRepo } from '../db/repos/notes.js';
import {
  aiActionsRepo,
  assertBulkConfirmed,
  isWorkflowStep,
  runCustomAction,
  runWorkflow,
  type WorkflowStepKind,
} from '../ai/actions.js';

registerRoute({ method: 'GET', path: '/ai/actions', summary: 'List custom AI actions (F1377)' });
registerRoute({
  method: 'POST',
  path: '/ai/actions',
  summary: 'Create a custom AI action (F1377)',
});
registerRoute({
  method: 'DELETE',
  path: '/ai/actions/:id',
  summary: 'Delete a custom AI action (F1377)',
});
registerRoute({
  method: 'POST',
  path: '/ai/actions/:id/run',
  summary: 'Run a custom AI action (F1377)',
});
registerRoute({
  method: 'POST',
  path: '/ai/workflows/run',
  summary: 'Run a multi-step workflow over a note (F1376)',
});

const taskEnum = z.enum(['tags', 'title', 'summary', 'qa', 'prose', 'dialogue']);

const createBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  system: z.string().max(4000).nullable().optional(),
  template: z.string().min(1).max(8000),
  task: taskEnum,
  scope: z.enum(['selection', 'note']).optional(),
  output: z.enum(['text', 'json']).optional(),
});

const idParams = z.object({ id: z.string().min(1) });

const runBody = z.object({ input: z.string().min(1).max(50_000) });

const workflowBody = z.object({
  noteId: z.string().min(1),
  steps: z.array(z.string()).min(1).max(8),
  /** Required to run on more than the bulk threshold of items (F1379). */
  confirm: z.boolean().optional(),
});

export const aiActionsRoutes: FastifyPluginAsync = async (app) => {
  const repo = () => aiActionsRepo(app.db);

  app.get('/ai/actions', async () => ({ data: repo().list() }));

  app.post('/ai/actions', async (request, reply) => {
    const body = parseWith(createBody, request.body, 'body');
    const action = repo().create(body);
    return reply.status(201).send({ data: action });
  });

  app.delete('/ai/actions/:id', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    if (!repo().delete(id)) throw notFound('AiAction', id);
    return { data: { deleted: true } };
  });

  app.post('/ai/actions/:id/run', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    const { input } = parseWith(runBody, request.body, 'body');
    const action = repo().get(id);
    if (!action) throw notFound('AiAction', id);
    const result = await runCustomAction(app.ai, action, input);
    // F1378: meter the run locally (best-effort; token counts unknown for text).
    if (result.available && result.ok) {
      app.aiUsage.record({
        feature: `action:${action.name}`,
        backend: 'local',
        inputTokens: Math.ceil(input.length / 4),
        outputTokens: Math.ceil((result.output === 'text' ? result.text.length : 0) / 4),
      });
    }
    return { data: result };
  });

  app.post('/ai/workflows/run', async (request) => {
    const body = parseWith(workflowBody, request.body, 'body');
    // F1379: each workflow step is an AI call; guard against unconfirmed fan-out.
    assertBulkConfirmed(body.steps.length, body.confirm ?? false);
    const invalid = body.steps.filter((s) => !isWorkflowStep(s));
    if (invalid.length > 0) throw notFound('WorkflowStep', invalid.join(', '));
    const note = notesRepo(app.db).get(body.noteId as NoteId);
    if (!note) throw notFound('Note', body.noteId);
    const steps = body.steps.filter(isWorkflowStep) as WorkflowStepKind[];
    return { data: await runWorkflow(app.ai, { title: note.title, body: note.body }, steps) };
  });
};
