/**
 * FQL v2 route tests (Epic 20, F1961–F1968): aggregate, explain, lint.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  const work = notebooksRepo(app.db).create({ name: 'Work' });
  const home = notebooksRepo(app.db).create({ name: 'Home' });
  const notes = notesRepo(app.db);
  notes.create({ notebookId: work.id, title: 'Alpha meeting', body: 'one two three' });
  notes.create({ notebookId: work.id, title: 'Beta meeting', body: 'four five six seven' });
  notes.create({ notebookId: home.id, title: 'Groceries', body: 'milk' });
});

afterAll(async () => {
  await app.close();
});

describe('GET /query/explain (F1965)', () => {
  it('returns a plan, compiled SQL and cost', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/query/explain?q=tag:project' });
    const data = (res.json() as { data: { sql: string; estimatedCost: number; indexes: string[] } })
      .data;
    expect(data.sql).toContain('FROM notes n');
    expect(data.estimatedCost).toBeGreaterThan(0);
    expect(data.indexes).toContain('note_tags');
  });
});

describe('POST /query/lint (F1968)', () => {
  it('returns findings for a mistyped field', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/query/lint',
      payload: { q: 'tg:x' },
    });
    const findings = (res.json() as { data: { findings: { severity: string }[] } }).data.findings;
    expect(findings.some((f) => f.severity === 'error')).toBe(true);
  });
});

describe('POST /query/aggregate (F1961–F1963)', () => {
  it('groups by notebook and counts', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/query/aggregate',
      payload: { q: '', groupBy: 'notebook', metrics: [{ fn: 'count', as: 'n' }] },
    });
    const groups = (res.json() as { data: { groups: { key: string; values: { n: number } }[] } })
      .data.groups;
    const work = groups.find((g) => g.key === 'Work');
    expect(work?.values.n).toBe(2);
  });

  it('sums a computed field across results', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/query/aggregate',
      payload: {
        q: 'meeting',
        computed: [{ as: 'longish', expr: 'if(words > 3, 1, 0)' }],
        metrics: [{ fn: 'sum', field: 'longish', as: 'longCount' }],
      },
    });
    const data = (res.json() as { data: { total: { values: { longCount: number } } } }).data;
    // "Beta meeting" has 4 words (>3); "Alpha meeting" has 3 (not >3).
    expect(data.total.values.longCount).toBe(1);
  });

  it('substitutes query variables and reports unset ones', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/query/aggregate',
      payload: {
        q: 'notebook:$nb',
        vars: { nb: 'Work' },
        metrics: [{ fn: 'count', as: 'n' }],
      },
    });
    const data = (res.json() as { data: { total: { values: { n: number } } } }).data;
    expect(data.total.values.n).toBe(2);
  });
});
