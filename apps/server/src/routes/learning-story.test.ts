/**
 * Story-driven learning route tests (Epic 18, F1732/F1733/F1735).
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { compile } from '@fables/forge-dsl';
import { storiesRepo } from '../db/repos/stories.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
});

afterAll(async () => {
  await app.close();
});

async function createCard(prompt: string, answer: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/cards',
    payload: { prompt, answer },
  });
  return (res.json() as { data: { id: string } }).data.id;
}

describe('POST /review/story (F1732)', () => {
  it('generates a compilable review fable from due cards', async () => {
    await createCard('What is the capital of France?', 'Paris');
    await createCard('Tricky [brackets] and -> arrows', '=== not a knot ===');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/review/story',
      payload: { newLimit: 10, title: 'Hall of Memories' },
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { source: string; knotToCard: Record<string, string> } })
      .data;
    // The generated source must compile cleanly (no error diagnostics).
    const result = compile(data.source);
    expect(result.ok).toBe(true);
    expect(Object.keys(data.knotToCard).length).toBeGreaterThan(0);
  });
});

describe('POST /review/mastery (F1733)', () => {
  it('reports per-card retrievability and a gate verdict', async () => {
    const id = await createCard('q', 'a');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/review/mastery',
      payload: { cardIds: [id], threshold: 0.9 },
    });
    expect(res.statusCode).toBe(200);
    const data = (
      res.json() as { data: { mastered: boolean; retention: { retrievability: number }[] } }
    ).data;
    // A brand-new card is not mastered.
    expect(data.mastered).toBe(false);
    expect(data.retention[0]!.retrievability).toBe(0);
  });
});

describe('POST /stories/:id/cards/sync (F1735)', () => {
  it('creates cards from a story source', async () => {
    const stories = storiesRepo(app.db);
    const story = stories.create({ title: 'Lesson' });
    stories.createFile(story.id, 'main.fable', '=== intro ===\nQ: What is 2+2?\nA: 4\n-> END\n');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${story.id}/cards/sync`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { created: number } }).data.created).toBeGreaterThanOrEqual(1);
  });
});
