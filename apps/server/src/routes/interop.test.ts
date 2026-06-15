/**
 * Story interop import route tests (Epic 19, F1821/F1828/F1831/F1839).
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

describe('POST /import/ink (F1821/F1828)', () => {
  it('converts Ink to compilable Forge and creates a story', async () => {
    const source =
      '=== start ===\nYou wake.\n* [Go north] -> north\n\n=== north ===\nCold.\n-> END\n';
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/import/ink',
      payload: { source, title: 'From Ink' },
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { forge: string; storyId: string } }).data;
    expect(compile(data.forge).ok).toBe(true);
    expect(data.storyId).not.toBeNull();
    expect(storiesRepo(app.db).get(data.storyId as never)).not.toBeNull();
  });
});

describe('POST /import/twine (F1831/F1839)', () => {
  it('converts Twee to compilable Forge with a report', async () => {
    const source =
      ':: Start\nYou stand at a crossroads.\n[[Go left->Left]]\n\n:: Left\n<<set $x to 1>>\nA dead end.\n';
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/import/twine',
      payload: { source },
    });
    expect(res.statusCode).toBe(200);
    const data = (
      res.json() as { data: { forge: string; unsupported: unknown[]; passages: string[] } }
    ).data;
    expect(compile(data.forge).ok).toBe(true);
    expect(data.passages.length).toBeGreaterThan(0);
    // The <<set>> macro is reported as unsupported.
    expect(data.unsupported.length).toBeGreaterThanOrEqual(1);
  });
});
