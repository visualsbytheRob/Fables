/**
 * Generative art route tests (Epic 19, F1863/F1864/F1868).
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { storiesRepo } from '../db/repos/stories.js';
import { entitiesRepo } from '../db/repos/entities.js';
import type { StoryId } from '@fables/core';

let app: FastifyInstance;
let storyId: StoryId;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  storyId = storiesRepo(app.db).create({
    title: 'The Silent Vale',
    description: 'A quiet doom.',
  }).id;
});

afterAll(async () => {
  await app.close();
});

describe('GET /art/status + /art/styles (F1861/F1866)', () => {
  it('reports no backend and lists style presets', async () => {
    const status = await app.inject({ method: 'GET', url: '/api/v1/art/status' });
    expect((status.json() as { data: { available: boolean } }).data.available).toBe(false);
    const styles = await app.inject({ method: 'GET', url: '/api/v1/art/styles' });
    expect(Object.keys((styles.json() as { data: { presets: object } }).data.presets)).toContain(
      'noir',
    );
  });
});

describe('POST /stories/:id/cover (F1863 fallback)', () => {
  it('produces a typographic SVG cover when no backend is available', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${storyId}/cover`,
      payload: { theme: 'gothic', style: 'noir' },
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { fallback: boolean; format: string; hash: string } }).data;
    expect(data.fallback).toBe(true);
    expect(data.format).toBe('svg');

    // The asset is retrievable and is an SVG.
    const asset = await app.inject({ method: 'GET', url: `/api/v1/art/assets/${data.hash}` });
    const svg = Buffer.from(
      (asset.json() as { data: { base64: string } }).data.base64,
      'base64',
    ).toString('utf8');
    expect(svg).toContain('<svg');
    expect(svg).toContain('The Silent Vale');
  });
});

describe('POST /entities/:id/portrait (F1864)', () => {
  it('returns the prompt when no backend is available', async () => {
    const ent = entitiesRepo(app.db).create({
      type: 'character',
      name: 'Old Maren',
      aliases: [],
      fields: { role: 'keeper' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/entities/${ent.id}/portrait`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { available: boolean; prompt: string } }).data;
    expect(data.available).toBe(false);
    expect(data.prompt).toContain('Old Maren');
  });

  it('404s for an unknown entity', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/entities/ent_nope/portrait',
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});
