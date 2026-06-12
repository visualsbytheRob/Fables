import { notFound, type NoteId } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { notesRepo } from '../db/repos/notes.js';
import { revisionsRepo } from '../db/repos/revisions.js';
import { diffWords } from '../lib/diff.js';
import { restoreRevision } from '../services/notes.js';

const idParamsSchema = z.object({ id: z.string().min(1) });
const revParamsSchema = z.object({
  id: z.string().min(1),
  rev: z.coerce.number().int().nonnegative(),
});
const diffQuerySchema = z.object({ against: z.coerce.number().int().nonnegative() });

registerRoute({
  method: 'GET',
  path: '/notes/:id/revisions',
  summary: 'List revision snapshots',
  params: idParamsSchema,
});
registerRoute({
  method: 'GET',
  path: '/notes/:id/revisions/:rev',
  summary: 'Fetch one revision snapshot',
  params: revParamsSchema,
});
registerRoute({
  method: 'POST',
  path: '/notes/:id/revisions/:rev/restore',
  summary: 'Restore a revision as the new head',
  params: revParamsSchema,
});
registerRoute({
  method: 'GET',
  path: '/notes/:id/revisions/:rev/diff',
  summary: 'Word-level diff between two revisions',
  params: revParamsSchema,
  query: diffQuerySchema,
});

export const revisionsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/notes/:id/revisions', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    if (!notesRepo(app.db).get(id as NoteId)) throw notFound('Note', id);
    return { data: revisionsRepo(app.db).list(id as NoteId) };
  });

  app.get('/notes/:id/revisions/:rev', async (request) => {
    const { id, rev } = parseWith(revParamsSchema, request.params, 'params');
    const revision = revisionsRepo(app.db).get(id as NoteId, rev);
    if (!revision) throw notFound('Revision', `${id}@${rev}`);
    return { data: revision };
  });

  app.post('/notes/:id/revisions/:rev/restore', async (request) => {
    const { id, rev } = parseWith(revParamsSchema, request.params, 'params');
    return { data: restoreRevision(app.db, id as NoteId, rev) };
  });

  /** Diff of revision `:rev` against revision `?against=N` (ops transform N into :rev). */
  app.get('/notes/:id/revisions/:rev/diff', async (request) => {
    const { id, rev } = parseWith(revParamsSchema, request.params, 'params');
    const { against } = parseWith(diffQuerySchema, request.query, 'query');
    const repo = revisionsRepo(app.db);
    const base = repo.get(id as NoteId, against);
    if (!base) throw notFound('Revision', `${id}@${against}`);
    const target = repo.get(id as NoteId, rev);
    if (!target) throw notFound('Revision', `${id}@${rev}`);
    return {
      data: { noteId: id, from: against, to: rev, ops: diffWords(base.body, target.body) },
    };
  });
};
