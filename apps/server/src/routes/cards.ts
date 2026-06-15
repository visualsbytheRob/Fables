/**
 * Spaced-repetition card routes (Epic 18, F1701–F1710).
 *
 *  POST   /cards                 — create a card (optionally bound to a note)
 *  GET    /cards/:id             — fetch a card
 *  DELETE /cards/:id             — delete a card
 *  GET    /cards/:id/log         — full review history (F1703)
 *  POST   /cards/:id/review      — rate a card; FSRS reschedules it (F1702)
 *  POST   /cards/:id/suspend     — take a card out of rotation (F1707)
 *  POST   /cards/:id/unsuspend   — return it to review
 *  POST   /cards/:id/bury        — bury until tomorrow (F1707)
 *  GET    /review/queue          — due review cards + capped new intake (F1705/F1706)
 *  GET    /review/counts         — due / new / suspended counts
 *  GET    /review/orphans        — cards whose note was deleted (F1718)
 *
 * The scheduler is pure FSRS-5 (learning/fsrs.ts); this exposes the queue + the
 * review action the phone-first review UI drives.
 */

import { notFound, validation } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { cardsRepo } from '../db/repos/cards.js';
import type { Rating } from '../learning/fsrs.js';

registerRoute({ method: 'POST', path: '/cards', summary: 'Create a card (F1701)' });
registerRoute({ method: 'GET', path: '/cards/:id', summary: 'Fetch a card' });
registerRoute({ method: 'DELETE', path: '/cards/:id', summary: 'Delete a card' });
registerRoute({ method: 'GET', path: '/cards/:id/log', summary: 'Review history (F1703)' });
registerRoute({ method: 'POST', path: '/cards/:id/review', summary: 'Rate a card (F1702)' });
registerRoute({ method: 'POST', path: '/cards/:id/suspend', summary: 'Suspend a card (F1707)' });
registerRoute({ method: 'POST', path: '/cards/:id/unsuspend', summary: 'Unsuspend a card' });
registerRoute({ method: 'POST', path: '/cards/:id/bury', summary: 'Bury a card (F1707)' });
registerRoute({ method: 'GET', path: '/review/queue', summary: 'Due queue (F1705/F1706)' });
registerRoute({ method: 'GET', path: '/review/counts', summary: 'Due/new/suspended counts' });
registerRoute({ method: 'GET', path: '/review/orphans', summary: 'Orphaned cards (F1718)' });

const idParams = z.object({ id: z.string().min(1) });

const createBody = z.object({
  prompt: z.string().min(1).max(10_000),
  answer: z.string().min(1).max(10_000),
  noteId: z.string().min(1).optional(),
  blockRef: z.string().max(500).optional(),
  kind: z.string().max(50).optional(),
});

const reviewBody = z.object({
  /** 1 Again · 2 Hard · 3 Good · 4 Easy. */
  rating: z.number().int().min(1).max(4),
  /** Optional client clock for timezone-correct scheduling (F1705). */
  now: z.string().datetime().optional(),
  /** Target retention (0.7–0.99). Default 0.9. */
  requestRetention: z.number().min(0.7).max(0.99).optional(),
});

const queueQuery = z.object({
  now: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  newLimit: z.coerce.number().int().min(0).max(1000).optional(),
});

export const cardRoutes: FastifyPluginAsync = async (app) => {
  const repo = cardsRepo(app.db);

  app.post('/cards', async (request) => {
    const body = parseWith(createBody, request.body, 'body');
    // Guard a bound note exists, when provided.
    if (body.noteId) {
      const exists = app.db.prepare('SELECT 1 FROM notes WHERE id = ?').get(body.noteId);
      if (!exists) throw notFound('note', body.noteId);
    }
    return {
      data: repo.create({
        prompt: body.prompt,
        answer: body.answer,
        ...(body.noteId !== undefined ? { noteId: body.noteId } : {}),
        ...(body.blockRef !== undefined ? { blockRef: body.blockRef } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
      }),
    };
  });

  app.get('/review/queue', async (request) => {
    const q = parseWith(queueQuery, request.query, 'query');
    return {
      data: {
        cards: repo.dueQueue({
          ...(q.now !== undefined ? { now: q.now } : {}),
          ...(q.limit !== undefined ? { limit: q.limit } : {}),
          ...(q.newLimit !== undefined ? { newLimit: q.newLimit } : {}),
        }),
      },
    };
  });

  app.get('/review/counts', async (request) => {
    const q = parseWith(
      z.object({ now: z.string().datetime().optional() }),
      request.query,
      'query',
    );
    return { data: repo.counts(q.now) };
  });

  app.get('/review/orphans', async () => {
    return { data: { cards: repo.orphans() } };
  });

  app.get('/cards/:id', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    const card = repo.get(id);
    if (!card) throw notFound('card', id);
    return { data: card };
  });

  app.delete('/cards/:id', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    if (!repo.remove(id)) throw notFound('card', id);
    return { data: { removed: true } };
  });

  app.get('/cards/:id/log', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    if (!repo.get(id)) throw notFound('card', id);
    return { data: { log: repo.reviewLog(id) } };
  });

  app.post('/cards/:id/review', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    const body = parseWith(reviewBody, request.body, 'body');
    const card = repo.review(
      id,
      body.rating as Rating,
      body.now,
      body.requestRetention !== undefined ? { requestRetention: body.requestRetention } : {},
    );
    if (!card) throw notFound('card', id);
    return { data: card };
  });

  app.post('/cards/:id/suspend', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    if (!repo.setState(id, 'suspended')) throw notFound('card', id);
    return { data: { state: 'suspended' } };
  });

  app.post('/cards/:id/unsuspend', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    const card = repo.get(id);
    if (!card) throw notFound('card', id);
    // A suspended card returns to 'review' if it has memory state, else 'new'.
    const next = card.stability !== null ? 'review' : 'new';
    repo.setState(id, next);
    return { data: { state: next } };
  });

  app.post('/cards/:id/bury', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    if (!repo.get(id)) throw notFound('card', id);
    if (!repo.setState(id, 'buried')) throw validation('could not bury card');
    return { data: { state: 'buried' } };
  });
};
