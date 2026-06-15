/**
 * Bulk-operations routes (Epic 20, F1951–F1958).
 *
 *  POST /bulk/preview     — plan an operation without writing (preview → confirm)
 *  POST /bulk/apply       — apply an operation (journalled, undoable)
 *  POST /bulk/:id/undo    — reverse a journalled operation (F1958)
 *  GET  /bulk/history     — the operation journal
 *  GET  /bulk/:id         — one journal entry
 *
 * The pure `bulk/engine` computes every plan/diff; this binds it to the live
 * vault with a confirm-then-apply, fully reversible workflow.
 */

import { notFound, validation } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { bulkRepo, type BulkScope } from '../db/repos/bulk.js';
import type { BulkOp } from '../bulk/engine.js';

const scopeSchema = z.object({
  notebookId: z.string().min(1).optional(),
  query: z.string().max(2000).optional(),
  noteIds: z.array(z.string().min(1)).max(10000).optional(),
});

const opSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('findAndReplace'),
    options: z.object({
      find: z.string().min(1).max(2000),
      replace: z.string().max(2000),
      mode: z.enum(['literal', 'regex']).optional(),
      caseSensitive: z.boolean().optional(),
      wholeWord: z.boolean().optional(),
      scope: z.enum(['title', 'body', 'both']).optional(),
    }),
  }),
  z.object({
    type: z.literal('fieldEdit'),
    edits: z
      .array(z.object({ key: z.string().min(1).max(100), value: z.string().max(2000).optional() }))
      .min(1)
      .max(50),
  }),
  z.object({
    type: z.literal('wikilinkRename'),
    renames: z
      .array(
        z.object({ oldTitle: z.string().min(1).max(500), newTitle: z.string().min(1).max(500) }),
      )
      .min(1)
      .max(200),
  }),
  z.object({
    type: z.literal('tagOp'),
    op: z.discriminatedUnion('action', [
      z.object({ action: z.literal('add'), tag: z.string().min(1).max(100) }),
      z.object({ action: z.literal('remove'), tag: z.string().min(1).max(100) }),
      z.object({
        action: z.literal('rename'),
        oldTag: z.string().min(1).max(100),
        newTag: z.string().min(1).max(100),
      }),
    ]),
  }),
  z.object({
    type: z.literal('merge'),
    targetId: z.string().min(1),
    sourceIds: z.array(z.string().min(1)).min(1).max(500),
    separator: z.string().max(100).optional(),
  }),
  z.object({
    type: z.literal('split'),
    noteId: z.string().min(1),
    headingLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  }),
]);

const bodySchema = z.object({ op: opSchema, scope: scopeSchema.optional() });
const idParam = z.object({ id: z.string().min(1) });

registerRoute({ method: 'POST', path: '/bulk/preview', summary: 'Preview a bulk op (F1951)' });
registerRoute({ method: 'POST', path: '/bulk/apply', summary: 'Apply a bulk op (F1951)' });
registerRoute({ method: 'POST', path: '/bulk/:id/undo', summary: 'Undo a bulk op (F1958)' });
registerRoute({ method: 'GET', path: '/bulk/history', summary: 'Operation journal (F1958)' });
registerRoute({ method: 'GET', path: '/bulk/:id', summary: 'A journal entry' });

export const bulkRoutes: FastifyPluginAsync = async (app) => {
  const repo = bulkRepo(app.db);

  app.post('/bulk/preview', async (request) => {
    const body = parseWith(bodySchema, request.body, 'body');
    return { data: repo.preview(body.op as BulkOp, (body.scope ?? {}) as BulkScope) };
  });

  app.post('/bulk/apply', async (request) => {
    const body = parseWith(bodySchema, request.body, 'body');
    return { data: repo.apply(body.op as BulkOp, (body.scope ?? {}) as BulkScope) };
  });

  app.post('/bulk/:id/undo', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    if (!repo.get(id)) throw notFound('bulk operation', id);
    const result = repo.undo(id);
    if (!result) throw validation('operation already reversed');
    return { data: result };
  });

  app.get('/bulk/history', async () => {
    return { data: { entries: repo.history() } };
  });

  app.get('/bulk/:id', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const entry = repo.get(id);
    if (!entry) throw notFound('bulk operation', id);
    return { data: entry };
  });
};
