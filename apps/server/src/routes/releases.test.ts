/**
 * Story release route tests (Epic 19, F1841–F1845).
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { storiesRepo } from '../db/repos/stories.js';
import type { StoryId } from '@fables/core';

let app: FastifyInstance;
let storyId: StoryId;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  const stories = storiesRepo(app.db);
  storyId = stories.create({ title: 'Versioned' }).id;
  stories.createFile(storyId, 'main.fable', '=== intro ===\nv1.\n-> END\n');
});

afterAll(async () => {
  await app.close();
});

async function release(name: string): Promise<string> {
  // Uses the existing create-release endpoint (routes/stories.ts), which
  // recompiles and returns 201.
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/stories/${storyId}/releases`,
    payload: { name },
  });
  if (res.statusCode !== 201) throw new Error(`release failed: ${res.statusCode} ${res.body}`);
  return (res.json() as { data: { id: string } }).data.id;
}

describe('releases: create, diff, changelog, rollback (F1841–F1845)', () => {
  it('snapshots, diffs, and rolls back', async () => {
    const stories = storiesRepo(app.db);
    const relA = await release('v1');

    // Edit the story, then release v2.
    stories.setFileSources(
      storyId,
      new Map([['main.fable', '=== intro ===\nv2.\n-> ending\n\n=== ending ===\nDone.\n-> END\n']]),
    );
    const relB = await release('v2');

    const diff = await app.inject({
      method: 'GET',
      url: `/api/v1/stories/${storyId}/releases/${relA}/diff/${relB}`,
    });
    expect((diff.json() as { data: { addedKnots: string[] } }).data.addedKnots).toContain('ending');

    const changelog = await app.inject({
      method: 'GET',
      url: `/api/v1/stories/${storyId}/releases/${relA}/changelog/${relB}`,
    });
    expect((changelog.json() as { data: { changelog: string } }).data.changelog).toContain(
      'ending',
    );

    const compat = await app.inject({
      method: 'GET',
      url: `/api/v1/stories/${storyId}/releases/${relA}/compat/${relB}`,
    });
    expect((compat.json() as { data: { compatible: boolean } }).data.compatible).toBe(true);

    // Roll back to v1.
    const rollback = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${storyId}/releases/${relA}/rollback`,
    });
    expect(rollback.statusCode).toBe(200);
    expect(stories.listFiles(storyId).find((f) => f.path === 'main.fable')!.source).toContain(
      'v1.',
    );
  });

  it('404s for an unknown release', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${storyId}/releases/rel_nope/rollback`,
    });
    expect(res.statusCode).toBe(404);
  });
});
