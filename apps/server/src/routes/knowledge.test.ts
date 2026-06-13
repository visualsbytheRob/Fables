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

/** Create a story, set its entry-file source, build it; returns ids. */
async function makeStory(title: string, source: string): Promise<string> {
  const storyId = (await post('/stories', { title })).json().data.id;
  const files = (await get(`/stories/${storyId}/files`)).json().data;
  const entry = files.find((f: { path: string }) => f.path === 'main.fable');
  await app.inject({
    method: 'PATCH',
    url: `/api/v1/stories/${storyId}/files/${entry.id}`,
    payload: { source },
  });
  return storyId;
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
});
afterAll(async () => {
  await app.close();
});

describe('knowledge-state binding payload (F641–F645/F649)', () => {
  it('serves entity fields, note-exists flags and a version hash', async () => {
    const heroId = (
      await post('/entities', { type: 'character', name: 'Aria', fields: { health: 80 } })
    ).json().data.id;
    expect(heroId).toBeDefined();
    await post('/notes', { notebookId: await defaultNotebook(), title: 'The Prophecy', body: 'x' });

    const storyId = await makeStory(
      'Quest',
      `# title: Quest\n{ @Aria.health > 50: Hello }\n[[The Prophecy]]\n-> END\n`,
    );
    const res = await get(`/stories/${storyId}/knowledge-state?playthroughId=pt1`);
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.mode).toBe('live');
    expect(body.entities.aria.fields.health).toBe(80);
    expect(body.notes['the prophecy']).toBe(true);
    expect(body.version).toMatch(/^[0-9a-f]{24}$/);
  });

  it('flags missing entities/notes with typed defaults + warnings (F649)', async () => {
    const storyId = await makeStory(
      'Gaps',
      `# title: Gaps\n{ @Ghost.health > 0: boo }\n[[No Such Note]]\n-> END\n`,
    );
    const body = (await get(`/stories/${storyId}/knowledge-state?playthroughId=pt1`)).json().data;
    expect(body.entities.ghost.missing).toBe(true);
    expect(body.notes['no such note']).toBe(false);
    const kinds = body.warnings.map((w: { kind: string }) => w.kind);
    expect(kinds).toContain('missing-entity');
    expect(kinds).toContain('missing-note');
  });

  it('changes the version hash when an entity field changes (F645)', async () => {
    const id = (
      await post('/entities', { type: 'character', name: 'Bram', fields: { health: 10 } })
    ).json().data.id;
    const storyId = await makeStory('Bram', `# title: Bram\n{ @Bram.health > 1: ok }\n-> END\n`);
    const v1 = (await get(`/stories/${storyId}/knowledge-state?playthroughId=pt1`)).json().data
      .version;
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/entities/${id}`,
      payload: { fields: { health: 99 } },
    });
    const v2 = (await get(`/stories/${storyId}/knowledge-state?playthroughId=pt1`)).json().data
      .version;
    expect(v2).not.toBe(v1);
  });
});

describe('snapshot binding mode (F644)', () => {
  it('freezes the payload at playthrough start', async () => {
    const id = (
      await post('/entities', { type: 'character', name: 'Cara', fields: { health: 30 } })
    ).json().data.id;
    const storyId = await makeStory('Cara', `# title: Cara\n{ @Cara.health > 1: ok }\n-> END\n`);
    await post(`/stories/${storyId}/playthroughs`, { id: 'snap', mode: 'snapshot' });

    // Mutate the live entity after the snapshot was frozen.
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/entities/${id}`,
      payload: { fields: { health: 1 } },
    });

    const frozen = (await get(`/stories/${storyId}/knowledge-state?playthroughId=snap`)).json().data;
    expect(frozen.mode).toBe('snapshot');
    expect(frozen.entities.cara.fields.health).toBe(30); // frozen, not 1

    const live = (await get(`/stories/${storyId}/knowledge-state?playthroughId=other`)).json().data;
    expect(live.entities.cara.fields.health).toBe(1);
  });
});

async function defaultNotebook(): Promise<string> {
  const list = (await get('/notebooks')).json().data;
  if (list.length > 0) return list[0].id;
  return (await post('/notebooks', { name: 'Test' })).json().data.id;
}
