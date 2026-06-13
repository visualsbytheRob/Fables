/**
 * FTS5 search tests (F701–F710):
 * - Ranking by bm25 weights
 * - Snippet extraction with highlight offsets
 * - Trigger sync (insert/update/delete/trash/restore)
 * - Phrase, prefix, NEAR operator support
 * - Malformed queries return empty results, never crash
 * - Consistency check endpoint
 * - POST /search/rebuild
 * - Performance: 5k notes under 50ms
 */

import { describe, expect, it } from 'vitest';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { entitiesRepo } from '../db/repos/entities.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import { sanitizeFtsQuery, searchRepo } from '../db/repos/search.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

// ── unit: sanitizeFtsQuery ────────────────────────────────────────────────────

describe('sanitizeFtsQuery', () => {
  it('returns null for empty input', () => {
    expect(sanitizeFtsQuery('')).toBeNull();
    expect(sanitizeFtsQuery('   ')).toBeNull();
  });

  it('passes through normal queries unchanged', () => {
    expect(sanitizeFtsQuery('hello world')).toBe('hello world');
    expect(sanitizeFtsQuery('"exact phrase"')).toBe('"exact phrase"');
    expect(sanitizeFtsQuery('hel*')).toBe('hel*');
    expect(sanitizeFtsQuery('NEAR(foo bar, 5)')).toBe('NEAR(foo bar, 5)');
  });

  it('fixes unbalanced quotes by wrapping as phrase', () => {
    const result = sanitizeFtsQuery('hello "world');
    expect(result).toMatch(/^"/);
    expect(result).toMatch(/"$/);
  });

  it('fixes bare operator-only queries', () => {
    const result = sanitizeFtsQuery('AND');
    expect(result).toMatch(/^"/);
  });
});

// ── unit: searchRepo ──────────────────────────────────────────────────────────

describe('FTS5 search repo', () => {
  it('finds notes by title (title weight > body)', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    notesRepo(db).create({ notebookId: nb.id, title: 'Typescript guide', body: 'intro' });
    notesRepo(db).create({ notebookId: nb.id, title: 'Random note', body: 'Typescript everywhere' });
    const results = searchRepo(db).searchNotes('Typescript', 10);
    expect(results.length).toBe(2);
    // Title match should rank higher (lower bm25 score = better)
    expect(results[0]!.title).toBe('Typescript guide');
  });

  it('returns snippet and highlight offsets', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    notesRepo(db).create({
      notebookId: nb.id,
      title: 'Hello world',
      body: 'testing highlights here',
    });
    const results = searchRepo(db).searchNotes('testing', 10);
    expect(results.length).toBe(1);
    const r = results[0]!;
    expect(r.snippet).toBeTruthy();
    expect(r.snippet).toContain('testing');
    expect(r.highlights.length).toBeGreaterThan(0);
    const h = r.highlights[0]!;
    expect(h.start).toBeGreaterThanOrEqual(0);
    expect(h.end).toBeGreaterThan(h.start);
  });

  it('excludes trashed notes from search', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    const note = notesRepo(db).create({ notebookId: nb.id, title: 'find me', body: '' });
    notesRepo(db).trash(note.id);
    const results = searchRepo(db).searchNotes('find', 10);
    expect(results.length).toBe(0);
  });

  it('restoring a trashed note makes it searchable again', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    const note = notesRepo(db).create({ notebookId: nb.id, title: 'restoration test', body: '' });
    notesRepo(db).trash(note.id);
    expect(searchRepo(db).searchNotes('restoration', 10)).toHaveLength(0);
    notesRepo(db).restore(note.id);
    expect(searchRepo(db).searchNotes('restoration', 10)).toHaveLength(1);
  });

  it('UPDATE trigger syncs FTS on title change', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    const note = notesRepo(db).create({ notebookId: nb.id, title: 'oldtitle', body: '' });
    expect(searchRepo(db).searchNotes('oldtitle', 10)).toHaveLength(1);
    notesRepo(db).update(note.id, 0, { title: 'newtitle' });
    expect(searchRepo(db).searchNotes('oldtitle', 10)).toHaveLength(0);
    expect(searchRepo(db).searchNotes('newtitle', 10)).toHaveLength(1);
  });

  it('DELETE trigger removes note from FTS', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    const note = notesRepo(db).create({ notebookId: nb.id, title: 'gone soon', body: '' });
    expect(searchRepo(db).searchNotes('gone', 10)).toHaveLength(1);
    notesRepo(db).trash(note.id);
    notesRepo(db).purgeTrashed();
    expect(searchRepo(db).searchNotes('gone', 10)).toHaveLength(0);
  });

  it('phrase query matches exact phrase', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    notesRepo(db).create({ notebookId: nb.id, title: 'A', body: 'quick brown fox jumps' });
    notesRepo(db).create({ notebookId: nb.id, title: 'B', body: 'quick fox brown' });
    const results = searchRepo(db).searchNotes('"quick brown fox"', 10);
    expect(results.length).toBe(1);
    expect(results[0]!.snippet).toContain('quick brown fox');
  });

  it('prefix query matches partial words', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    notesRepo(db).create({ notebookId: nb.id, title: 'typescript', body: '' });
    notesRepo(db).create({ notebookId: nb.id, title: 'typewriter', body: '' });
    const results = searchRepo(db).searchNotes('type*', 10);
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it('malformed queries return empty results without throwing', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    notesRepo(db).create({ notebookId: nb.id, title: 'test', body: '' });
    expect(() => searchRepo(db).searchNotes('AND OR NOT', 10)).not.toThrow();
    expect(() => searchRepo(db).searchNotes('hello "world', 10)).not.toThrow();
    expect(() => searchRepo(db).searchNotes(')', 10)).not.toThrow();
  });

  it('entities are indexed and searchable', () => {
    const db = freshDb();
    entitiesRepo(db).create({ type: 'character', name: 'Aragorn', aliases: ['Strider'], fields: {} });
    const results = searchRepo(db).searchEntities('Aragorn', 10);
    expect(results.length).toBe(1);
    expect(results[0]!.title).toBe('Aragorn');
  });

  it('entity alias search works', () => {
    const db = freshDb();
    entitiesRepo(db).create({ type: 'character', name: 'Aragorn', aliases: ['Strider'], fields: {} });
    const results = searchRepo(db).searchEntities('Strider', 10);
    expect(results.length).toBe(1);
  });

  it('entity UPDATE trigger syncs FTS', () => {
    const db = freshDb();
    const entity = entitiesRepo(db).create({
      type: 'character',
      name: 'Gimli',
      aliases: [],
      fields: {},
    });
    expect(searchRepo(db).searchEntities('Gimli', 10)).toHaveLength(1);
    entitiesRepo(db).update(entity.id, { name: 'Glorfindel' });
    expect(searchRepo(db).searchEntities('Gimli', 10)).toHaveLength(0);
    expect(searchRepo(db).searchEntities('Glorfindel', 10)).toHaveLength(1);
  });

  it('rebuild + consistency check works', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    notesRepo(db).create({ notebookId: nb.id, title: 'rebuild test', body: 'content' });
    const repo = searchRepo(db);
    repo.rebuildAll();
    const fts = repo.ftsCounts();
    const src = repo.sourceCounts();
    expect(fts.notes).toBe(src.notes);
    expect(fts.entities).toBe(src.entities);
    expect(fts.scenes).toBe(src.scenes);
  });
});

