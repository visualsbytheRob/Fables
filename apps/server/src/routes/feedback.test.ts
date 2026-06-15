/**
 * Reader feedback route tests (Epic 19, F1851–F1856).
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
  storyId = storiesRepo(app.db).create({ title: 'Feedback Tale' }).id;
});

afterAll(async () => {
  await app.close();
});

async function logEvent(sessionId: string, type: string, knot: string, extra: object = {}) {
  await app.inject({
    method: 'POST',
    url: `/api/v1/stories/${storyId}/play-events`,
    payload: { sessionId, type, knot, ...extra },
  });
}

describe('reader feedback (F1851/F1853)', () => {
  it('adds and lists feedback', async () => {
    const add = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${storyId}/feedback`,
      payload: { knot: 'intro', text: 'Loved this opening!', kind: 'reaction' },
    });
    expect(add.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: `/api/v1/stories/${storyId}/feedback` });
    expect(
      (list.json() as { data: { feedback: unknown[] } }).data.feedback.length,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe('play analytics (F1854/F1855/F1856)', () => {
  it('aggregates choices, drop-off, and endings', async () => {
    // Session 1: intro → choice 0 → good_end (ending).
    await logEvent('s1', 'visit', 'intro', { seq: 0 });
    await logEvent('s1', 'choice', 'intro', { choiceIndex: 0, label: 'Be brave', seq: 1 });
    await logEvent('s1', 'visit', 'good_end', { seq: 2 });
    await logEvent('s1', 'ending', 'good_end', { label: 'Hero', seq: 3 });
    // Session 2: intro → choice 1, then drops off at 'cave' with no ending.
    await logEvent('s2', 'visit', 'intro', { seq: 0 });
    await logEvent('s2', 'choice', 'intro', { choiceIndex: 1, label: 'Be cautious', seq: 1 });
    await logEvent('s2', 'visit', 'cave', { seq: 2 });

    const stats = await app.inject({
      method: 'GET',
      url: `/api/v1/stories/${storyId}/feedback/choice-stats`,
    });
    expect(
      (stats.json() as { data: { stats: unknown[] } }).data.stats.length,
    ).toBeGreaterThanOrEqual(2);

    const drop = await app.inject({
      method: 'GET',
      url: `/api/v1/stories/${storyId}/feedback/drop-off`,
    });
    const dropOff = (drop.json() as { data: { dropOff: { knot: string }[] } }).data.dropOff;
    expect(dropOff.some((d) => d.knot === 'cave')).toBe(true);

    const endings = await app.inject({
      method: 'GET',
      url: `/api/v1/stories/${storyId}/feedback/endings`,
    });
    const dist = (endings.json() as { data: { endings: { ending: string }[] } }).data.endings;
    expect(dist.some((e) => e.ending === 'Hero')).toBe(true);
  });
});

describe('feedback bundle export/import (F1852/F1853)', () => {
  it('round-trips a feedback bundle into another story', async () => {
    const exp = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${storyId}/feedback/export`,
      payload: { anonymize: true },
    });
    const bundle = (exp.json() as { data: { feedback: unknown[] } }).data;

    const other = storiesRepo(app.db).create({ title: 'Author Inbox' }).id;
    const imp = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${other}/feedback/import`,
      payload: { feedback: bundle.feedback },
    });
    expect((imp.json() as { data: { imported: number } }).data.imported).toBeGreaterThanOrEqual(1);
  });
});
