import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

let app: FastifyInstance;

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
const effect = (storyId: string, pt: string, entity: string, value: unknown) =>
  post(`/stories/${storyId}/effects`, {
    playthroughId: pt,
    idempotencyKey: `${storyId}-${pt}-${entity}-${value}-${Math.random()}`,
    events: [{ type: 'entity_set', payload: { entity, field: 'health', value } }],
  });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
});
afterAll(async () => {
  await app.close();
});

describe('world dashboard + mutations (F681/F682)', () => {
  it('flags story-mutated fields', async () => {
    const id = (
      await post('/entities', { type: 'character', name: 'Atlas', fields: { health: 50 } })
    ).json().data.id;
    const storyId = (await post('/stories', { title: 'Mutator' })).json().data.id;
    await setEntry(storyId, `# title: Mutator\n# writes: Atlas\n-> END\n`);
    await effect(storyId, 'pt1', 'Atlas', 25);

    const world = (await get('/world')).json().data;
    const row = world.find((e: { id: string }) => e.id === id);
    expect(row.fields.health).toBe(25);
    expect(row.mutatedFields.health.count).toBeGreaterThan(0);
    expect(row.mutatedFields.health.storyIds).toContain(storyId);
  });
});

describe('revert (F683)', () => {
  it('restores a field from the audit and records a revert row', async () => {
    const id = (
      await post('/entities', { type: 'character', name: 'Reverto', fields: { health: 100 } })
    ).json().data.id;
    const storyId = (await post('/stories', { title: 'Rev' })).json().data.id;
    await setEntry(storyId, `# title: Rev\n# writes: Reverto\n-> END\n`);
    await effect(storyId, 'pt1', 'Reverto', 10);
    expect((await get(`/entities/${id}`)).json().data.fields.health).toBe(10);

    const res = await post(`/entities/${id}/revert`, { field: 'health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.reverted[0]).toMatchObject({ field: 'health', to: 100 });
    expect((await get(`/entities/${id}`)).json().data.fields.health).toBe(100);

    const muts = (await get(`/entities/${id}/mutations`)).json().data;
    expect(muts.some((m: { kind: string }) => m.kind === 'revert')).toBe(true);
  });
});

describe('snapshots + diff (F684/F685)', () => {
  it('captures, lists, and diffs snapshots field-by-field', async () => {
    const id = (
      await post('/entities', { type: 'character', name: 'Snapshotted', fields: { health: 1 } })
    ).json().data.id;
    const a = (await post('/world/snapshots', { name: `snap-a-${Date.now()}` })).json().data;
    expect(a.id).toBeDefined();

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/entities/${id}`,
      payload: { fields: { health: 7 } },
    });
    const b = (await post('/world/snapshots', { name: `snap-b-${Date.now()}` })).json().data;

    const list = (await get('/world/snapshots')).json().data;
    expect(list.length).toBeGreaterThanOrEqual(2);

    const diff = (await get(`/world/snapshots/${a.id}/diff/${b.id}`)).json().data;
    const changed = diff.fields.find(
      (f: { entityId: string; field: string }) => f.entityId === id && f.field === 'health',
    );
    expect(changed).toMatchObject({ a: 1, b: 7, status: 'changed' });
  });

  it('rejects duplicate snapshot names', async () => {
    const name = `dupe-${Date.now()}`;
    expect((await post('/world/snapshots', { name })).statusCode).toBe(201);
    expect((await post('/world/snapshots', { name })).statusCode).toBe(409);
  });
});

describe('sandbox mode (F686)', () => {
  it('routes writes to an overlay, leaving the live entity untouched', async () => {
    const id = (
      await post('/entities', { type: 'character', name: 'Sandboxed', fields: { health: 40 } })
    ).json().data.id;
    const storyId = (await post('/stories', { title: 'Sandbox' })).json().data.id;
    await setEntry(storyId, `# title: Sandbox\n# writes: Sandboxed\n-> END\n`);
    await post(`/stories/${storyId}/playthroughs`, { id: 'sbx', sandbox: true });

    const res = await effect(storyId, 'sbx', 'Sandboxed', 3);
    expect(res.statusCode).toBe(201);
    expect(res.json().data.results[0]).toMatchObject({ sandbox: true });

    // Live entity is unchanged.
    expect((await get(`/entities/${id}`)).json().data.fields.health).toBe(40);
    // But knowledge-state read through the overlay sees the sandbox value.
    const ks = (await get(`/stories/${storyId}/knowledge-state?playthroughId=sbx`)).json().data;
    expect(ks.entities.sandboxed.fields.health).toBe(3);
  });
});

describe('conflicts (F687)', () => {
  it('surfaces fields written by two or more stories', async () => {
    await post('/entities', { type: 'character', name: 'Contested', fields: { health: 5 } });
    const s1 = (await post('/stories', { title: 'Writer 1' })).json().data.id;
    const s2 = (await post('/stories', { title: 'Writer 2' })).json().data.id;
    for (const s of [s1, s2]) await setEntry(s, `# title: w\n# writes: Contested\n-> END\n`);
    await effect(s1, 'p', 'Contested', 1);
    await effect(s2, 'p', 'Contested', 2);

    const conflicts = (await get('/world/conflicts')).json().data;
    const hit = conflicts.find((c: { field: string }) => c.field === 'health');
    expect(hit).toBeDefined();
    expect(hit.stories.length).toBeGreaterThanOrEqual(2);
  });
});

describe('export / import (F688)', () => {
  it('exports every entity with a version and round-trips field changes', async () => {
    const id = (
      await post('/entities', { type: 'character', name: 'Exported', fields: { health: 30 } })
    ).json().data.id;

    const exported = (await get('/world/export')).json().data;
    expect(exported.version).toBeGreaterThanOrEqual(1);
    const row = exported.entities.find((e: { id: string }) => e.id === id);
    expect(row).toMatchObject({ id, name: 'Exported', fields: { health: 30 } });

    // Mutate the import payload, then import it back: known id is upserted.
    row.fields.health = 99;
    const res = await post('/world/import', exported);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.imported).toBeGreaterThanOrEqual(1);
    expect((await get(`/entities/${id}`)).json().data.fields.health).toBe(99);
  });

  it('skips unknown entity ids and rejects malformed payloads', async () => {
    const res = await post('/world/import', {
      version: 1,
      entities: [{ id: 'ent_does_not_exist', type: 'character', name: 'Ghost', fields: { a: 1 } }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ imported: 0, skipped: 1 });

    const bad = await post('/world/import', { version: 1, entities: [{ id: 'x' }] });
    expect(bad.statusCode).toBe(422);
  });
});
