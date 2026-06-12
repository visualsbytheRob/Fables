import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

/**
 * Import/export (F291–F299): dry-run scans, async import jobs with per-file
 * errors, collision strategies, vault export, and the export→import
 * round-trip fidelity check (F296).
 */

let tmpRoot: string;

function freshDir(name: string): string {
  const dir = fs.mkdtempSync(path.join(tmpRoot, `${name}-`));
  return dir;
}

async function freshApp(): Promise<{ app: FastifyInstance; dataDir: string }> {
  const dataDir = freshDir('data');
  const app = await buildApp(
    loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal', DATA_DIR: dataDir }),
  );
  return { app, dataDir };
}

function writeVault(files: Record<string, string | Buffer>): string {
  const root = freshDir('vault');
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

async function runImport(
  app: FastifyInstance,
  payload: Record<string, unknown>,
): Promise<{
  status: string;
  processed: number;
  imported: number;
  merged: number;
  renamed: number;
  skipped: number;
  attachments: number;
  errors: { file: string; message: string }[];
}> {
  const started = await app.inject({ method: 'POST', url: '/api/v1/import/run', payload });
  expect(started.statusCode).toBe(202);
  const jobId = started.json().data.id;
  expect(jobId).toMatch(/^job_/);
  for (let i = 0; i < 200; i += 1) {
    const res = await app.inject({ method: 'GET', url: `/api/v1/import/jobs/${jobId}` });
    expect(res.statusCode).toBe(200);
    const job = res.json().data;
    if (job.status !== 'running') return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('import job never finished');
}

async function allNotes(
  app: FastifyInstance,
): Promise<
  {
    id: string;
    title: string;
    body: string;
    notebookId: string;
    pinned: boolean;
    createdAt: string;
  }[]
> {
  const res = await app.inject({ method: 'GET', url: '/api/v1/query?limit=200' });
  expect(res.statusCode).toBe(200);
  return res.json().data;
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fables-impex-'));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('POST /api/v1/import/scan (F294)', () => {
  it('reports files, titles, attachment refs, and title collisions without writing', async () => {
    const { app } = await freshApp();
    const nb = await app.inject({
      method: 'POST',
      url: '/api/v1/notebooks',
      payload: { name: 'X' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/notes',
      payload: { notebookId: nb.json().data.id, title: 'Existing Note' },
    });

    const root = writeVault({
      'Existing Note.md': 'collides with the live note',
      'Fresh.md': '---\ntitle: Fresh Catch\n---\nwith ![pic](img/fish.png)',
      'sub/Deep.md': 'nested note',
      'img/fish.png': Buffer.from('png-bytes'),
      '.obsidian/config.md': 'never scanned',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/import/scan',
      payload: { path: root },
    });
    expect(res.statusCode).toBe(200);
    const report = res.json().data;
    expect(report.totals).toEqual({ files: 3, attachments: 1, collisions: 1 });
    expect(report.files).toEqual([
      { path: 'Existing Note.md', title: 'Existing Note', attachments: 0, collision: true },
      { path: 'Fresh.md', title: 'Fresh Catch', attachments: 1, collision: false },
      { path: 'sub/Deep.md', title: 'Deep', attachments: 0, collision: false },
    ]);
    expect((await allNotes(app)).length).toBe(1); // dry run wrote nothing
    await app.close();
  });

  it('validates the path: absolute, existing, a directory', async () => {
    const { app } = await freshApp();
    for (const bad of ['relative/dir', '/definitely/not/real-xyz', '']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/import/scan',
        payload: { path: bad },
      });
      expect(res.statusCode).toBe(422);
    }
    const file = path.join(freshDir('notdir'), 'plain.txt');
    fs.writeFileSync(file, 'not a directory');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/import/scan',
      payload: { path: file },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain('not a directory');
    await app.close();
  });
});

