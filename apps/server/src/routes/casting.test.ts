/**
 * Casting route tests (Epic 17, F1611–F1620).
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { entitiesRepo } from '../db/repos/entities.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
});

afterAll(async () => {
  await app.close();
});

describe('POST /casting/analyze (F1612/F1613)', () => {
  it('splits prose into narration + attributed dialogue', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/casting/analyze',
      payload: { text: 'The hall was dark. "Who goes there?" asked Mira.' },
    });
    expect(res.statusCode).toBe(200);
    const data = (
      res.json() as {
        data: { lines: { kind: string; speaker: string | null }[]; speakers: string[] };
      }
    ).data;
    expect(data.lines.some((l) => l.kind === 'dialogue')).toBe(true);
    expect(data.lines.some((l) => l.kind === 'narration')).toBe(true);
  });
});

describe('POST /casting/resolve (F1618)', () => {
  it('resolves lines to voices with narrator fallback', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/casting/resolve',
      payload: {
        text: 'It began. "Hello," said Mira.',
        cast: {
          narrator: { voiceId: 'narrator' },
          bySpeaker: { mira: { voiceId: 'mira-voice' } },
          defaultCharacter: null,
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const data = (
      res.json() as {
        data: { lines: { voice: { voiceId: string } | null }[]; coverage: { total: number } };
      }
    ).data;
    expect(data.coverage.total).toBeGreaterThan(0);
    expect(data.lines.every((l) => l.voice !== null)).toBe(true);
  });
});

describe('Story cast sheets (F1616/F1619)', () => {
  it('saves then reads a story cast sheet', async () => {
    const sheet = {
      narrator: { voiceId: 'narrator' },
      bySpeaker: { alice: { voiceId: 'amy' } },
      defaultCharacter: null,
    };
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/stories/story42/cast',
      payload: { name: 'Cast A', sheet },
    });
    expect(put.statusCode).toBe(200);

    const get = await app.inject({ method: 'GET', url: '/api/v1/stories/story42/cast' });
    const manifest = (get.json() as { data: { storyId: string; sheet: typeof sheet } }).data;
    expect(manifest.storyId).toBe('story42');
    expect(manifest.sheet.bySpeaker.alice?.voiceId).toBe('amy');
  });
});

describe('Cast templates (F1617)', () => {
  it('creates and lists templates', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/casting/templates',
      payload: {
        name: 'Noir',
        sheet: { narrator: { voiceId: 'gravel' }, bySpeaker: {}, defaultCharacter: null },
      },
    });
    const list = await app.inject({ method: 'GET', url: '/api/v1/casting/templates' });
    const templates = (list.json() as { data: { templates: { name: string }[] } }).data.templates;
    expect(templates.some((t) => t.name === 'Noir')).toBe(true);
  });
});

describe('Entity voice assignment (F1611/F1615)', () => {
  it('assigns and clears an entity voice', async () => {
    const ent = entitiesRepo(app.db).create({
      type: 'character',
      name: 'Glint',
      aliases: [],
      fields: {},
    });
    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/entities/${ent.id}/voice`,
      payload: { voiceId: 'sparkle', rate: 1.1 },
    });
    expect(put.statusCode).toBe(200);
    expect((put.json() as { data: { voiceId: string } }).data.voiceId).toBe('sparkle');

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/entities/${ent.id}/voice` });
    expect(del.statusCode).toBe(200);
  });

  it('404s for an unknown entity', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/entities/ent_nope/voice',
      payload: { voiceId: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });
});
