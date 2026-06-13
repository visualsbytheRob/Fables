/**
 * Insights API tests (F791–F800).
 * Tests each endpoint on seeded fixtures.
 */

import { describe, expect, it } from 'vitest';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import { insightsRepo } from '../db/repos/insights.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

// ── unit: insightsRepo ─────────────────────────────────────────────────────────

describe('insightsRepo.overview', () => {
  it('returns zero counts on empty vault', () => {
    const db = freshDb();
    const result = insightsRepo(db).overview();
    expect(result.notes).toBe(0);
    expect(result.notebooks).toBe(0);
    expect(result.entities).toBe(0);
    expect(result.stories).toBe(0);
    expect(result.links).toBe(0);
    expect(result.orphans).toBe(0);
    expect(result.wordsTotal).toBe(0);
  });

  it('counts notes, notebooks, and words correctly', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    notesRepo(db).create({ notebookId: nb.id, title: 'Hello World', body: 'one two three' });
    notesRepo(db).create({ notebookId: nb.id, title: 'Second', body: 'four five' });
    const result = insightsRepo(db).overview();
    expect(result.notes).toBe(2);
    expect(result.notebooks).toBe(1);
    expect(result.wordsTotal).toBeGreaterThan(0);
  });

  it('excludes trashed notes from counts', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    const n = notesRepo(db).create({ notebookId: nb.id, title: 'Trashed' });
    notesRepo(db).trash(n.id);
    const result = insightsRepo(db).overview();
    expect(result.notes).toBe(0);
    expect(result.orphans).toBe(0);
  });

  it('counts orphans correctly', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    notesRepo(db).create({ notebookId: nb.id, title: 'Orphan' });
    const result = insightsRepo(db).overview();
    expect(result.orphans).toBe(1);
  });
});

describe('insightsRepo.growth', () => {
  it('returns growth data for date range', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    notesRepo(db).create({ notebookId: nb.id, title: 'Test', body: 'words here' });
    const today = new Date().toISOString().slice(0, 10);
    const result = insightsRepo(db).growth(today, today);
    expect(Array.isArray(result)).toBe(true);
    expect(result.some((r) => r.day === today && r.notes > 0)).toBe(true);
  });

  it('returns empty array for future date range', () => {
    const db = freshDb();
    const result = insightsRepo(db).growth('2099-01-01', '2099-01-31');
    expect(result).toHaveLength(0);
  });
});

describe('insightsRepo.streaks', () => {
  it('returns streak structure with heatmap of 365 items', () => {
    const db = freshDb();
    const result = insightsRepo(db).streaks();
    expect(result).toHaveProperty('current');
    expect(result).toHaveProperty('longest');
    expect(result).toHaveProperty('heatmap');
    expect(result.heatmap).toHaveLength(365);
  });

  it('counts current streak for today-created note', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    notesRepo(db).create({ notebookId: nb.id, title: 'Daily' });
    const result = insightsRepo(db).streaks();
    expect(result.current).toBeGreaterThanOrEqual(1);
    expect(result.heatmap[0]).toBeGreaterThanOrEqual(1);
  });
});

describe('insightsRepo.stale', () => {
  it('returns empty when no high-degree notes', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    notesRepo(db).create({ notebookId: nb.id, title: 'No links' });
    const result = insightsRepo(db).stale(10);
    expect(result).toHaveLength(0);
  });

  it('respects limit', () => {
    const db = freshDb();
    const result = insightsRepo(db).stale(5);
    expect(result.length).toBeLessThanOrEqual(5);
  });
});

describe('insightsRepo.suggestedLinks', () => {
  it('returns empty array when no mentions exist', () => {
    const db = freshDb();
    const result = insightsRepo(db).suggestedLinks(10);
    expect(result).toHaveLength(0);
  });
});

describe('insightsRepo.reading', () => {
  it('returns zero stats on empty db', () => {
    const db = freshDb();
    const result = insightsRepo(db).reading();
    expect(result.plays).toBe(0);
    expect(result.turns).toBe(0);
    expect(result.completions).toBe(0);
    expect(result.topScenes).toHaveLength(0);
  });
});

describe('insightsRepo.deadEnds', () => {
  it('returns orphan notes', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    notesRepo(db).create({ notebookId: nb.id, title: 'Alone note' });
    const result = insightsRepo(db).deadEnds();
    expect(result.orphanNotes.length).toBeGreaterThan(0);
    expect(result.brokenLinks).toHaveLength(0);
  });

  it('returns empty when no notes', () => {
    const db = freshDb();
    const result = insightsRepo(db).deadEnds();
    expect(result.orphanNotes).toHaveLength(0);
    expect(result.brokenLinks).toHaveLength(0);
  });
});

