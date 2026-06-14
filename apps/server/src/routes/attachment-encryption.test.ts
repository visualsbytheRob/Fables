/**
 * Encrypted attachment integration (F1214).
 *
 * With the vault unlocked, an uploaded attachment is stored encrypted on disk
 * (MAGIC-prefixed ciphertext at <hash>.enc) and served back as plaintext; once
 * locked, the download is refused with 403.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

let app: FastifyInstance;
let dataDir: string;

const BOUNDARY = 'fables-enc-boundary';
const SECRET = Buffer.from('TOP-SECRET-ATTACHMENT-BYTES-12345', 'utf8');

function uploadPayload(content: Buffer, filename: string, mime: string) {
  const head = Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${BOUNDARY}--\r\n`);
  return {
    payload: Buffer.concat([head, content, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fables-enc-att-'));
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal', DATA_DIR: dataDir }));
  // Create + unlock a vault so attachment writes are encrypted.
  await app.vault.create('att-pass', 'interactive');
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('encrypted attachments (F1214)', () => {
  let attachmentId: string;
  let hash: string;

  it('stores an uploaded attachment encrypted on disk', async () => {
    const { payload, headers } = uploadPayload(SECRET, 'secret.txt', 'text/plain');
    const res = await app.inject({ method: 'POST', url: '/api/v1/attachments', payload, headers });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: { id: string; hash: string } };
    attachmentId = body.data.id;
    hash = body.data.hash;

    // On disk: the encrypted .enc file exists, the plaintext path does not,
    // and the raw bytes contain no plaintext.
    const encPath = path.join(dataDir, 'attachments', hash.slice(0, 2), `${hash}.enc`);
    const plainPath = path.join(dataDir, 'attachments', hash.slice(0, 2), hash);
    expect(fs.existsSync(encPath)).toBe(true);
    expect(fs.existsSync(plainPath)).toBe(false);
    const raw = fs.readFileSync(encPath);
    expect(raw.subarray(0, 4).toString('latin1')).toBe('FAE1'); // magic
    expect(raw.toString('latin1')).not.toContain('TOP-SECRET');
  });

  it('serves the attachment back as plaintext while unlocked', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/attachments/${attachmentId}` });
    expect(res.statusCode).toBe(200);
    expect(Buffer.from(res.rawPayload).equals(SECRET)).toBe(true);
  });

  it('refuses to serve an encrypted attachment once the vault is locked (403)', async () => {
    app.vault.lock();
    const res = await app.inject({ method: 'GET', url: `/api/v1/attachments/${attachmentId}` });
    expect(res.statusCode).toBe(403);
    // Re-unlock so afterAll teardown is clean.
    await app.vault.unlock('att-pass');
  });
});
