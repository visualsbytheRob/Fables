/**
 * Power-tools route tests (Epic 20, F1981–F1985).
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import { syncNoteLinks } from '../services/links.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  const nb = notebooksRepo(app.db).create({ name: 'Vault' });
  const notes = notesRepo(app.db);
  notes.create({ notebookId: nb.id, title: 'Alpha', body: 'the quick brown fox jumps' });
  notes.create({ notebookId: nb.id, title: 'Alpha copy', body: 'the quick brown fox jumps' });
  notes.create({ notebookId: nb.id, title: '', body: '' });
  const linker = notes.create({ notebookId: nb.id, title: 'Links here', body: 'see [[Nowhere]]' });
  // Record the outgoing wikilink so the broken-link finder sees the dangling edge.
  syncNoteLinks(app.db, linker);
});

afterAll(async () => {
  await app.close();
});

describe('GET /power/stats (F1981)', () => {
  it('reports totals and tag/notebook breakdowns', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/power/stats' });
    const data = (res.json() as { data: { totalNotes: number; totalWords: number } }).data;
    expect(data.totalNotes).toBe(4);
    expect(data.totalWords).toBeGreaterThan(0);
  });
});

describe('GET /power/duplicates (F1982)', () => {
  it('finds the exact-duplicate pair', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/power/duplicates' });
    const groups = (res.json() as { data: { groups: { noteIds: string[] }[] } }).data.groups;
    expect(groups.some((g) => g.noteIds.length >= 2)).toBe(true);
  });
});

describe('GET /power/broken (F1983)', () => {
  it('flags the broken link and the empty note', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/power/broken' });
    const data = (res.json() as { data: { brokenLinks: unknown[]; emptyNotes: unknown[] } }).data;
    expect(data.brokenLinks.length).toBeGreaterThanOrEqual(1);
    expect(data.emptyNotes.length).toBeGreaterThanOrEqual(1);
  });
});

describe('POST /power/lint (F1984)', () => {
  it('returns findings with rule ids and severities', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/power/lint', payload: {} });
    const findings = (res.json() as { data: { findings: { ruleId: string; severity: string }[] } })
      .data.findings;
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => typeof f.ruleId === 'string')).toBe(true);
  });
});

describe('GET /power/storage (F1985)', () => {
  it('reports total bytes and a breakdown', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/power/storage' });
    const data = (res.json() as { data: { totalBytes: number } }).data;
    expect(data.totalBytes).toBeGreaterThan(0);
  });
});
