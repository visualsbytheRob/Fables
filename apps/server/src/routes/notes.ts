import { conflict, notFound, type NotebookId, type NoteId } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { paginated, parsePagination } from '../api/envelope.js';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { notesRepo } from '../db/repos/notes.js';
import { tagsRepo } from '../db/repos/tags.js';
import { invalidateGraphCache } from '../services/graph.js';
import { bulkNotes, createNote, duplicateNote, updateNote } from '../services/notes.js';
import { parseTagName } from '../services/tags.js';

const idParamsSchema = z.object({ id: z.string().min(1) });

const createBodySchema = z.object({
  notebookId: z.string().min(1),
  title: z.string().max(500).default(''),
  body: z.string().default(''),
});

const listQuerySchema = z.object({
  sort: z.enum(['updated', 'created', 'title']).default('updated'),
  notebookId: z.string().min(1).optional(),
});

const patchBodySchema = z.object({
  rev: z.number().int().nonnegative(),
  title: z.string().max(500).optional(),
  body: z.string().optional(),
  pinned: z.boolean().optional(),
  notebookId: z.string().min(1).optional(),
});

const bulkBodySchema = z.object({
  action: z.enum(['move', 'tag', 'delete']),
  noteIds: z.array(z.string().min(1)).min(1).max(500),
  notebookId: z.string().min(1).optional(),
  tag: z.string().min(1).optional(),
});

registerRoute({ method: 'POST', path: '/notes', summary: 'Create a note', body: createBodySchema });
registerRoute({
  method: 'GET',
  path: '/notes',
  summary: 'List notes (paginated, sortable)',
  query: listQuerySchema,
});
registerRoute({
  method: 'GET',
  path: '/notes/:id',
  summary: 'Fetch a note',
  params: idParamsSchema,
});
registerRoute({
  method: 'PATCH',
  path: '/notes/:id',
  summary: 'Update a note (optimistic rev check)',
  params: idParamsSchema,
  body: patchBodySchema,
});
registerRoute({
  method: 'DELETE',
  path: '/notes/:id',
  summary: 'Soft-delete a note to trash',
  params: idParamsSchema,
});
registerRoute({
  method: 'POST',
  path: '/notes/:id/restore',
  summary: 'Restore a note from trash',
  params: idParamsSchema,
});
registerRoute({
  method: 'POST',
  path: '/notes/:id/duplicate',
  summary: 'Duplicate a note with its tags',
  params: idParamsSchema,
});
registerRoute({
  method: 'POST',
  path: '/notes/bulk',
  summary: 'Bulk move/tag/delete notes',
  body: bulkBodySchema,
});

export const notesRoutes: FastifyPluginAsync = async (app) => {
  app.post('/notes', async (request, reply) => {
    const body = parseWith(createBodySchema, request.body, 'body');
    const note = createNote(app.db, {
      notebookId: body.notebookId as NotebookId,
      title: body.title,
      body: body.body,
    });
    reply.status(201);
    return { data: note };
  });

  app.get('/notes', async (request) => {
    const pagination = parsePagination(request.query);
    const { sort, notebookId } = parseWith(listQuerySchema, request.query, 'query');
    const rows = notesRepo(app.db).list({
      sort,
      fetch: pagination.limit + 1,
      cursor: pagination.cursor,
      ...(notebookId !== undefined ? { notebookId: notebookId as NotebookId } : {}),
    });
    return paginated(rows, pagination);
  });

  app.get('/notes/:id', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const note = notesRepo(app.db).get(id as NoteId);
    if (!note) throw notFound('Note', id);
    return { data: { ...note, tags: tagsRepo(app.db).tagsForNote(id as NoteId) } };
  });

  app.patch('/notes/:id', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const body = parseWith(patchBodySchema, request.body, 'body');
    const note = updateNote(app.db, id as NoteId, body.rev, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.body !== undefined ? { body: body.body } : {}),
      ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
      ...(body.notebookId !== undefined ? { notebookId: body.notebookId as NotebookId } : {}),
    });
    return { data: note };
  });

  app.delete('/notes/:id', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const repo = notesRepo(app.db);
    const note = repo.get(id as NoteId);
    if (!note) throw notFound('Note', id);
    if (note.trashedAt === null) {
      repo.trash(id as NoteId); // idempotent: re-deleting is a no-op
      invalidateGraphCache(app.db); // trashed notes drop out of the graph (F235)
    }
    return { data: repo.get(id as NoteId) };
  });

  app.post('/notes/:id/restore', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const repo = notesRepo(app.db);
    const note = repo.get(id as NoteId);
    if (!note) throw notFound('Note', id);
    if (note.trashedAt === null) throw conflict('note is not in the trash', { id });
    repo.restore(id as NoteId);
    invalidateGraphCache(app.db); // restored notes rejoin the graph (F235)
    return { data: repo.get(id as NoteId) };
  });

  app.post('/notes/:id/duplicate', async (request, reply) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const copy = duplicateNote(app.db, id as NoteId);
    reply.status(201);
    return { data: copy };
  });

  app.post('/notes/bulk', async (request) => {
    const body = parseWith(bulkBodySchema, request.body, 'body');
    const result = bulkNotes(app.db, {
      action: body.action,
      noteIds: body.noteIds as NoteId[],
      ...(body.notebookId !== undefined ? { notebookId: body.notebookId as NotebookId } : {}),
      ...(body.tag !== undefined ? { tagName: parseTagName(body.tag) } : {}),
    });
    return { data: { action: body.action, affected: result.affected } };
  });
};
