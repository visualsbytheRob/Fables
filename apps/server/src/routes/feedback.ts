/**
 * Reader feedback routes (Epic 19, F1851–F1858).
 *
 *  POST /stories/:id/feedback              — add a per-moment reader note (F1851)
 *  GET  /stories/:id/feedback              — author inbox: all feedback
 *  POST /stories/:id/play-events           — log a knot visit / choice / ending
 *  GET  /stories/:id/feedback/choice-stats — choice pick counts (F1854)
 *  GET  /stories/:id/feedback/drop-off     — per-knot drop-off (F1855)
 *  GET  /stories/:id/feedback/endings      — ending distribution (F1856)
 *  POST /stories/:id/feedback/export       — exportable feedback bundle (F1852)
 *  POST /stories/:id/feedback/import       — import a reader bundle (F1853)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { StoryId } from '@fables/core';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { storiesRepo } from '../db/repos/stories.js';
import { feedbackRepo } from '../db/repos/feedback.js';

const paths: [string, string, string][] = [
  ['POST', '/stories/:id/feedback', 'Add reader feedback (F1851)'],
  ['GET', '/stories/:id/feedback', 'Feedback inbox'],
  ['POST', '/stories/:id/play-events', 'Log a play event'],
  ['GET', '/stories/:id/feedback/choice-stats', 'Choice statistics (F1854)'],
  ['GET', '/stories/:id/feedback/drop-off', 'Drop-off analysis (F1855)'],
  ['GET', '/stories/:id/feedback/endings', 'Ending distribution (F1856)'],
  ['POST', '/stories/:id/feedback/export', 'Export feedback bundle (F1852)'],
  ['POST', '/stories/:id/feedback/import', 'Import feedback bundle (F1853)'],
];
for (const [method, path, summary] of paths)
  registerRoute({ method: method as 'GET', path, summary });

const idParam = z.object({ id: z.string().min(1) });

const feedbackBody = z.object({
  knot: z.string().max(200).optional(),
  kind: z.enum(['note', 'reaction', 'bug']).optional(),
  text: z.string().min(1).max(10_000),
  sentiment: z.string().max(50).optional(),
});

const eventBody = z.object({
  sessionId: z.string().min(1).max(200),
  type: z.enum(['visit', 'choice', 'ending']),
  knot: z.string().max(200),
  choiceIndex: z.number().int().min(0).optional(),
  label: z.string().max(500).optional(),
  seq: z.number().int().min(0).optional(),
});

export const feedbackRoutes: FastifyPluginAsync = async (app) => {
  const stories = storiesRepo(app.db);
  const repo = feedbackRepo(app.db);
  const ensure = (id: string) => stories.mustGet(id as StoryId);

  app.post('/stories/:id/feedback', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    ensure(id);
    const body = parseWith(feedbackBody, request.body, 'body');
    return {
      data: repo.addFeedback(id, {
        ...(body.knot !== undefined ? { knot: body.knot } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        text: body.text,
        ...(body.sentiment !== undefined ? { sentiment: body.sentiment } : {}),
      }),
    };
  });

  app.get('/stories/:id/feedback', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    ensure(id);
    return { data: { feedback: repo.listFeedback(id) } };
  });

  app.post('/stories/:id/play-events', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    ensure(id);
    const e = parseWith(eventBody, request.body, 'body');
    repo.logEvent(id, {
      sessionId: e.sessionId,
      type: e.type,
      knot: e.knot,
      ...(e.choiceIndex !== undefined ? { choiceIndex: e.choiceIndex } : {}),
      ...(e.label !== undefined ? { label: e.label } : {}),
      ...(e.seq !== undefined ? { seq: e.seq } : {}),
    });
    return { data: { logged: true } };
  });

  app.get('/stories/:id/feedback/choice-stats', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    ensure(id);
    return { data: { stats: repo.choiceStats(id) } };
  });

  app.get('/stories/:id/feedback/drop-off', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    ensure(id);
    return { data: { dropOff: repo.dropOff(id) } };
  });

  app.get('/stories/:id/feedback/endings', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    ensure(id);
    return { data: { endings: repo.endingDistribution(id) } };
  });

  app.post('/stories/:id/feedback/export', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    ensure(id);
    const body = parseWith(z.object({ anonymize: z.boolean().optional() }), request.body, 'body');
    return { data: repo.exportBundle(id, body.anonymize ?? false) };
  });

  app.post('/stories/:id/feedback/import', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    ensure(id);
    const body = parseWith(
      z.object({
        feedback: z
          .array(
            z.object({
              knot: z.string().max(200).optional(),
              kind: z.enum(['note', 'reaction', 'bug']).optional(),
              text: z.string().min(1).max(10_000),
              sentiment: z.string().max(50).nullable().optional(),
            }),
          )
          .max(100_000),
      }),
      request.body,
      'body',
    );
    return { data: { imported: repo.importBundle(id, body) } };
  });
};