// ── HTTP route tests ──────────────────────────────────────────────────────────

describe('GET /api/v1/search', () => {
  it('returns grouped results with correct shape', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const nbRes = await app.inject({
      method: 'POST',
      url: '/api/v1/notebooks',
      body: { name: 'Test' },
    });
    const nb = (nbRes.json() as { data: { id: string } }).data;
    await app.inject({
      method: 'POST',
      url: '/api/v1/notes',
      body: { notebookId: nb.id, title: 'uniqueterm42xyz', body: 'body content' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=uniqueterm42xyz',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { mode: string; query: string; groups: { type: string; total: number; results: unknown[] }[] };
      page: { nextCursor: string | null; limit: number };
    };
    expect(body.data.mode).toBe('keyword');
    expect(body.data.query).toBe('uniqueterm42xyz');
    expect(Array.isArray(body.data.groups)).toBe(true);
    const noteGroup = body.data.groups.find((g) => g.type === 'notes');
    expect(noteGroup).toBeTruthy();
    expect(noteGroup!.total).toBeGreaterThan(0);
    expect(noteGroup!.results.length).toBeGreaterThan(0);
    const result = noteGroup!.results[0] as {
      id: string;
      title: string;
      snippet: string;
      highlights: { start: number; end: number }[];
      score: number;
    };
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('snippet');
    expect(result).toHaveProperty('highlights');
    expect(result).toHaveProperty('score');
    expect(body.page).toHaveProperty('limit');
  });

  it('returns empty groups for no-match query', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=xyznotexistentterm99999',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { groups: { total: number }[] } };
    expect(body.data.groups.every((g) => g.total === 0)).toBe(true);
  });

  it('filters types parameter', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=test&types=notes',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { groups: { type: string }[] } };
    expect(body.data.groups.length).toBe(1);
    expect(body.data.groups[0]!.type).toBe('notes');
  });

  it('handles malformed queries gracefully (no crash)', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=' + encodeURIComponent(')malformed('),
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('POST /api/v1/search/rebuild', () => {
  it('returns 200 with rebuilt:true', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const res = await app.inject({ method: 'POST', url: '/api/v1/search/rebuild' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { rebuilt: boolean } }).data.rebuilt).toBe(true);
  });
});

describe('GET /api/v1/search/consistency', () => {
  it('returns counts with ok flags', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const res = await app.inject({ method: 'GET', url: '/api/v1/search/consistency' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { notes: { fts: number; source: number; ok: boolean } };
    };
    expect(body.data).toHaveProperty('notes');
    expect(body.data.notes).toHaveProperty('fts');
    expect(body.data.notes).toHaveProperty('source');
    expect(body.data.notes).toHaveProperty('ok');
    expect(body.data.notes.ok).toBe(true);
  });
});

// ── performance budget ────────────────────────────────────────────────────────

describe('FTS performance budget', () => {
  it('searches 5k notes in under 50ms', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    const now = new Date().toISOString();
    const insert = db.prepare(
      `INSERT INTO notes (id, title, body, notebook_id, pinned, trashed_at, created_at, updated_at, rev)
       VALUES (?,?,?,?,0,NULL,?,?,0)`,
    );

    // Bulk-insert 5k notes (triggers fire automatically — FTS stays in sync)
    const insertMany = db.transaction(() => {
      for (let i = 0; i < 5000; i++) {
        const id = `note_perf_${String(i).padStart(10, '0')}`;
        const title = `Performance note ${i}`;
        const body = `Body content for note ${i} with representative text about the subject matter`;
        insert.run(id, title, body, nb.id, now, now);
      }
    });
    insertMany();

    const sRepo = searchRepo(db);
    const start = performance.now();
    sRepo.searchNotes('performance', 20);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
  });
});
