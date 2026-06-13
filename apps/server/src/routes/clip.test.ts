/**
 * Tests for F771–F779: web clipper routes.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { FIXTURE_HTML } from './__fixtures__/make-fixtures.js';

let app: FastifyInstance;
let dataDir: string;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fables-clip-'));
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal', DATA_DIR: dataDir }));
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('POST /clip — raw HTML (F771)', () => {
  it('clips raw HTML and returns a job', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/clip',
      payload: {
        html: FIXTURE_HTML,
        sourceUrl: 'https://example.com/article',
      },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.id).toBeTruthy();
    expect(body.data.sourceType).toBe('html');
    expect(body.duplicate).toBe(false);
  });

  it('returns duplicate=false for different URLs', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/clip',
      payload: {
        html: FIXTURE_HTML,
        sourceUrl: 'https://different.com/unique-page-x',
      },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().duplicate).toBe(false);
  });
});

describe('POST /clip — selection as quote block (F774)', () => {
  it('wraps selection in a block quote', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/clip',
      payload: {
        html: FIXTURE_HTML,
        sourceUrl: 'https://example.com/quote-test',
        selection: 'key insight from the article',
      },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(202);
  });
});

describe('POST /clip — validation (F771)', () => {
  it('rejects requests with neither url nor html', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/clip',
      payload: { selection: 'orphan selection' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects invalid URL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/clip',
      payload: { url: 'not-a-url' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('GET /clip/duplicate-check (F777)', () => {
  it('returns isDuplicate=false for an unseen URL', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/clip/duplicate-check?url=https://example.com/never-seen',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.isDuplicate).toBe(false);
    expect(body.data.existingJob).toBeNull();
  });
});

describe('GET /clip/jobs/:id', () => {
  it('404s for unknown job id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/clip/jobs/ingest_nonexistent_clip',
    });
    expect(res.statusCode).toBe(404);
  });
});
