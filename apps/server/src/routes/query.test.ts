import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

/**
 * FQL end-to-end (F271–F280): seeded fixture vault, queries through the HTTP
 * surface, pagination, warnings, export, and injection attempts.
 */

let app: FastifyInstance;
let dataDir: string;
let inboxId: string;
let workId: string;

interface NoteJson {
  id: string;
  title: string;
  rev: number;
  pinned: boolean;
}

async function createNotebook(name: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/notebooks', payload: { name } });
  expect(res.statusCode).toBe(201);
  return res.json().data.id;
}

async function createNote(notebookId: string, title: string, body = ''): Promise<NoteJson> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/notes',
    payload: { notebookId, title, body },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data;
}

async function query(
  q: string,
  extra = '',
): Promise<{
  status: number;
  titles: string[];
  warnings: string[];
  page?: { nextCursor: string | null; limit: number };
  error?: { code: string; message: string; details: Record<string, unknown> | null };
}> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/query?q=${encodeURIComponent(q)}${extra}`,
  });
  const json = res.json();
  return {
    status: res.statusCode,
    titles: (json.data ?? []).map((n: { title: string }) => n.title),
    warnings: json.warnings ?? [],
    page: json.page,
    error: json.error,
  };
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fables-query-'));
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal', DATA_DIR: dataDir }));
  inboxId = await createNotebook('Inbox');
  workId = await createNotebook('Work');

  await createNote(inboxId, 'Harbor Town', 'A quiet port. #travel');
  await createNote(inboxId, 'Travel Log', 'Left [[Harbor Town]] at dawn. #travel/sea');
  const pinnedNote = await createNote(workId, 'Quarterly Plan', 'Roadmap draft. #work');
  await createNote(workId, 'Meeting Notes', 'Discussed the harbor expansion with the team.');
  await createNote(inboxId, 'Recipes', 'Fish stew, 100% delicious.');

  await app.inject({
    method: 'PATCH',
    url: `/api/v1/notes/${pinnedNote.id}`,
    payload: { rev: pinnedNote.rev, pinned: true },
  });

  // Backdate one note so relative date filters have something to split on.
  app.db
    .prepare(`UPDATE notes SET created_at = ?, updated_at = ? WHERE title = 'Recipes'`)
    .run('2020-01-05T00:00:00.000Z', '2020-01-06T00:00:00.000Z');
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('GET /api/v1/query (F271, F273–F277)', () => {
  it('matches bare terms against title and body', async () => {
    const { titles } = await query('harbor');
    expect(titles.sort()).toEqual(['Harbor Town', 'Meeting Notes', 'Travel Log']);
  });

  it('matches quoted phrases literally', async () => {
    expect((await query('"harbor expansion"')).titles).toEqual(['Meeting Notes']);
    expect((await query('"100%"')).titles).toEqual(['Recipes']); // wildcard escaped
  });

  it('filters by tag including nested children', async () => {
    const { titles } = await query('tag:travel');
    expect(titles.sort()).toEqual(['Harbor Town', 'Travel Log']);
    expect((await query('tag:travel/sea')).titles).toEqual(['Travel Log']);
  });

  it('filters by notebook name or id', async () => {
    expect((await query('notebook:Work sort:title')).titles).toEqual([
      'Meeting Notes',
      'Quarterly Plan',
    ]);
    expect((await query(`notebook:${inboxId} sort:title`)).titles).toEqual([
      'Harbor Town',
      'Recipes',
      'Travel Log',
    ]);
  });

  it('supports title:, body:, pinned:, linksto:, and boolean combinations', async () => {
    expect((await query('title:harbor')).titles).toEqual(['Harbor Town']);
    expect((await query('body:dawn')).titles).toEqual(['Travel Log']);
    expect((await query('pinned:true')).titles).toEqual(['Quarterly Plan']);
    expect((await query('linksto:[[Harbor Town]]')).titles).toEqual(['Travel Log']);
    expect((await query('harbor NOT tag:travel')).titles).toEqual(['Meeting Notes']);
    expect(
      (await query('(title:harbor OR title:recipes) NOT pinned:true sort:title')).titles,
    ).toEqual(['Harbor Town', 'Recipes']);
  });

  it('filters by calendar month and relative windows (F276)', async () => {
    expect((await query('created:2020-01')).titles).toEqual(['Recipes']);
    expect((await query('created:2020-01-05')).titles).toEqual(['Recipes']);
    expect((await query('created:<30d')).titles).toEqual(['Recipes']);
    const recent = await query('updated:>7d sort:title');
    expect(recent.titles).toEqual(['Harbor Town', 'Meeting Notes', 'Quarterly Plan', 'Travel Log']);
  });

  it('finds notes with attachments via has:attachment', async () => {
    const note = await createNote(inboxId, 'With File', 'see attachment');
    const boundary = 'fables-query-boundary';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="noteId"\r\n\r\n${note.id}\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="doc.pdf"\r\n` +
          `Content-Type: application/pdf\r\n\r\npdfish\r\n--${boundary}--\r\n`,
      ),
    ]);
    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/attachments',
      payload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(upload.statusCode).toBe(201);
    expect((await query('has:attachment')).titles).toEqual(['With File']);
  });

  it('sorts and paginates with the standard envelope (F277)', async () => {
    const first = await query('notebook:Inbox sort:title', '&limit=2');
    expect(first.titles).toEqual(['Harbor Town', 'Recipes']);
    expect(first.page?.nextCursor).not.toBeNull();
    const second = await query(
      'notebook:Inbox sort:title',
      `&limit=2&cursor=${first.page!.nextCursor}`,
    );
    expect(second.titles).toEqual(['Travel Log', 'With File']);
    expect(second.page?.nextCursor).toBeNull();
  });

  it('returns warnings for a degraded trailing clause (F279)', async () => {
    const result = await query('harbor OR');
    expect(result.status).toBe(200);
    expect(result.titles).toContain('Harbor Town');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('ignored unparseable clause');
  });

  it('rejects fully broken queries with a positioned VALIDATION error (F272)', async () => {
    const result = await query('pinned:maybe');
    expect(result.status).toBe(422);
    expect(result.error?.code).toBe('VALIDATION');
    expect(result.error?.details?.position).toBe(0);
  });

  it('neutralizes SQL injection attempts (F280)', async () => {
    const attempts = [
      `"'; DROP TABLE notes; --"`,
      `tag:x'); DELETE FROM notes; --`,
      `notebook:Inbox" OR "1"="1`,
      `title:%' OR title LIKE '%`,
    ];
    for (const q of attempts) {
      const result = await query(q);
      expect(result.status).toBe(200);
      expect(result.titles).toEqual([]); // matched nothing, executed nothing hostile
    }
    expect((await query('')).titles.length).toBeGreaterThanOrEqual(6); // table intact
  });
});

