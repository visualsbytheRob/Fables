/**
 * Deck routes (Epic 18, F1741–F1748).
 *
 *  POST   /decks                — create a deck (saved filter + settings)
 *  GET    /decks                — list decks
 *  GET    /decks/:id            — fetch a deck
 *  PUT    /decks/:id            — update a deck
 *  DELETE /decks/:id            — delete a deck
 *  GET    /decks/:id/cards      — dynamic membership (F1741)
 *  GET    /decks/:id/dashboard  — due count + forecast (F1743)
 *  GET    /decks/:id/export     — .fdeck snapshot (F1746)
 *  POST   /decks/import         — import a .fdeck snapshot (F1746)
 *  POST   /decks/review         — cross-deck due cards (F1744)
 *  POST   /study                — ad-hoc filtered study session (F1748)
 */

import { notFound } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { decksRepo } from '../db/repos/decks.js';
import { cardsRepo } from '../db/repos/cards.js';

registerRoute({ method: 'POST', path: '/decks', summary: 'Create a deck (F1741)' });
registerRoute({ method: 'GET', path: '/decks', summary: 'List decks' });
registerRoute({ method: 'GET', path: '/decks/:id', summary: 'Fetch a deck' });
registerRoute({ method: 'PUT', path: '/decks/:id', summary: 'Update a deck (F1742)' });
registerRoute({ method: 'DELETE', path: '/decks/:id', summary: 'Delete a deck' });
registerRoute({ method: 'GET', path: '/decks/:id/cards', summary: 'Deck members (F1741)' });
registerRoute({ method: 'GET', path: '/decks/:id/dashboard', summary: 'Deck dashboard (F1743)' });
registerRoute({ method: 'GET', path: '/decks/:id/export', summary: 'Export .fdeck (F1746)' });
registerRoute({ method: 'POST', path: '/decks/import', summary: 'Import .fdeck (F1746)' });
registerRoute({ method: 'POST', path: '/decks/review', summary: 'Cross-deck review (F1744)' });
registerRoute({ method: 'POST', path: '/study', summary: 'Custom study session (F1748)' });

const idParams = z.object({ id: z.string().min(1) });

const filterSchema = z
  .object({
    state: z.enum(['new', 'learning', 'review', 'relearning', 'suspended', 'buried']),
    kind: z.string().max(50),
    noteId: z.string().min(1),
    notebookId: z.string().min(1),
    tag: z.string().min(1),
    query: z.string().max(500),
    dueBefore: z.string().datetime(),
    minLapses: z.number().int().min(0),
  })
  .partial();

const settingsSchema = z
  .object({
    requestRetention: z.number().min(0.7).max(0.99),
    newLimit: z.number().int().min(0).max(1000),
    maxIntervalDays: z
      .number()
      .int()
      .min(1)
      .max(365 * 100),
  })
  .partial();

const createBody = z.object({
  name: z.string().min(1).max(200),
  filter: filterSchema.optional(),
  settings: settingsSchema.optional(),
});

export const deckRoutes: FastifyPluginAsync = async (app) => {
  const repo = decksRepo(app.db);
  const cards = cardsRepo(app.db);

  app.post('/decks', async (request) => {
    const body = parseWith(createBody, request.body, 'body');
    return {
      data: repo.create({
        name: body.name,
        ...(body.filter !== undefined ? { filter: body.filter } : {}),
        ...(body.settings !== undefined ? { settings: body.settings } : {}),
      }),
    };
  });

  app.get('/decks', async () => {
    return { data: { decks: repo.list() } };
  });

  app.post('/decks/import', async (request) => {
    const body = parseWith(
      z.object({
        deck: z.object({
          name: z.string().min(1).max(200),
          filter: filterSchema.optional(),
          settings: settingsSchema.optional(),
        }),
        cards: z
          .array(
            z.object({
              prompt: z.string().min(1).max(10_000),
              answer: z.string().min(1).max(10_000),
              kind: z.string().max(50).optional(),
            }),
          )
          .max(100_000),
      }),
      request.body,
      'body',
    );
    return { data: repo.importDeck(body) };
  });

  app.post('/decks/review', async (request) => {
    const body = parseWith(
      z.object({
        deckIds: z.array(z.string().min(1)).min(1).max(100),
        now: z.string().datetime().optional(),
      }),
      request.body,
      'body',
    );
    const now = body.now ?? new Date().toISOString();
    const seen = new Set<string>();
    const queue: ReturnType<typeof cards.get>[] = [];
    for (const deckId of body.deckIds) {
      for (const card of repo.members(deckId)) {
        if (seen.has(card.id)) continue;
        const dueNow =
          (card.state === 'review' || card.state === 'relearning' || card.state === 'learning') &&
          card.due !== null &&
          card.due <= now;
        if (dueNow || card.state === 'new') {
          seen.add(card.id);
          queue.push(card);
        }
      }
    }
    return { data: { cards: queue } };
  });

  app.post('/study', async (request) => {
    const body = parseWith(
      z.object({ filter: filterSchema, limit: z.number().int().min(1).max(1000).optional() }),
      request.body,
      'body',
    );
    return {
      data: { cards: cards.browse({ ...body.filter, limit: body.limit ?? 100 }) },
    };
  });

  app.get('/decks/:id', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    const deck = repo.get(id);
    if (!deck) throw notFound('deck', id);
    return { data: deck };
  });

  app.put('/decks/:id', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    const body = parseWith(
      z.object({
        name: z.string().min(1).max(200).optional(),
        filter: filterSchema.optional(),
        settings: settingsSchema.optional(),
      }),
      request.body,
      'body',
    );
    const deck = repo.update(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.filter !== undefined ? { filter: body.filter } : {}),
      ...(body.settings !== undefined ? { settings: body.settings } : {}),
    });
    if (!deck) throw notFound('deck', id);
    return { data: deck };
  });

  app.delete('/decks/:id', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    if (!repo.remove(id)) throw notFound('deck', id);
    return { data: { removed: true } };
  });

  app.get('/decks/:id/cards', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    if (!repo.get(id)) throw notFound('deck', id);
    return { data: { cards: repo.members(id) } };
  });

  app.get('/decks/:id/dashboard', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    const q = parseWith(
      z.object({
        now: z.string().datetime().optional(),
        days: z.coerce.number().int().min(1).max(90).optional(),
      }),
      request.query,
      'query',
    );
    if (!repo.get(id)) throw notFound('deck', id);
    return { data: repo.dashboard(id, q.now, q.days) };
  });

  app.get('/decks/:id/export', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    const snapshot = repo.exportDeck(id);
    if (!snapshot) throw notFound('deck', id);
    return { data: snapshot };
  });
};
