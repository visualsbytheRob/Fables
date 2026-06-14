/**
 * Encrypted-vault disaster recovery drill (F1293).
 *
 * Scripts the whole recover-from-catastrophe path end to end:
 *   1. create + unlock a vault, write encrypted notes
 *   2. take an encrypted backup (.fablesbak v2)
 *   3. simulate data loss (delete the notes)
 *   4. restore from the encrypted backup
 *   5. verify the restored database on disk still holds the notes AND that a
 *      fresh vault session can unlock it with the passphrase and read plaintext
 *
 * This is the proof that an encrypted backup is genuinely recoverable — not just
 * that it produced bytes.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDb } from '../db/connection.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import { ExtendedVaultService } from '../vault/extended-service.js';

let app: FastifyInstance;
let dataDir: string;
const PASSPHRASE = 'disaster-recovery-drill';

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fables-dr-'));
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal', DATA_DIR: dataDir }));
  await app.vault.create(PASSPHRASE, 'interactive');
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('encrypted vault disaster recovery drill (F1293)', () => {
  it('recovers encrypted notes from an encrypted backup', async () => {
    // 1. Write encrypted notes into the live (source) db.
    const codec = app.vault.fieldCodec()!;
    const nb = notebooksRepo(app.db).create({ name: 'Critical' });
    const repo = notesRepo(app.db, codec);
    repo.create({ notebookId: nb.id, title: 'Recovery Plan', body: 'the bunker code is 4815' });
    repo.create({ notebookId: nb.id, title: 'Contacts', body: 'call the lighthouse keeper' });
    expect(notesRepo(app.db).count()).toBe(2);

    // 2. Encrypted backup.
    const exp = await app.inject({ method: 'GET', url: '/api/v1/backup/export' });
    expect(exp.statusCode).toBe(200);
    const archive = Buffer.from(exp.rawPayload);
    expect(archive.subarray(0, 4).toString('latin1')).toBe('FBK2'); // sealed
    const archivePath = path.join(dataDir, 'dr-backup.fablesbak');
    fs.writeFileSync(archivePath, archive);

    // 3. Disaster: lose the notes.
    app.db.prepare('DELETE FROM notes').run();
    expect(notesRepo(app.db).count()).toBe(0);

    // 4. Restore from the encrypted backup (vault still unlocked).
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/backup/restore',
      payload: { archivePath },
    });
    expect(res.statusCode).toBe(200);

    // 5a. The restored database file on disk holds the notes again.
    expect(fs.existsSync(path.join(dataDir, 'fables.sqlite'))).toBe(true);
    const restored = openDb(dataDir);
    try {
      expect(notesRepo(restored).count()).toBe(2);
      // The bodies on disk are ciphertext (no plaintext leak survived the round-trip).
      const rawBodies = (
        restored.prepare('SELECT body FROM notes').all() as { body: string }[]
      ).map((r) => r.body);
      for (const b of rawBodies) expect(b.startsWith('enc:v1:')).toBe(true);

      // 5b. A fresh vault session unlocks the restored db and reads plaintext.
      const recoveredVault = new ExtendedVaultService(restored);
      await recoveredVault.unlock(PASSPHRASE);
      const recoveredCodec = recoveredVault.fieldCodec()!;
      const titles = notesRepo(restored, recoveredCodec)
        .listByNotebook(nb.id)
        .map((n) => n.title)
        .sort();
      expect(titles).toEqual(['Contacts', 'Recovery Plan']);
      const bodies = notesRepo(restored, recoveredCodec)
        .listByNotebook(nb.id)
        .map((n) => n.body);
      expect(bodies).toContain('the bunker code is 4815');
    } finally {
      restored.close();
    }
  });
});