describe('POST /api/v1/import/run (F291–F293, F297, F298)', () => {
  it('imports folders as nested notebooks, frontmatter, wikilinks, and attachments', async () => {
    const { app } = await freshApp();
    const root = writeVault({
      'Harbor Town.md': [
        '---',
        'tags: [travel, sea]',
        'created: 2020-02-03T04:05:06.000Z',
        'pinned: true',
        '---',
        'A quiet port with a ![map](assets/map.png)',
      ].join('\n'),
      'journal/Travel Log.md': 'Left [[Harbor Town]] at dawn. Embedded ![[map.png]] too.',
      'assets/map.png': Buffer.from('fake-map-bytes'),
    });

    const job = await runImport(app, { path: root, collisions: 'rename' });
    expect(job.status).toBe('done');
    expect(job).toMatchObject({ processed: 2, imported: 2, attachments: 2, errors: [] });

    const notes = await allNotes(app);
    const harbor = notes.find((n) => n.title === 'Harbor Town')!;
    const log = notes.find((n) => n.title === 'Travel Log')!;

    // Frontmatter: tags, preserved created, pinned (F293).
    expect(harbor.pinned).toBe(true);
    expect(harbor.createdAt).toBe('2020-02-03T04:05:06.000Z');
    const harborFull = await app.inject({ method: 'GET', url: `/api/v1/notes/${harbor.id}` });
    expect(
      harborFull
        .json()
        .data.tags.map((t: { name: string }) => t.name)
        .sort(),
    ).toEqual(['sea', 'travel']);

    // Subfolder → nested notebook under the import root notebook (F291).
    const notebooks = await app.inject({ method: 'GET', url: '/api/v1/notebooks' });
    const byName = new Map(
      notebooks
        .json()
        .data.map((n: { name: string; id: string; parentId: string | null }) => [n.name, n]),
    );
    const rootNb = byName.get(path.basename(root)) as { id: string };
    const journalNb = byName.get('journal') as { id: string; parentId: string };
    expect(rootNb).toBeDefined();
    expect(journalNb.parentId).toBe(rootNb.id);
    expect(log.notebookId).toBe(journalNb.id);

    // Wikilink across the imported set resolved via the links service (F291).
    const backlinks = await app.inject({
      method: 'GET',
      url: `/api/v1/notes/${harbor.id}/backlinks`,
    });
    expect(backlinks.json().data.sources.map((s: { note: { id: string } }) => s.note.id)).toEqual([
      log.id,
    ]);

    // Attachments copied into content-addressed storage, links rewritten (F292).
    expect(harbor.body).toMatch(/!\[map\]\(\/api\/v1\/attachments\/att_[0-9A-HJKMNP-TV-Z]{26}\)/);
    expect(log.body).toMatch(/!\[map\.png\]\(\/api\/v1\/attachments\/att_[0-9A-HJKMNP-TV-Z]{26}\)/);
    const attachmentId = /att_[0-9A-HJKMNP-TV-Z]{26}/.exec(harbor.body)![0];
    const file = await app.inject({ method: 'GET', url: `/api/v1/attachments/${attachmentId}` });
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.toString()).toBe('fake-map-bytes');
    await app.close();
  });

  it('applies skip / rename / merge collision strategies (F298)', async () => {
    const { app } = await freshApp();
    const nb = await app.inject({
      method: 'POST',
      url: '/api/v1/notebooks',
      payload: { name: 'Main' },
    });
    const notebookId = nb.json().data.id;
    await app.inject({
      method: 'POST',
      url: '/api/v1/notes',
      payload: { notebookId, title: 'Duplicate', body: 'original body' },
    });

    const skipRoot = writeVault({ 'Duplicate.md': 'imported body (skip)' });
    const skipJob = await runImport(app, { path: skipRoot, notebookId, collisions: 'skip' });
    expect(skipJob).toMatchObject({ skipped: 1, imported: 0 });

    const renameRoot = writeVault({ 'Duplicate.md': 'imported body (rename)' });
    const renameJob = await runImport(app, { path: renameRoot, notebookId, collisions: 'rename' });
    expect(renameJob).toMatchObject({ renamed: 1, imported: 1 });
    const titles = (await allNotes(app)).map((n) => n.title);
    expect(titles).toContain('Duplicate (imported)');

    const mergeRoot = writeVault({ 'Duplicate.md': 'merged body wins' });
    const mergeJob = await runImport(app, { path: mergeRoot, notebookId, collisions: 'merge' });
    expect(mergeJob).toMatchObject({ merged: 1, imported: 0 });
    const merged = (await allNotes(app)).find((n) => n.title === 'Duplicate')!;
    expect(merged.body).toBe('merged body wins');
    await app.close();
  });

  it('records per-file errors without aborting the run (F297)', async () => {
    const { app } = await freshApp();
    const huge = `x`.repeat(1024 * 1024 + 1); // trips the 1 MB note-body guard
    const root = writeVault({ 'Too Big.md': huge, 'Fine.md': 'small enough' });
    const job = await runImport(app, { path: root, collisions: 'rename' });
    expect(job.status).toBe('done');
    expect(job.processed).toBe(2);
    expect(job.imported).toBe(1);
    expect(job.errors).toEqual([{ file: 'Too Big.md', message: expect.stringContaining('1 MB') }]);
    expect((await allNotes(app)).map((n) => n.title)).toEqual(['Fine.md'.replace('.md', '')]);
    await app.close();
  });

  it('refuses attachment references that escape the vault root', async () => {
    const { app } = await freshApp();
    const outside = freshDir('outside');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'do not import');
    const root = writeVault({ 'Sneaky.md': `steal ![x](../${path.basename(outside)}/secret.txt)` });
    const job = await runImport(app, { path: root, collisions: 'rename' });
    expect(job).toMatchObject({ status: 'done', imported: 1, attachments: 0 });
    const note = (await allNotes(app)).find((n) => n.title === 'Sneaky')!;
    expect(note.body).toContain('secret.txt'); // link untouched, file not copied
    expect(note.body).not.toContain('/api/v1/attachments/');
    await app.close();
  });
});

