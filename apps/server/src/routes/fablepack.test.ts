/**
 * .fablepack route tests (Epic 19, F1801/F1808).
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
  const story = stories.create({ title: 'Packable', description: 'desc' });
  storyId = story.id;
  stories.createFile(storyId, 'main.fable', '=== intro ===\nHi.\n-> END\n');
});

afterAll(async () => {
  await app.close();
});

describe('pack → validate → unpack (F1801/F1808)', () => {
  it('packs a story, validates it, and reads it back', async () => {
    const packed = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${storyId}/pack`,
      payload: { release: 'v1', capabilities: ['audio'], signingKey: 'k' },
    });
    expect(packed.statusCode).toBe(200);
    const pack = (packed.json() as { data: { pack: string } }).data.pack;

    const valid = await app.inject({
      method: 'POST',
      url: '/api/v1/packs/validate',
      payload: { pack, signingKey: 'k' },
    });
    const result = (valid.json() as { data: { valid: boolean; signatureValid: boolean } }).data;
    expect(result.valid).toBe(true);
    expect(result.signatureValid).toBe(true);

    const unpacked = await app.inject({
      method: 'POST',
      url: '/api/v1/packs/unpack',
      payload: { pack },
    });
    const manifest = (unpacked.json() as { data: { manifest: { story: { title: string } } } }).data
      .manifest;
    expect(manifest.story.title).toBe('Packable');
  });

  it('rejects an unreadable pack on unpack', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packs/unpack',
      payload: { pack: Buffer.from('garbage').toString('base64') },
    });
    expect(res.statusCode).toBe(422);
  });
});
