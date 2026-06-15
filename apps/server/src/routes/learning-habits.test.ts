/**
 * Habit + notification route tests (Epic 18, F1773/F1775/F1776/F1777).
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { notebooksRepo } from '../db/repos/notebooks.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  notebooksRepo(app.db).create({ name: 'Journal' });
  // A due card so reminders fire.
  await app.inject({ method: 'POST', url: '/api/v1/cards', payload: { prompt: 'q', answer: 'a' } });
});

afterAll(async () => {
  await app.close();
});

describe('GET /learning/habits/best-time (F1773)', () => {
  it('returns a best-hour suggestion (possibly null)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/learning/habits/best-time' });
    expect(res.statusCode).toBe(200);
    expect('best' in (res.json() as { data: object }).data).toBe(true);
  });
});

describe('GET /learning/habits/reminder (F1776/F1777)', () => {
  it('suppresses reminders during quiet hours', async () => {
    // now = 23:00 UTC, inside the default 22→7 quiet window.
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/learning/habits/reminder?now=2026-06-15T23:00:00.000Z',
    });
    expect((res.json() as { data: { reason?: string } }).data.reason).toBe('quiet');
  });

  it('returns a reminder during active hours when cards are due', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/learning/habits/reminder?now=2026-06-15T12:00:00.000Z',
    });
    const data = (res.json() as { data: { reminder: { text: string } | null } }).data;
    expect(data.reminder).not.toBeNull();
    expect(data.reminder!.text.length).toBeGreaterThan(0);
  });
});

describe('POST /learning/habits/digest (F1775)', () => {
  it('generates and saves a weekly digest note', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/learning/habits/digest',
      payload: { now: '2026-06-15T12:00:00.000Z', save: true },
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { markdown: string; savedNoteId: string | null } }).data;
    expect(data.markdown).toContain('Weekly learning digest');
    expect(data.savedNoteId).not.toBeNull();
  });
});
