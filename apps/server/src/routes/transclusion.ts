import { validation, type NoteId } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { noteBlock, noteSection } from '../services/transclusion.js';

/**
 * Transclusion source endpoints (F671/F672): fetch a referenced block or
 * section of a note so the renderer can embed live content. Stale references
 * surface as a structured 404 from the service.
 */

const blockParamsSchema = z.object({
  id: z.string().min(1),
  blockId: z.string().min(1).max(100),
});
const idParamsSchema = z.object({ id: z.string().min(1) });
const sectionQuerySchema = z.object({ heading: z.string().min(1).max(300) });

registerRoute({
  method: 'GET',
  path: '/notes/:id/block/:blockId',
  summary: 'Fetch one `^block` of a note for transclusion',
  params: blockParamsSchema,
});
registerRoute({
  method: 'GET',
  path: '/notes/:id/section',
  summary: 'Fetch a heading-delimited section of a note for transclusion',
  params: idParamsSchema,
  query: sectionQuerySchema,
});

export const transclusionRoutes: FastifyPluginAsync = async (app) => {
  app.get('/notes/:id/block/:blockId', async (request) => {
    const { id, blockId } = parseWith(blockParamsSchema, request.params, 'params');
    return { data: noteBlock(app.db, id as NoteId, blockId) };
  });

  app.get('/notes/:id/section', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const query = parseWith(sectionQuerySchema, request.query, 'query');
    if (query.heading === undefined) throw validation('heading query is required');
    return { data: noteSection(app.db, id as NoteId, query.heading) };
  });
};
