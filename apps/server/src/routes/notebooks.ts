import { notFound, type Notebook, type NotebookId } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { withTransaction } from '../db/connection.js';
import { notebooksRepo } from '../db/repos/notebooks.js';

const idParamsSchema = z.object({ id: z.string().min(1) });

const createBodySchema = z.object({
  name: z.string().min(1).max(200),
  parentId: z.string().min(1).nullish(),
  icon: z.string().max(64).nullish(),
  color: z.string().max(32).nullish(),
});

const patchBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  parentId: z.string().min(1).nullable().optional(),
  icon: z.string().max(64).nullable().optional(),
  color: z.string().max(32).nullable().optional(),
  archived: z.boolean().optional(),
});

const listQuerySchema = z.object({ includeArchived: z.enum(['true', 'false']).optional() });

const deleteQuerySchema = z.object({ moveNotesTo: z.string().min(1).optional() });

registerRoute({
  method: 'POST',
  path: '/notebooks',
  summary: 'Create a notebook (optionally nested)',
  body: createBodySchema,
});
registerRoute({
  method: 'GET',
  path: '/notebooks',
  summary: 'List notebooks',
  query: listQuerySchema,
});
registerRoute({
  method: 'GET',
  path: '/notebooks/tree',
  summary: 'Nested notebook tree with note counts',
  query: listQuerySchema,
});
registerRoute({
  method: 'GET',
  path: '/notebooks/:id',
  summary: 'Fetch a notebook',
  params: idParamsSchema,
});
registerRoute({
  method: 'PATCH',
  path: '/notebooks/:id',
  summary: 'Update a notebook (rename, move, archive)',
  params: idParamsSchema,
  body: patchBodySchema,
});
registerRoute({
  method: 'DELETE',
  path: '/notebooks/:id',
  summary: 'Delete a notebook, re-homing its notes',
  params: idParamsSchema,
  query: deleteQuerySchema,
});

interface TreeNode extends Notebook {
  noteCount: number;
  children: TreeNode[];
}

export const notebooksRoutes: FastifyPluginAsync = async (app) => {
  app.post('/notebooks', async (request, reply) => {
    const body = parseWith(createBodySchema, request.body, 'body');
    const notebook = notebooksRepo(app.db).create({
      name: body.name,
      parentId: (body.parentId ?? null) as NotebookId | null,
      icon: body.icon ?? null,
      color: body.color ?? null,
    });
    reply.status(201);
    return { data: notebook };
  });

  app.get('/notebooks', async (request) => {
    const query = parseWith(listQuerySchema, request.query, 'query');
    return {
      data: notebooksRepo(app.db).list({ includeArchived: query.includeArchived === 'true' }),
    };
  });

  app.get('/notebooks/tree', async (request) => {
    const query = parseWith(listQuerySchema, request.query, 'query');
    const repo = notebooksRepo(app.db);
    const all = repo.list({ includeArchived: query.includeArchived === 'true' });
    const counts = repo.noteCounts();

    const nodes = new Map<string, TreeNode>(
      all.map((nb) => [nb.id, { ...nb, noteCount: counts.get(nb.id) ?? 0, children: [] }]),
    );
    const roots: TreeNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentId !== null ? nodes.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node); // true roots, plus children of hidden (archived) parents
    }
    return { data: roots };
  });

  app.get('/notebooks/:id', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const notebook = notebooksRepo(app.db).get(id as NotebookId);
    if (!notebook) throw notFound('Notebook', id);
    return { data: notebook };
  });

  app.patch('/notebooks/:id', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const body = parseWith(patchBodySchema, request.body, 'body');
    const notebook = notebooksRepo(app.db).update(id as NotebookId, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.parentId !== undefined ? { parentId: body.parentId as NotebookId | null } : {}),
      ...(body.icon !== undefined ? { icon: body.icon } : {}),
      ...(body.color !== undefined ? { color: body.color } : {}),
      ...(body.archived !== undefined ? { archived: body.archived } : {}),
    });
    return { data: notebook };
  });

  app.delete('/notebooks/:id', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const query = parseWith(deleteQuerySchema, request.query, 'query');
    const result = withTransaction(app.db, () =>
      notebooksRepo(app.db).remove(id as NotebookId, {
        ...(query.moveNotesTo !== undefined
          ? { moveNotesTo: query.moveNotesTo as NotebookId }
          : {}),
      }),
    );
    return { data: { id, ...result } };
  });
};
