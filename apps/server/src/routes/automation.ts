/**
 * Automation rule routes (Epic 20, F1911–F1918).
 *
 *  POST   /automation/rules            — create a rule
 *  GET    /automation/rules            — list rules
 *  GET    /automation/rules/:id        — fetch a rule
 *  PUT    /automation/rules/:id        — update a rule
 *  DELETE /automation/rules/:id        — delete a rule
 *  POST   /automation/rules/:id/run    — run against a note (dryRun supported, F1914)
 *  GET    /automation/rules/:id/runs   — run history with diffs (F1915)
 *  GET    /automation/templates        — starter rule templates (F1917)
 */

import { notFound } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { automationRepo } from '../db/repos/automation.js';

const TRIGGERS = ['note.created', 'note.updated', 'note.tagged', 'schedule', 'manual'] as const;

const conditionSchema = z.object({
  field: z.string().min(1).max(50),
  op: z.enum(['equals', 'contains', 'matches', 'gt', 'lt', 'hasTag', 'lacksTag']),
  value: z.union([z.string().max(1000), z.number()]),
});

const actionSchema = z.union([
  z.object({ type: z.literal('addTag'), tag: z.string().min(1).max(100) }),
  z.object({ type: z.literal('removeTag'), tag: z.string().min(1).max(100) }),
  z.object({ type: z.literal('move'), notebookId: z.string().min(1) }),
  z.object({ type: z.literal('setTitle'), title: z.string().max(500) }),
  z.object({ type: z.literal('notify'), message: z.string().max(1000) }),
  z.object({
    type: z.literal('runPlugin'),
    plugin: z.string().min(1),
    args: z.record(z.string(), z.unknown()).optional(),
  }),
]);

const ruleBody = z.object({
  name: z.string().min(1).max(200),
  trigger: z.enum(TRIGGERS),
  conditions: z.array(conditionSchema).max(50).optional(),
  actions: z.array(actionSchema).max(50).optional(),
  enabled: z.boolean().optional(),
});

const idParam = z.object({ id: z.string().min(1) });

registerRoute({ method: 'POST', path: '/automation/rules', summary: 'Create a rule (F1911)' });
registerRoute({ method: 'GET', path: '/automation/rules', summary: 'List rules' });
registerRoute({ method: 'GET', path: '/automation/rules/:id', summary: 'Fetch a rule' });
registerRoute({ method: 'PUT', path: '/automation/rules/:id', summary: 'Update a rule' });
registerRoute({ method: 'DELETE', path: '/automation/rules/:id', summary: 'Delete a rule' });
registerRoute({ method: 'POST', path: '/automation/rules/:id/run', summary: 'Run a rule (F1914)' });
registerRoute({
  method: 'GET',
  path: '/automation/rules/:id/runs',
  summary: 'Run history (F1915)',
});
registerRoute({ method: 'GET', path: '/automation/templates', summary: 'Rule templates (F1917)' });

const TEMPLATES = [
  {
    name: 'Inbox zero: file tagged notes',
    trigger: 'note.tagged',
    conditions: [{ field: 'tag', op: 'equals', value: 'inbox' }],
    actions: [
      { type: 'removeTag', tag: 'inbox' },
      { type: 'addTag', tag: 'filed' },
    ],
  },
  {
    name: 'Auto-tag meeting notes',
    trigger: 'note.created',
    conditions: [{ field: 'title', op: 'contains', value: 'meeting' }],
    actions: [{ type: 'addTag', tag: 'meeting' }],
  },
];

export const automationRoutes: FastifyPluginAsync = async (app) => {
  const repo = automationRepo(app.db);

  app.get('/automation/templates', async () => {
    return { data: { templates: TEMPLATES } };
  });

  app.post('/automation/rules', async (request) => {
    const body = parseWith(ruleBody, request.body, 'body');
    return {
      data: repo.create({
        name: body.name,
        trigger: body.trigger,
        ...(body.conditions !== undefined ? { conditions: body.conditions } : {}),
        ...(body.actions !== undefined ? { actions: body.actions } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      }),
    };
  });

  app.get('/automation/rules', async () => {
    return { data: { rules: repo.list() } };
  });

  app.get('/automation/rules/:id', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const rule = repo.get(id);
    if (!rule) throw notFound('rule', id);
    return { data: rule };
  });

  app.put('/automation/rules/:id', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const body = parseWith(ruleBody.partial(), request.body, 'body');
    const rule = repo.update(id, body);
    if (!rule) throw notFound('rule', id);
    return { data: rule };
  });

  app.delete('/automation/rules/:id', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    if (!repo.remove(id)) throw notFound('rule', id);
    return { data: { removed: true } };
  });

  app.post('/automation/rules/:id/run', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const body = parseWith(
      z.object({ noteId: z.string().min(1), dryRun: z.boolean().optional() }),
      request.body,
      'body',
    );
    const result = repo.run(id, body.noteId, body.dryRun ?? false);
    if (!result) throw notFound('rule or note', id);
    return { data: result };
  });

  app.get('/automation/rules/:id/runs', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    if (!repo.get(id)) throw notFound('rule', id);
    return { data: { runs: repo.runHistory(id) } };
  });
};