describe('GET /api/v1/export/vault (F295) and round-trip (F296)', () => {
  it('exports notebooks as folders with frontmatter and survives reimport intact', async () => {
    const { app: source } = await freshApp();
    const nbRes = await source.inject({
      method: 'POST',
      url: '/api/v1/notebooks',
      payload: { name: 'Inbox' },
    });
    const inbox = nbRes.json().data.id;
    const subRes = await source.inject({
      method: 'POST',
      url: '/api/v1/notebooks',
      payload: { name: 'Journal', parentId: inbox },
    });
    const journal = subRes.json().data.id;

    const harbor = await source.inject({
      method: 'POST',
      url: '/api/v1/notes',
      payload: { notebookId: inbox, title: 'Harbor Town', body: 'A quiet port. #travel' },
    });
    const harborId = harbor.json().data.id;
    await source.inject({
      method: 'PATCH',
      url: `/api/v1/notes/${harborId}`,
      payload: { rev: harbor.json().data.rev, pinned: true },
    });

    // Attach a file and reference it from a second note.
    const boundary = 'fables-export-boundary';
    const upload = await source.inject({
      method: 'POST',
      url: '/api/v1/attachments',
      payload: Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="noteId"\r\n\r\n${harborId}\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="map.png"\r\n` +
          `Content-Type: image/png\r\n\r\nmap-pixel-data\r\n--${boundary}--\r\n`,
      ),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    const uploaded = upload.json().data;
    await source.inject({
      method: 'POST',
      url: '/api/v1/notes',
      payload: {
        notebookId: journal,
        title: 'Travel Log',
        body: `Left [[Harbor Town]] at dawn.\n\n![map](/api/v1/attachments/${uploaded.id})`,
      },
    });

    // Export (F295).
    const dest = freshDir('export');
    const exported = await source.inject({
      method: 'GET',
      url: `/api/v1/export/vault?path=${encodeURIComponent(dest)}`,
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.json().data).toEqual({ notes: 2, attachments: 1, path: dest });

    expect(fs.existsSync(path.join(dest, 'Inbox', 'Harbor Town.md'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'Inbox', 'Journal', 'Travel Log.md'))).toBe(true);
    expect(fs.readFileSync(path.join(dest, 'attachments', 'map.png')).toString()).toBe(
      'map-pixel-data',
    );
    const harborMd = fs.readFileSync(path.join(dest, 'Inbox', 'Harbor Town.md'), 'utf8');
    expect(harborMd).toContain('title: Harbor Town');
    expect(harborMd).toContain('- travel');
    expect(harborMd).toContain('pinned: true');
    const logMd = fs.readFileSync(path.join(dest, 'Inbox', 'Journal', 'Travel Log.md'), 'utf8');
    expect(logMd).toContain('[[Harbor Town]]'); // wikilinks preserved by title
    expect(logMd).toContain('![map](../../attachments/map.png)');

    // Reimport into a fresh vault (F296).
    const { app: target } = await freshApp();
    const job = await runImport(target, { path: dest, collisions: 'rename' });
    expect(job).toMatchObject({ status: 'done', imported: 2, attachments: 1, errors: [] });

    const notes = await allNotes(target);
    const harbor2 = notes.find((n) => n.title === 'Harbor Town')!;
    const log2 = notes.find((n) => n.title === 'Travel Log')!;

    // Body, pinned flag, and timestamps survive.
    expect(harbor2.body).toBe('A quiet port. #travel');
    expect(harbor2.pinned).toBe(true);
    expect(harbor2.createdAt).toBe(harbor.json().data.createdAt);

    // Tags survive (body hashtag + frontmatter agree).
    const harbor2Full = await target.inject({ method: 'GET', url: `/api/v1/notes/${harbor2.id}` });
    expect(harbor2Full.json().data.tags.map((t: { name: string }) => t.name)).toEqual(['travel']);

    // Notebook nesting survives (under the import wrapper notebook).
    const nbs = await target.inject({ method: 'GET', url: '/api/v1/notebooks' });
    const byName = new Map(
      nbs
        .json()
        .data.map((n: { name: string; id: string; parentId: string | null }) => [n.name, n]),
    );
    const inbox2 = byName.get('Inbox') as { id: string; parentId: string };
    const journal2 = byName.get('Journal') as { id: string; parentId: string };
    expect(journal2.parentId).toBe(inbox2.id);
    expect(harbor2.notebookId).toBe(inbox2.id);
    expect(log2.notebookId).toBe(journal2.id);

    // Links survive: Travel Log still backlinks Harbor Town.
    const backlinks = await target.inject({
      method: 'GET',
      url: `/api/v1/notes/${harbor2.id}/backlinks`,
    });
    expect(backlinks.json().data.sources.map((s: { note: { id: string } }) => s.note.id)).toEqual([
      log2.id,
    ]);

    // Attachment hash survives the round trip (content-addressed both sides).
    const attId = /att_[0-9A-HJKMNP-TV-Z]{26}/.exec(log2.body)![0];
    const att = await target.inject({ method: 'GET', url: `/api/v1/attachments/${attId}` });
    expect(att.rawPayload.toString()).toBe('map-pixel-data');
    const sourceHash = uploaded.hash;
    const targetHash = (
      target.db.prepare('SELECT hash FROM attachments WHERE id = ?').get(attId) as { hash: string }
    ).hash;
    expect(targetHash).toBe(sourceHash);

    await source.close();
    await target.close();
  });

  it('validates the export path and refuses the data directory', async () => {
    const { app, dataDir } = await freshApp();
    const relative = await app.inject({ method: 'GET', url: '/api/v1/export/vault?path=relative' });
    expect(relative.statusCode).toBe(422);
    const insideData = await app.inject({
      method: 'GET',
      url: `/api/v1/export/vault?path=${encodeURIComponent(path.join(dataDir, 'sub'))}`,
    });
    expect(insideData.statusCode).toBe(422);
    expect(insideData.json().error.message).toContain('data directory');
    await app.close();
  });
});
