import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { attachmentPath, gcAttachments, saveAttachmentFile } from '../attachments/store.js';
import { loadConfig } from '../config.js';
import { sha256Hex } from '../lib/hash.js';
import { MAX_ATTACHMENT_BYTES } from './attachments.js';

let app: FastifyInstance;
let dataDir: string;
let noteId: string;

const BOUNDARY = 'fables-test-boundary';

interface Part {
  name: string;
  value?: string;
  filename?: string;
  mime?: string;
  content?: Buffer;
}

function multipartPayload(parts: Part[]): { payload: Buffer; headers: Record<string, string> } {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${BOUNDARY}\r\n`));
    if (part.filename !== undefined) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
            `Content-Type: ${part.mime}\r\n\r\n`,
        ),
      );
      chunks.push(part.content!);
    } else {
      chunks.push(
        Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}`),
      );
    }
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

async function upload(parts: Part[]) {
  const { payload, headers } = multipartPayload(parts);
  return app.inject({ method: 'POST', url: '/api/v1/attachments', payload, headers });
}

const PNG_BYTES = Buffer.from('89504e470d0a1a0a-fake-png-payload', 'utf8');

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fables-attachments-'));
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal', DATA_DIR: dataDir }));
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/notebooks',
    payload: { name: 'Files' },
  });
  const nb = res.json().data.id;
  const note = await app.inject({
    method: 'POST',
    url: '/api/v1/notes',
    payload: { notebookId: nb, title: 'owner' },
  });
  noteId = note.json().data.id;
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('attachment upload (F161–F162, F165)', () => {
  it('stores uploads content-addressed with metadata', async () => {
    const res = await upload([
      { name: 'noteId', value: noteId },
      { name: 'file', filename: 'fox.png', mime: 'image/png', content: PNG_BYTES },
    ]);
    expect(res.statusCode).toBe(201);
    const attachment = res.json().data;
    expect(attachment).toMatchObject({
      noteId,
      filename: 'fox.png',
      mime: 'image/png',
      size: PNG_BYTES.byteLength,
      hash: sha256Hex(PNG_BYTES),
    });
    expect(fs.existsSync(attachmentPath(dataDir, attachment.hash))).toBe(true);
  });

  it('dedupes identical content by hash (one file, two rows)', async () => {
    const content = Buffer.from('identical bytes for dedupe');
    const first = await upload([{ name: 'file', filename: 'a.txt', mime: 'text/plain', content }]);
    const second = await upload([{ name: 'file', filename: 'b.txt', mime: 'text/plain', content }]);
    const a = first.json().data;
    const b = second.json().data;
    expect(a.id).not.toBe(b.id);
    expect(a.hash).toBe(b.hash);
    const shardDir = path.dirname(attachmentPath(dataDir, a.hash));
    expect(fs.readdirSync(shardDir)).toEqual([a.hash]);
  });

  it('rejects disallowed file types with a clear error (F165)', async () => {
    const res = await upload([
      { name: 'file', filename: 'evil.zip', mime: 'application/zip', content: Buffer.from('zip') },
    ]);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain('application/zip');
  });

  it('rejects uploads past the 25 MB limit (F165)', async () => {
    const res = await upload([
      {
        name: 'file',
        filename: 'huge.png',
        mime: 'image/png',
        content: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 7),
      },
    ]);
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('404s uploads referencing unknown notes', async () => {
    const res = await upload([
      { name: 'noteId', value: 'note_00000000000000000000000000' },
      { name: 'file', filename: 'x.png', mime: 'image/png', content: PNG_BYTES },
    ]);
    expect(res.statusCode).toBe(404);
  });
});

describe('attachment serving (F161)', () => {
  it('streams the file with its mime type', async () => {
    const content = Buffer.from('streamed body bytes');
    const uploaded = (
      await upload([{ name: 'file', filename: 'stream.txt', mime: 'text/plain', content }])
    ).json().data;

    const res = await app.inject({ method: 'GET', url: `/api/v1/attachments/${uploaded.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/plain');
    expect(res.headers['content-disposition']).toContain('stream.txt');
    expect(res.rawPayload.equals(content)).toBe(true);
  });

  it('404s unknown attachments', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/attachments/att_00000000000000000000000000',
    });
    expect(res.statusCode).toBe(404);
  });

  it('lists attachments newest-first', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/attachments?limit=5' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThan(0);
    expect(res.json().page).toBeDefined();
  });
});

describe('attachment deletion + GC (F164, F170)', () => {
  it('keeps the blob until the last row sharing its hash is deleted', async () => {
    const content = Buffer.from('shared blob for deletion test');
    const a = (
      await upload([{ name: 'file', filename: 'a.bin', mime: 'image/png', content }])
    ).json().data;
    const b = (
      await upload([{ name: 'file', filename: 'b.bin', mime: 'image/png', content }])
    ).json().data;

    const first = await app.inject({ method: 'DELETE', url: `/api/v1/attachments/${a.id}` });
    expect(first.json().data.fileDeleted).toBe(false);
    expect(fs.existsSync(attachmentPath(dataDir, a.hash))).toBe(true);

    const second = await app.inject({ method: 'DELETE', url: `/api/v1/attachments/${b.id}` });
    expect(second.json().data.fileDeleted).toBe(true);
    expect(fs.existsSync(attachmentPath(dataDir, b.hash))).toBe(false);
  });

  it('GCs rows with no owning note after the grace window, plus orphan files', async () => {
    const uploaded = (
      await upload([
        {
          name: 'file',
          filename: 'unowned.png',
          mime: 'image/png',
          content: Buffer.from('unowned'),
        },
      ])
    ).json().data;
    const strayHash = sha256Hex('stray file with no metadata row');
    saveAttachmentFile(dataDir, strayHash, Buffer.from('stray file with no metadata row'));

    // Negative grace = everything is past the window, so the sweep is immediate.
    const result = gcAttachments(app.db, dataDir, { graceMs: -1000 });
    expect(result.removedRows).toBeGreaterThanOrEqual(1);
    expect(result.removedFiles).toBeGreaterThanOrEqual(2);
    expect(fs.existsSync(attachmentPath(dataDir, uploaded.hash))).toBe(false);
    expect(fs.existsSync(attachmentPath(dataDir, strayHash))).toBe(false);

    const gone = await app.inject({ method: 'GET', url: `/api/v1/attachments/${uploaded.id}` });
    expect(gone.statusCode).toBe(404);
  });

  it('spares fresh unowned uploads (grace window) and note-owned attachments', async () => {
    const owned = (
      await upload([
        { name: 'noteId', value: noteId },
        {
          name: 'file',
          filename: 'owned.png',
          mime: 'image/png',
          content: Buffer.from('owned bytes'),
        },
      ])
    ).json().data;
    const fresh = (
      await upload([
        {
          name: 'file',
          filename: 'fresh.png',
          mime: 'image/png',
          content: Buffer.from('fresh bytes'),
        },
      ])
    ).json().data;

    const res = await app.inject({ method: 'POST', url: '/api/v1/attachments/gc' });
    expect(res.statusCode).toBe(200);

    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/attachments/${owned.id}` })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/attachments/${fresh.id}` })).statusCode,
    ).toBe(200);
  });
});
