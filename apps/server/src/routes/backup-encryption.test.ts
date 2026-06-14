/**
 * Encrypted backup (.fablesbak v2) integration (F1218).
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

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fables-bak-enc-'));
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal', DATA_DIR: dataDir }));
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function exportBytes(): Promise<Buffer> {
  const res = await app.inject({ method: 'GET', url: '/api/v1/backup/export' });
  expect(res.statusCode).toBe(200);
  return Buffer.from(res.rawPayload);
}

describe('encrypted backup v2 (F1218)', () => {
  it('exports a plaintext zip when no vault is unlocked', async () => {
    const bytes = await exportBytes();
    // fflate zip archives start with the local-file-header magic "PK".
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(bytes.subarray(0, 4).toString('latin1')).not.toBe('FBK2');
  });

  it('exports a sealed archive (FBK2, no plaintext db header) when unlocked', async () => {
    await app.vault.create('bak-pass', 'interactive');
    const bytes = await exportBytes();
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('FBK2');
    // The SQLite file header must not appear in the ciphertext.
    expect(bytes.toString('latin1')).not.toContain('SQLite format 3');
  });

  it('restores a v2 archive while unlocked, and refuses while locked (403)', async () => {
    const bytes = await exportBytes(); // vault still unlocked from previous test
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('FBK2');
    const archivePath = path.join(dataDir, 'enc-export.fablesbak');
    fs.writeFileSync(archivePath, bytes);

    // Locked → 403.
    app.vault.lock();
    const locked = await app.inject({
      method: 'POST',
      url: '/api/v1/backup/restore',
      payload: { archivePath },
    });
    expect(locked.statusCode).toBe(403);

    // Unlocked → restore proceeds.
    await app.vault.unlock('bak-pass');
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/backup/restore',
      payload: { archivePath },
    });
    expect(ok.statusCode).toBe(200);
    expect(
      (ok.json() as { data: { safetySnapshotPath: string } }).data.safetySnapshotPath,
    ).toBeTruthy();
  });
});
