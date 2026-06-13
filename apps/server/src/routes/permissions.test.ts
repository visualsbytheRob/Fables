import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

let app: FastifyInstance;
let heroId: string;
let foxId: string;
let storyId: string;

async function post(url: string, payload?: unknown) {
  return app.inject({ method: 'POST', url: `/api/v1${url}`, payload: (payload ?? {}) as object });
}
async function get(url: string) {
  return app.inject({ method: 'GET', url: `/api/v1${url}` });
}

async function setEntry(id: string, source: string) {
  const files = (await get(`/stories/${id}/files`)).json().data;
  const entry = files.find((f: { path: string }) => f.path === 'main.fable');
  await app.inject({
    method: 'PATCH',
    url: `/api/v1/stories/${id}/files/${entry.id}`,
    payload: { source },
  });
}

const effect = (pt: string, entity: string, field: string, value: unknown) =>
  post(`/stories/${storyId}/effects`, {
    playthroughId: pt,
    idempotencyKey: `${pt}-${entity}-${field}-${Math.random()}`,
    events: [{ type: 'entity_set', payload: { entity, field, value } }],
  });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  heroId = (
    await post('/entities', { type: 'character', name: 'Hero', fields: { health: 100 } })
  ).json().data.id;
  foxId = (await post('/entities', { type: 'character', name: 'Fox', fields: { health: 5 } })).json()
    .data.id;
  expect(heroId && foxId).toBeTruthy();
  storyId = (await post('/stories', { title: 'Permissioned' })).json().data.id;
  // Declares Hero writable; Fox is not declared at all.
  await setEntry(storyId, `# title: Permissioned\n# writes: Hero\nHi @Hero.health\n-> END\n`);
});

afterAll(async () => {
  await app.close();
});

describe('permission matrix (F648)', () => {
  it('allows writes to declared entities', async () => {
    const res = await effect('p1', 'Hero', 'health', 90);
    expect(res.statusCode).toBe(201);
    expect(res.json().data.results[0]).toMatchObject({ field: 'health', newValue: 90 });
  });

  it('FORBIDs writes to undeclared entities', async () => {
    const res = await effect('p1', 'Fox', 'health', 1);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    expect(res.json().error.message).toContain('Fox');
    // The forbidden write rolled back: Fox is unchanged.
    const fox = (await get(`/entities/${foxId}`)).json().data;
    expect(fox.fields.health).toBe(5);
  });

  it('serves only declared-readable entities in knowledge-state', async () => {
    const body = (await get(`/stories/${storyId}/knowledge-state?playthroughId=p1`)).json().data;
    expect(body.entities.hero).toBeDefined();
    expect(body.entities.fox).toBeUndefined();
  });

  it('treats undeclared stories as unrestricted', async () => {
    const open = (await post('/stories', { title: 'Open' })).json().data.id;
    await setEntry(open, `# title: Open\nHi\n-> END\n`);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${open}/effects`,
      payload: {
        playthroughId: 'o1',
        idempotencyKey: 'open-1',
        events: [{ type: 'entity_set', payload: { entity: 'Fox', field: 'health', value: 3 } }],
      },
    });
    expect(res.statusCode).toBe(201);
  });
});
