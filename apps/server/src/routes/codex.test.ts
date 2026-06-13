import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

let app: FastifyInstance;
let storyId: string;
let foxId: string;
let denId: string;

async function post(url: string, payload: unknown) {
  return app.inject({ method: 'POST', url: `/api/v1${url}`, payload: payload as object });
}

const codex = async (playthroughId: string) =>
  app.inject({
    method: 'GET',
    url: `/api/v1/stories/${storyId}/codex?playthroughId=${playthroughId}`,
  });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  storyId = (await post('/stories', { title: 'The Den' })).json().data.id;
  foxId = (
    await post('/entities', {
      type: 'character',
      name: 'Vesper',
      fields: { health: 7, role: 'spy-master' },
    })
  ).json().data.id;
  denId = (await post('/entities', { type: 'place', name: 'The Low Den' })).json().data.id;
});

afterAll(async () => {
  await app.close();
});

describe('met tracking (F613)', () => {
  it('records first encounters and counts repeats', async () => {
    const first = await post(`/stories/${storyId}/playthroughs/pt1/encounters`, {
      entityId: foxId,
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().data).toMatchObject({ entityId: foxId, encounters: 1, repeat: false });
    expect(first.json().data.entryId).toMatch(/^cdx_/);

    const again = await post(`/stories/${storyId}/playthroughs/pt1/encounters`, {
      entityId: foxId,
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().data).toMatchObject({ encounters: 2, repeat: true });
    // deterministic entry id (F619)
    expect(again.json().data.entryId).toBe(first.json().data.entryId);
  });

  it('404s on unknown stories and entities', async () => {
    const noStory = await post('/stories/story_nope/playthroughs/pt1/encounters', {
      entityId: foxId,
    });
    expect(noStory.statusCode).toBe(404);
    const noEntity = await post(`/stories/${storyId}/playthroughs/pt1/encounters`, {
      entityId: 'ent_nope',
    });
    expect(noEntity.statusCode).toBe(404);
  });
});

describe('spoiler-safe codex (F612/F615/F616/F618/F620)', () => {
  it('lists only met entities, with zero fields before any reveal', async () => {
    const res = await codex('pt1');
    expect(res.statusCode).toBe(200);
    const entries = res.json().data.entries;
    expect(entries).toHaveLength(1); // Vesper met, The Low Den not
    expect(entries[0]).toMatchObject({ entityId: foxId, name: 'Vesper', type: 'character' });
    expect(entries[0].revealedFields).toEqual({});
    // spoiler safety: unrevealed values must never appear anywhere in the payload
    expect(res.body).not.toContain('spy-master');
  });

  it('reveals unlock field visibility, in reveal order (F616)', async () => {
    const reveal = await post(`/stories/${storyId}/playthroughs/pt1/reveals`, {
      entityId: foxId,
      field: 'role',
    });
    expect(reveal.statusCode).toBe(201);
    expect(reveal.json().data).toMatchObject({ field: 'role', revealed: true });

    const repeat = await post(`/stories/${storyId}/playthroughs/pt1/reveals`, {
      entityId: foxId,
      field: 'role',
    });
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().data.revealed).toBe(false);

    const res = await codex('pt1');
    expect(res.json().data.entries[0].revealedFields).toEqual({ role: 'spy-master' });
    expect(res.body).not.toContain('"health"'); // still hidden
  });

  it('rejects reveals of fields the schema does not define', async () => {
    const res = await post(`/stories/${storyId}/playthroughs/pt1/reveals`, {
      entityId: foxId,
      field: 'secrets',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain('"secrets"');
  });

  it('keeps playthroughs isolated', async () => {
    const fresh = await codex('pt2');
    expect(fresh.json().data.entries).toHaveLength(0);

    await post(`/stories/${storyId}/playthroughs/pt2/encounters`, { entityId: denId });
    const after = await codex('pt2');
    expect(after.json().data.entries.map((e: { entityId: string }) => e.entityId)).toEqual([denId]);
    // pt1 reveals do not leak into pt2
    expect(after.body).not.toContain('spy-master');
  });

  it('reveal without encounter stays hidden until the entity is met', async () => {
    await post(`/stories/${storyId}/playthroughs/pt3/reveals`, {
      entityId: foxId,
      field: 'health',
    });
    const hidden = await codex('pt3');
    expect(hidden.json().data.entries).toHaveLength(0);

    await post(`/stories/${storyId}/playthroughs/pt3/encounters`, { entityId: foxId });
    const met = await codex('pt3');
    expect(met.json().data.entries[0].revealedFields).toEqual({ health: 7 });
  });

  it('is regenerated from encounters + reveals with stable ids (F619)', async () => {
    const a = await codex('pt1');
    const b = await codex('pt1');
    expect(a.json().data).toEqual(b.json().data);
    const entryIds = a.json().data.entries.map((e: { entryId: string }) => e.entryId);
    expect(new Set(entryIds).size).toBe(entryIds.length);
  });
});
