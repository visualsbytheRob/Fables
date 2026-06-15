/**
 * Story archive route tests (Epic 19, F1881/F1886).
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { storiesRepo } from '../db/repos/stories.js';
import type { StoryId } from '@fables/core';

let app: FastifyInstance;
let storyA: StoryId;
let storyB: StoryId;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  const stories = storiesRepo(app.db);
  storyA = stories.create({ title: 'Archive A' }).id;
  stories.createFile(storyA, 'main.fable', '=== a ===\nA.\n-> END\n');
  storyB = stories.create({ title: 'Archive B' }).id;
  stories.createFile(storyB, 'main.fable', '=== b ===\nB.\n-> END\n');
});

afterAll(async () => {
  await app.close();
});

describe('archive build + verify (F1881/F1886)', () => {
  it('builds an archive of two stories and verifies it', async () => {
    const build = await app.inject({
      method: 'POST',
      url: '/api/v1/archive/build',
      payload: { storyIds: [storyA, storyB] },
    });
    expect(build.statusCode).toBe(200);
    const data = (build.json() as { data: { archive: string; packs: number } }).data;
    expect(data.packs).toBe(2);

    const verify = await app.inject({
      method: 'POST',
      url: '/api/v1/archive/verify',
      payload: { archive: data.archive },
    });
    const result = (verify.json() as { data: { valid: boolean; packs: string[] } }).data;
    expect(result.valid).toBe(true);
    expect(result.packs).toHaveLength(2);
  });

  it('rejects a corrupt archive on verify', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/archive/verify',
      payload: { archive: Buffer.from('garbage').toString('base64') },
    });
    expect((res.json() as { data: { valid: boolean } }).data.valid).toBe(false);
  });
});
