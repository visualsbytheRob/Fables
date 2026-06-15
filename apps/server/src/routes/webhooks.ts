/**
 * Webhooks & integrations routes (Epic 20, F1931–F1938).
 *
 *  Outbound subscriptions
 *   POST/GET/PUT/DELETE /webhooks/subscriptions[/:id]
 *   GET  /webhooks/deliveries          — delivery log (?subscriptionId=)
 *   GET  /webhooks/dead-letter         — failed deliveries (F1934)
 *   POST /webhooks/emit                — enqueue an event to matching subs (F1931)
 *  Inbound capture (F1932)
 *   POST/GET/DELETE /webhooks/inbound[/:id]
 *   POST /webhooks/inbound/:token/capture — token-auth capture → a new note
 *  RSS output (F1937)
 *   GET  /webhooks/feed?q=             — RSS 2.0 of a query's results
 */

import { notFound, validation } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { assertKnownEvent, webhooksRepo, WEBHOOK_EVENTS } from '../db/repos/webhooks.js';
import { buildFeed, type FeedItem } from '../webhooks/delivery.js';
import { runFqlQuery } from '../services/query.js';

const idParam = z.object({ id: z.string().min(1) });
const tokenParam = z.object({ token: z.string().min(1) });

const subBody = z.object({
  name: z.string().min(1).max(200),
  url: z.string().url().max(2000),
  event: z.string().min(1).max(50).optional(),
  template: z.string().max(5000).nullable().optional(),
  secret: z.string().max(500).nullable().optional(),
  enabled: z.boolean().optional(),
});

registerRoute({
  method: 'POST',
  path: '/webhooks/subscriptions',
  summary: 'Create a subscription (F1931)',
});
registerRoute({ method: 'GET', path: '/webhooks/subscriptions', summary: 'List subscriptions' });
registerRoute({
  method: 'PUT',
  path: '/webhooks/subscriptions/:id',
  summary: 'Update a subscription',
});
registerRoute({
  method: 'DELETE',
  path: '/webhooks/subscriptions/:id',
  summary: 'Delete a subscription',
});
registerRoute({ method: 'GET', path: '/webhooks/deliveries', summary: 'Delivery log (F1934)' });
registerRoute({
  method: 'GET',
  path: '/webhooks/dead-letter',
  summary: 'Dead-letter queue (F1934)',
});
registerRoute({ method: 'POST', path: '/webhooks/emit', summary: 'Emit an event (F1931)' });
registerRoute({ method: 'GET', path: '/webhooks/events', summary: 'Known event types' });
registerRoute({
  method: 'POST',
  path: '/webhooks/inbound',
  summary: 'Create an inbound endpoint (F1932)',
});
registerRoute({ method: 'GET', path: '/webhooks/inbound', summary: 'List inbound endpoints' });
registerRoute({
  method: 'DELETE',
  path: '/webhooks/inbound/:id',
  summary: 'Delete an inbound endpoint',
});
registerRoute({
  method: 'POST',
  path: '/webhooks/inbound/:token/capture',
  summary: 'Capture via token (F1932)',
});
registerRoute({ method: 'GET', path: '/webhooks/feed', summary: 'RSS feed of a query (F1937)' });

