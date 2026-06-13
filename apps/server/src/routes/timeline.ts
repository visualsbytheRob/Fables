import { validation, type EntityId, type NotebookId, type StoryId } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { entitiesRepo } from '../db/repos/entities.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { createNote } from '../services/notes.js';
import {
  buildTimeline,
  entityTimeline,
  renderChronicleMarkdown,
  storyChronology,
  TIMELINE_TYPES,
  type TimelineType,
} from '../services/timeline.js';

/**
 * Timeline routes (F651–F660): the unified day-grouped feed, per-story
 * chronology, per-entity timelines, and markdown chronicle export.
 */

const idParamsSchema = z.object({ id: z.string().min(1) });

const timelineQuerySchema = z.object({
  types: z.string().min(1).optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

const exportBodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  notebookId: z.string().min(1).optional(),
  types: z.array(z.enum(['notes', 'stories', 'playthroughs'])).optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
});

const TIMELINE_EXPORT_NOTEBOOK = 'Chronicles';

function parseTypes(raw: string | undefined): TimelineType[] {
  if (raw === undefined) return TIMELINE_TYPES;
  const parsed = raw.split(',').map((t) => t.trim());
  const invalid = parsed.filter((t) => !TIMELINE_TYPES.includes(t as TimelineType));
  if (invalid.length > 0) {
    throw validation('unknown timeline types', { invalid, allowed: TIMELINE_TYPES });
  }
  return parsed as TimelineType[];
}

registerRoute({
  method: 'GET',
  path: '/timeline',
  summary: 'Unified day-grouped feed of note/story/playthrough events',
  query: timelineQuerySchema,
});
registerRoute({
  method: 'GET',
  path: '/stories/:id/chronology',
  summary: 'Story-world chronology from `# when:` tags',
  params: idParamsSchema,
});
registerRoute({
  method: 'GET',
  path: '/entities/:id/timeline',
  summary: 'Every event involving an entity (mentions, mutations, encounters)',
  params: idParamsSchema,
});
registerRoute({
  method: 'POST',
  path: '/timeline/export',
  summary: 'Export the timeline as a markdown chronicle note',
  body: exportBodySchema,
});

export const timelineRoutes: FastifyPluginAsync = async (app) => {
  app.get('/timeline', async (request) => {
    const query = parseWith(timelineQuerySchema, request.query, 'query');
    const page = buildTimeline(app.db, {
      types: parseTypes(query.types),
      ...(query.from !== undefined ? { from: query.from } : {}),
      ...(query.to !== undefined ? { to: query.to } : {}),
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    return { data: page.groups, page: { nextCursor: page.nextCursor, limit: query.limit } };
  });

  app.get('/stories/:id/chronology', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    return { data: storyChronology(app.db, id as StoryId) };
  });

  app.get('/entities/:id/timeline', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    entitiesRepo(app.db).mustGet(id as EntityId);
    return { data: entityTimeline(app.db, id as EntityId) };
  });

  app.post('/timeline/export', async (request, reply) => {
    const body = parseWith(exportBodySchema, request.body, 'body');
    const page = buildTimeline(app.db, {
      types: body.types ?? TIMELINE_TYPES,
      ...(body.from !== undefined ? { from: body.from } : {}),
      ...(body.to !== undefined ? { to: body.to } : {}),
      limit: body.limit ?? 1000,
      cursor: null,
    });
    const title = body.title ?? `Chronicle ${new Date().toISOString().slice(0, 10)}`;
    const markdown = renderChronicleMarkdown(title, page.groups);

    const notebooks = notebooksRepo(app.db);
    const notebookId = (body.notebookId ??
      (
        notebooks.list({ includeArchived: true }).find((n) => n.name === TIMELINE_EXPORT_NOTEBOOK) ??
        notebooks.create({ name: TIMELINE_EXPORT_NOTEBOOK })
      ).id) as NotebookId;
    const note = createNote(app.db, { notebookId, title, body: markdown });
    reply.status(201);
    return { data: { noteId: note.id, title, groups: page.groups.length } };
  });
};
