/**
 * Vault conversion + encryption benchmark (Epic 13, F1215, F1219, F1292).
 */

import {
  decryptFieldSync,
  encryptFieldSync,
  generateDataKey,
  isEncryptedField,
  type NotebookId,
} from '@fables/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import { convertToEncrypted, convertToPlaintext } from './conversion.js';
import { ExtendedVaultService } from './extended-service.js';

let db: ReturnType<typeof openDb>;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
});

describe('plaintext → encrypted conversion (F1215)', () => {
  it('encrypts every note, verifies, and reverses cleanly', async () => {
    const nb = notebooksRepo(db).create({ name: 'N' }).id;
    const notes = notesRepo(db);
    const a = notes.create({ notebookId: nb as NotebookId, title: 'Alpha', body: 'first body' });
    const b = notes.create({ notebookId: nb as NotebookId, title: 'Beta', body: 'second body' });

    const vault = new ExtendedVaultService(db);
    await vault.create('vault-pass', 'interactive');
    const codec = vault.fieldCodec()!;

    const report = convertToEncrypted(db, codec);
    expect(report.converted).toBe(2);
    expect(report.verified).toBe(true);

    // Stored fields are now ciphertext.
    const rawA = db.prepare('SELECT title, body FROM notes WHERE id = ?').get(a.id) as {
      title: string;
      body: string;
    };
    expect(isEncryptedField(rawA.title)).toBe(true);
    expect(isEncryptedField(rawA.body)).toBe(true);

    // Re-running is idempotent (already encrypted → skipped).
    expect(convertToEncrypted(db, codec).converted).toBe(0);

    // Reverse restores the original plaintext.
    const back = convertToPlaintext(db, codec);
    expect(back.converted).toBe(2);
    const restored = db.prepare('SELECT title, body FROM notes WHERE id = ?').get(b.id) as {
      title: string;
      body: string;
    };
    expect(restored.title).toBe('Beta');
    expect(restored.body).toBe('second body');
  });
});

describe('encryption performance baseline (F1219/F1292)', () => {
  it('field encrypt+decrypt round-trips stay well within budget', async () => {
    const key = await generateDataKey();
    const N = 2000;
    const sample = 'A representative note body with a sentence or two of content.';

    const start = performance.now();
    for (let i = 0; i < N; i += 1) {
      const ct = encryptFieldSync(`${sample} #${i}`, key);
      const pt = decryptFieldSync(ct, key);
      if (pt !== `${sample} #${i}`) throw new Error('round-trip mismatch');
    }
    const elapsedMs = performance.now() - start;
    const perOpUs = (elapsedMs * 1000) / N;

    // AEAD field ops are microsecond-scale; this is a generous ceiling that
    // documents the at-rest overhead vs a plaintext (no-op) vault.
    expect(elapsedMs).toBeLessThan(3000);
    expect(perOpUs).toBeLessThan(1500);
  });
});
