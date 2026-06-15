/**
 * Webhooks route tests (Epic 20, F1931–F1938).
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { webhooksRepo } from '../db/repos/webhooks.js';

let app: FastifyInstance;
let notebookId: string;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  notebookId = notebooksRepo(app.db).create({ name: 'Captured' }).id;
});

afterAll(async () => {
  await app.close();
});

describe('outbound subscriptions + delivery log (F1931/F1934)', () => {
  it('creates a subscription and enqueues a delivery for a matching event', async () => {
    const sub = (
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/webhooks/subscriptions',
          payload: { name: 'CI', url: 'https://example.test/hook', event: 'note.created' },
        })
      ).json() as { data: { id: string } }
    ).data;

    const emit = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/emit',
      payload: { type: 'note.created', noteId: 'note_x' },
    });
    expect((emit.json() as { data: { enqueued: number } }).data.enqueued).toBe(1);

    const deliveries = (
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/webhooks/deliveries?subscriptionId=${sub.id}`,
        })
      ).json() as { data: { deliveries: { status: string }[] } }
    ).data.deliveries;
    expect(deliveries[0]?.status).toBe('pending');
  });

  it('rejects an unknown event type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/emit',
      payload: { type: 'note.exploded' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('dead-letters a delivery after retries are exhausted (F1934)', () => {
    const repo = webhooksRepo(app.db);
    const sub = repo.createSubscription({ name: 'flaky', url: 'https://x.test', event: '*' });
    const [delivery] = repo.enqueue({ type: 'custom' });
    expect(delivery).toBeDefined();
    // Two attempts with maxAttempts=2: first retries, second dead-letters.
    repo.recordResult(delivery!.id, 500, { maxAttempts: 2 });
    const dead = repo.recordResult(delivery!.id, 500, { maxAttempts: 2 });
    expect(dead?.status).toBe('dead');
    expect(repo.deadLetters().some((d) => d.id === delivery!.id)).toBe(true);
    expect(repo.removeSubscription(sub.id)).toBe(true);
  });
});

describe('inbound capture (F1932)', () => {
  it('captures a note via a valid token and rejects a bad one', async () => {
    const endpoint = (
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/webhooks/inbound',
          payload: { name: 'iOS Shortcut', notebookId },
        })
      ).json() as { data: { token: string } }
    ).data;

    const ok = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/inbound/${endpoint.token}/capture`,
      payload: { title: 'From my phone', body: 'hello' },
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { data: { noteId: string } }).data.noteId).toMatch(/^note_/);

    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/inbound/not-a-real-token/capture',
      payload: { title: 'nope' },
    });
    expect(bad.statusCode).toBe(422);
  });
});

describe('RSS feed (F1937)', () => {
  it('emits valid escaped RSS for a query', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/webhooks/feed?q=' });
    expect(res.headers['content-type']).toContain('application/rss+xml');
    expect(res.body).toContain('<rss version="2.0">');
    expect(res.body).toContain('<channel>');
  });
});
