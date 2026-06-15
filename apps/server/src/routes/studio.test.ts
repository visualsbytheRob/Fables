/**
 * Recording studio route tests (Epic 17, F1651–F1660).
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { storiesRepo } from '../db/repos/stories.js';
import type { StoryId } from '@fables/core';

let app: FastifyInstance;
let storyId: StoryId;

const b64 = (s: string) => Buffer.from(s).toString('base64');

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  storyId = storiesRepo(app.db).create({ title: 'Studio Tale' }).id;
});

afterAll(async () => {
  await app.close();
});

describe('takes lifecycle (F1651/F1653)', () => {
  it('uploads, lists, re-picks, fetches, and deletes takes', async () => {
    const up1 = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${storyId}/takes`,
      payload: { lineKey: 'intro:0', format: 'opus', audio: b64('first-take') },
    });
    expect(up1.statusCode).toBe(200);
    expect((up1.json() as { data: { active: boolean } }).data.active).toBe(true);

    const up2 = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${storyId}/takes`,
      payload: { lineKey: 'intro:0', format: 'opus', audio: b64('second-take') },
    });
    const take2 = (up2.json() as { data: { id: string } }).data;

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/stories/${storyId}/takes/intro:0`,
    });
    expect((list.json() as { data: { takes: unknown[] } }).data.takes).toHaveLength(2);

    const pick = await app.inject({
      method: 'PUT',
      url: `/api/v1/stories/${storyId}/takes/intro:0/active`,
      payload: { takeId: take2.id },
    });
    expect(pick.statusCode).toBe(200);

    const audio = await app.inject({ method: 'GET', url: `/api/v1/takes/${take2.id}/audio` });
    expect(
      Buffer.from((audio.json() as { data: { audio: string } }).data.audio, 'base64').toString(),
    ).toBe('second-take');

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/takes/${take2.id}` });
    expect(del.statusCode).toBe(200);
  });

  it('404s uploading to an unknown story', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/stories/story_nope/takes',
      payload: { lineKey: 'a:0', format: 'opus', audio: b64('x') },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('recording plan (F1656/F1657)', () => {
  it('classifies lines as human/tts/uncast with a checklist', async () => {
    // Record one of the three lines.
    await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${storyId}/takes`,
      payload: { lineKey: 'p:0', format: 'opus', audio: b64('human-line') },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${storyId}/recording-plan`,
      payload: {
        lines: [
          { lineKey: 'p:0', text: 'recorded', cast: true },
          { lineKey: 'p:1', text: 'tts', cast: true },
          { lineKey: 'p:2', text: 'silent', cast: false },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const data = (
      res.json() as {
        data: {
          plan: { recorded: number; ttsFallback: number; uncast: number; total: number };
          checklist: string[];
        };
      }
    ).data;
    expect(data.plan.total).toBe(3);
    expect(data.plan.recorded).toBe(1);
    expect(data.plan.ttsFallback).toBe(1);
    expect(data.plan.uncast).toBe(1);
    expect(data.checklist).toEqual(['p:1', 'p:2']);
  });
});