describe('POST /api/v1/query/validate (F283 server half)', () => {
  it('reports valid queries with warnings', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/query/validate',
      payload: { q: 'tag:travel sort:title' },
    });
    expect(ok.json().data).toEqual({ valid: true, warnings: [] });

    const degraded = await app.inject({
      method: 'POST',
      url: '/api/v1/query/validate',
      payload: { q: 'fox OR' },
    });
    expect(degraded.json().data.valid).toBe(true);
    expect(degraded.json().data.warnings).toHaveLength(1);
  });

  it('reports invalid queries with message and position', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/query/validate',
      payload: { q: 'created:nope' },
    });
    expect(res.statusCode).toBe(200);
    const { valid, error } = res.json().data;
    expect(valid).toBe(false);
    expect(error.message).toContain('invalid date filter');
    expect(error.position).toBe(0);
  });
});

describe('GET /api/v1/query/export (F288)', () => {
  it('renders a markdown table of title, notebook, updated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/query/export?q=${encodeURIComponent('tag:travel sort:title')}&format=markdown`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    const lines = res.body.trimEnd().split('\n');
    expect(lines[0]).toBe('| Title | Notebook | Updated |');
    expect(lines[1]).toBe('| --- | --- | --- |');
    expect(lines[2]).toMatch(/^\| Harbor Town \| Inbox \| \d{4}-\d{2}-\d{2} \|$/);
    expect(lines).toHaveLength(4);
  });
});