export const webhooksRoutes: FastifyPluginAsync = async (app) => {
  const repo = webhooksRepo(app.db);

  app.get('/webhooks/events', async () => ({ data: { events: WEBHOOK_EVENTS } }));

  app.post('/webhooks/subscriptions', async (request) => {
    const body = parseWith(subBody, request.body, 'body');
    if (body.event !== undefined) assertKnownEvent(body.event);
    return {
      data: repo.createSubscription({
        name: body.name,
        url: body.url,
        ...(body.event !== undefined ? { event: body.event } : {}),
        ...(body.template !== undefined ? { template: body.template } : {}),
        ...(body.secret !== undefined ? { secret: body.secret } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      }),
    };
  });

  app.get('/webhooks/subscriptions', async () => ({
    data: { subscriptions: repo.listSubscriptions() },
  }));

  app.put('/webhooks/subscriptions/:id', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const body = parseWith(subBody.partial(), request.body, 'body');
    if (body.event !== undefined) assertKnownEvent(body.event);
    const sub = repo.updateSubscription(id, body);
    if (!sub) throw notFound('subscription', id);
    return { data: sub };
  });

  app.delete('/webhooks/subscriptions/:id', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    if (!repo.removeSubscription(id)) throw notFound('subscription', id);
    return { data: { removed: true } };
  });

  app.get('/webhooks/deliveries', async (request) => {
    const q = parseWith(
      z.object({ subscriptionId: z.string().min(1).optional() }),
      request.query,
      'query',
    );
    return {
      data: {
        deliveries: repo.listDeliveries(q.subscriptionId),
      },
    };
  });

  app.get('/webhooks/dead-letter', async () => ({ data: { deliveries: repo.deadLetters() } }));

  app.post('/webhooks/emit', async (request) => {
    const body = parseWith(
      z.object({
        type: z.string().min(1).max(50),
        noteId: z.string().optional(),
        notebookId: z.string().optional(),
        data: z.record(z.string(), z.unknown()).optional(),
      }),
      request.body,
      'body',
    );
    assertKnownEvent(body.type);
    const deliveries = repo.enqueue({
      type: body.type as never,
      ...(body.noteId !== undefined ? { noteId: body.noteId } : {}),
      ...(body.notebookId !== undefined ? { notebookId: body.notebookId } : {}),
      ...(body.data !== undefined ? { data: body.data } : {}),
    });
    return { data: { enqueued: deliveries.length, deliveries } };
  });

  app.post('/webhooks/inbound', async (request) => {
    const body = parseWith(
      z.object({
        name: z.string().min(1).max(200),
        notebookId: z.string().min(1),
        token: z.string().min(8).max(200).optional(),
      }),
      request.body,
      'body',
    );
    return {
      data: repo.createInbound({
        name: body.name,
        notebookId: body.notebookId,
        ...(body.token !== undefined ? { token: body.token } : {}),
      }),
    };
  });

  app.get('/webhooks/inbound', async () => ({ data: { endpoints: repo.listInbound() } }));

  app.delete('/webhooks/inbound/:id', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    if (!repo.removeInbound(id)) throw notFound('inbound endpoint', id);
    return { data: { removed: true } };
  });

  app.post('/webhooks/inbound/:token/capture', async (request) => {
    const { token } = parseWith(tokenParam, request.params, 'params');
    const body = parseWith(
      z.object({ title: z.string().max(500).optional(), body: z.string().max(100000).optional() }),
      request.body,
      'body',
    );
    const result = repo.capture(token, {
      title: body.title ?? 'Captured',
      body: body.body ?? '',
    });
    if (!result) throw validation('invalid or disabled capture token');
    return { data: result };
  });

  // RSS 2.0 of a query's results (F1937).
  app.get('/webhooks/feed', async (request, reply) => {
    const q = parseWith(
      z.object({ q: z.string().default(''), title: z.string().max(200).optional() }),
      request.query,
      'query',
    );
    const { notes } = runFqlQuery(app.db, q.q, { fetch: 50, cursor: null });
    const items: FeedItem[] = notes.map((n) => ({
      title: n.title === '' ? '(untitled)' : n.title,
      link: `/notes/${n.id}`,
      guid: n.id,
      pubDate: new Date(n.updatedAt),
      description: n.body.slice(0, 500),
    }));
    const xml = buildFeed(items, {
      title: q.title ?? 'Fables query feed',
      link: '/',
      description: `Results for: ${q.q || '(all notes)'}`,
    });
    return reply.header('content-type', 'application/rss+xml; charset=utf-8').send(xml);
  });
};
