/**
 * Backup & restore API routes (F951–F960).
 *
 *  GET  /backup/status          — last backup info, schedule
 *  POST /backup/run             — trigger an immediate backup
 *  POST /backup/restore         — restore from a local archive path
 *  POST /backup/verify          — verify an archive without restoring
 *  GET  /backup/export          — download a full vault export archive
 */

import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import {
  exportEverything,
  getBackupStatus,
  getLastBackupError,
  runBackup,
  verifyBackup,
} from '../services/backup.js';
import {
  isEncryptedBackup,
  unwrapEncryptedBackup,
  wrapEncryptedBackup,
} from '../vault/backup-crypto.js';

registerRoute({ method: 'GET', path: '/backup/status', summary: 'Backup status + last result' });
registerRoute({ method: 'POST', path: '/backup/run', summary: 'Trigger an immediate backup' });
registerRoute({
  method: 'POST',
  path: '/backup/restore',
  summary: 'Restore from a .fablesbak archive on disk',
});
registerRoute({
  method: 'POST',
  path: '/backup/verify',
  summary: 'Verify a .fablesbak archive without restoring',
});
registerRoute({
  method: 'GET',
  path: '/backup/export',
  summary: 'Download a full vault export (.fablesbak)',
});

const restoreBodySchema = z.object({
  archivePath: z.string().min(1),
});
const verifyBodySchema = z.object({
  archivePath: z.string().min(1),
});

export const backupRoutes: FastifyPluginAsync = async (app) => {
  app.get('/backup/status', async () => {
    const status = getBackupStatus(app.dataDir);
    const lastError = getLastBackupError();
    return {
      data: {
        ...status,
        lastError: lastError ?? status.lastError,
        schedule: 'nightly (first run 5 min after boot)',
        retentionPolicy: { dailyCount: 7, weeklyCount: 4, monthlyCount: 6 },
      },
    };
  });

  app.post('/backup/run', async () => {
    const result = await runBackup(app.db, app.dataDir);
    return {
      data: {
        path: result.path,
        sizeBytes: result.sizeBytes,
        manifest: result.manifest,
      },
    };
  });

  app.post('/backup/restore', async (request) => {
    const { archivePath } = parseWith(restoreBodySchema, request.body, 'body');
    const { restoreBackup } = await import('../services/backup.js');

    // F1218: a v2 (encrypted) archive is decrypted to a temp file first, which
    // requires the vault to be unlocked. v1 archives restore directly.
    let restorePath = archivePath;
    let tmpDecrypted: string | null = null;
    if (fs.existsSync(archivePath)) {
      const raw = new Uint8Array(fs.readFileSync(archivePath));
      if (isEncryptedBackup(raw)) {
        if (!app.vault.isUnlocked()) {
          throw new AppError('FORBIDDEN', 'encrypted backup — unlock the vault to restore it');
        }
        const inner = app.vault.openBlob(unwrapEncryptedBackup(raw));
        tmpDecrypted = path.join(app.dataDir, `.restore-dec-${Date.now()}.fablesbak`);
        fs.writeFileSync(tmpDecrypted, Buffer.from(inner));
        restorePath = tmpDecrypted;
      }
    }

    try {
      const result = await restoreBackup(app.db, app.dataDir, restorePath);
      return {
        data: {
          safetySnapshotPath: result.safetySnapshotPath,
          restoredDbPath: result.restoredDbPath,
          attachmentsRestored: result.attachmentsRestored,
          note: 'Restart the server to load the restored database.',
        },
      };
    } finally {
      if (tmpDecrypted) fs.rmSync(tmpDecrypted, { force: true });
    }
  });

  app.post('/backup/verify', async (request) => {
    const { archivePath } = parseWith(verifyBodySchema, request.body, 'body');
    const result = verifyBackup(archivePath);
    return { data: result };
  });

  app.get('/backup/export', async (_request, reply) => {
    const { bytes, manifest } = await exportEverything(app.db, app.dataDir);
    // F1218: when the vault is unlocked, seal the whole archive (.fablesbak v2).
    const out = app.vault.isUnlocked()
      ? wrapEncryptedBackup(app.vault.sealBlob(bytes))
      : Buffer.from(bytes);
    const stamp = manifest.createdAt.replace(/[:.]/g, '-');
    const filename = `fables-export-${stamp}.fablesbak`;
    return reply
      .header('content-type', 'application/octet-stream')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .header('content-length', out.byteLength)
      .send(out);
  });
};