describe('insightsRepo.health', () => {
  it('returns score between 0 and 100 with a checklist', () => {
    const db = freshDb();
    const result = insightsRepo(db).health();
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.checklist.length).toBeGreaterThan(0);
    expect(result.checklist.every((c) => 'key' in c && 'label' in c && 'ok' in c)).toBe(true);
  });

  it('scores higher when vault has notes', () => {
    const db = freshDb();
    const emptyScore = insightsRepo(db).health().score;

    const nb = notebooksRepo(db).create({ name: 'Test' });
    for (let i = 0; i < 10; i++) {
      notesRepo(db).create({ notebookId: nb.id, title: `Note ${i}`, body: 'content '.repeat(60) });
    }
    const populatedScore = insightsRepo(db).health().score;
    expect(populatedScore).toBeGreaterThan(emptyScore);
  });
});

// ── HTTP response types ────────────────────────────────────────────────────────

interface OverviewData {
  notes: number;
  notebooks: number;
  entities: number;
  stories: number;
  links: number;
  orphans: number;
  wordsTotal: number;
}

interface GrowthPoint {
  day: string;
  notes: number;
  links: number;
  words: number;
}

interface StreakData {
  current: number;
  longest: number;
  heatmap: number[];
}

interface ReadingData {
  plays: number;
  turns: number;
  completions: number;
  topScenes: { scene: string; count: number }[];
}

interface DeadEndsData {
  orphanNotes: { id: string; title: string }[];
  brokenLinks: { id: string; sourceId: string; targetTitle: string }[];
}

interface HealthData {
  score: number;
  checklist: { key: string; label: string; ok: boolean }[];
}

interface NoteData {
  id: string;
  title: string;
  body: string;
}

// ── HTTP route tests ──────────────────────────────────────────────────────────

describe('GET /api/v1/insights/overview', () => {
  it('returns overview with expected shape', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const res = await app.inject({ method: 'GET', url: '/api/v1/insights/overview' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: OverviewData };
    expect(body.data).toHaveProperty('notes');
    expect(body.data).toHaveProperty('notebooks');
    expect(body.data).toHaveProperty('entities');
    expect(body.data).toHaveProperty('stories');
    expect(body.data).toHaveProperty('links');
    expect(body.data).toHaveProperty('orphans');
    expect(body.data).toHaveProperty('wordsTotal');
  });
});

describe('GET /api/v1/insights/growth', () => {
  it('returns array of growth points', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/insights/growth?from=2024-01-01&to=2024-01-07',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: GrowthPoint[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('accepts no params and uses last 30 days', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const res = await app.inject({ method: 'GET', url: '/api/v1/insights/growth' });
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /api/v1/insights/streaks', () => {
  it('returns streaks with heatmap', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const res = await app.inject({ method: 'GET', url: '/api/v1/insights/streaks' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: StreakData };
    expect(body.data).toHaveProperty('current');
    expect(body.data).toHaveProperty('longest');
    expect(body.data.heatmap).toHaveLength(365);
  });
});

describe('GET /api/v1/insights/stale', () => {
  it('returns array of stale notes', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const res = await app.inject({ method: 'GET', url: '/api/v1/insights/stale?limit=10' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe('GET /api/v1/insights/suggested-links', () => {
  it('returns array of suggested link pairs', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/insights/suggested-links?limit=10',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe('GET /api/v1/insights/reading', () => {
  it('returns reading stats shape', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const res = await app.inject({ method: 'GET', url: '/api/v1/insights/reading' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: ReadingData };
    expect(body.data).toHaveProperty('plays');
    expect(body.data).toHaveProperty('turns');
    expect(body.data).toHaveProperty('completions');
    expect(body.data).toHaveProperty('topScenes');
  });
});

describe('GET /api/v1/insights/dead-ends', () => {
  it('returns dead end structure', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const res = await app.inject({ method: 'GET', url: '/api/v1/insights/dead-ends' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: DeadEndsData };
    expect(body.data).toHaveProperty('orphanNotes');
    expect(body.data).toHaveProperty('brokenLinks');
  });
});

describe('GET /api/v1/insights/health', () => {
  it('returns health score and checklist', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const res = await app.inject({ method: 'GET', url: '/api/v1/insights/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: HealthData };
    expect(body.data).toHaveProperty('score');
    expect(body.data).toHaveProperty('checklist');
    expect(typeof body.data.score).toBe('number');
  });
});

describe('POST /api/v1/insights/digest', () => {
  it('creates a digest note and returns 201', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const nbRes = await app.inject({
      method: 'POST',
      url: '/api/v1/notebooks',
      body: { name: 'Journal' },
    });
    const nb = (nbRes.json() as { data: { id: string } }).data;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/insights/digest',
      body: { notebookId: nb.id },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: NoteData };
    expect(body.data).toHaveProperty('id');
    expect(body.data.title).toMatch(/Weekly Digest/);
    expect(body.data.body).toContain('# Weekly Digest');
    expect(body.data.body).toContain('## Stats');
  });

  it('returns 422 when no notebook exists and none specified', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const res = await app.inject({ method: 'POST', url: '/api/v1/insights/digest', body: {} });
    expect(res.statusCode).toBe(422);
  });
});
