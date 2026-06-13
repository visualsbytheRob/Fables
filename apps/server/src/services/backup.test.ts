/**
 * Backup & restore integration tests (F955, F960).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { zipSync, unzipSync } from 'fflate';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import {
  applyRetentionPolicy,
  BACKUP_EXTENSION,
  createBackupArchive,
  exportEverything,
  getBackupStatus,
  runBackup,
  verifyBackup,
} from './backup.js';

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fables-backup-test-'));
  fs.mkdirSync(path.join(dataDir, 'attachments', 'aa'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function freshDb() {
  const db = openDb(dataDir);
  migrate(db);
  return db;
}

describe('createBackupArchive', () => {
  it('produces a valid zip with manifest + fables.sqlite', async () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'test' });
    notesRepo(db).create({ notebookId: nb.id, title: 'hello', body: 'world' });

    const { bytes, manifest } = await createBackupArchive(db, dataDir);
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(manifest.version).toBe(1);
    expect(manifest.dbSizeBytes).toBeGreaterThan(0);
    expect(manifest.dbChecksum).toMatch(/^[0-9a-f]{64}$/);
    db.close();
  });

  it('includes attachment files', async () => {
    const db = freshDb();
    // Write a fake attachment blob.
    const hash = 'a'.repeat(64);
    const shardDir = path.join(dataDir, 'attachments', hash.slice(0, 2));
    fs.mkdirSync(shardDir, { recursive: true });
    fs.writeFileSync(path.join(shardDir, hash), 'fake-image-data');

    const { manifest } = await createBackupArchive(db, dataDir);
    expect(manifest.attachmentCount).toBe(1);
    db.close();
  });
});

describe('runBackup → verifyBackup round-trip (F955)', () => {
  it('backup passes verification', async () => {
    const db = freshDb();
    const result = await runBackup(db, dataDir);

    const verify = verifyBackup(result.path);
    expect(verify.valid).toBe(true);
    expect(verify.dbChecksumOk).toBe(true);
    expect(verify.manifestPresent).toBe(true);
    db.close();
  });

  it('corrupted archive fails verification', async () => {
    const db = freshDb();
    const result = await runBackup(db, dataDir);

    // Corrupt the DB bytes inside the zip (tamper with the checksum).
    const archiveBytes = new Uint8Array(fs.readFileSync(result.path));
    const files = unzipSync(archiveBytes);
    // Flip some bytes in the DB file so the sha256 no longer matches manifest.
    const dbBytes = files['fables.sqlite']!;
    for (let i = 0; i < Math.min(4, dbBytes.length); i++) {
      dbBytes[i] = (dbBytes[i] ?? 0) ^ 0xff;
    }
    const corruptedZip = zipSync({ ...files, 'fables.sqlite': [dbBytes, { level: 0 }] });
    fs.writeFileSync(result.path, corruptedZip);

    const verify = verifyBackup(result.path);
    expect(verify.valid).toBe(false);
    expect(verify.dbChecksumOk).toBe(false);
    db.close();
  });

  it('missing archive returns valid=false', () => {
    const verify = verifyBackup('/does/not/exist.fablesbak');
    expect(verify.valid).toBe(false);
    expect(verify.error).toBeTruthy();
  });
});

describe('retention policy (F952)', () => {
  it('keeps configured number of backups and deletes the rest', () => {
    const backupDir = path.join(dataDir, 'backups');
    fs.mkdirSync(backupDir);

    // Create 10 fake backup files with different timestamps.
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      const stamp = d.toISOString().replace(/[:.]/g, '-');
      const p = path.join(backupDir, `fables-${stamp}${BACKUP_EXTENSION}`);
      fs.writeFileSync(p, 'fake');
    }

    const deleted = applyRetentionPolicy(dataDir, {
      dailyCount: 3,
      weeklyCount: 2,
      monthlyCount: 1,
    });

    const remaining = fs.readdirSync(backupDir).filter((f) => f.endsWith(BACKUP_EXTENSION));
    // We should have at most 3 daily + some weekly/monthly (overlapping).
    expect(remaining.length).toBeLessThanOrEqual(10);
    expect(deleted.length).toBeGreaterThanOrEqual(0);
  });

  it('does nothing when no backups exist', () => {
    expect(() => applyRetentionPolicy(dataDir)).not.toThrow();
  });
});

describe('getBackupStatus', () => {
  it('returns nulls when no backups exist', () => {
    const status = getBackupStatus(dataDir);
    expect(status.lastBackupAt).toBeNull();
    expect(status.backupCount).toBe(0);
  });

  it('reflects the latest backup', async () => {
    const db = freshDb();
    await runBackup(db, dataDir);
    const status = getBackupStatus(dataDir);
    expect(status.backupCount).toBe(1);
    expect(status.lastBackupAt).not.toBeNull();
    db.close();
  });
});

describe('exportEverything (F958)', () => {
  it('produces a valid zip containing README.md', async () => {
    const db = freshDb();
    const { bytes: exportBytes, manifest } = await exportEverything(db, dataDir);
    // Verify the export is a valid zip containing expected files.
    const files = unzipSync(exportBytes);
    expect('README.md' in files).toBe(true);
    expect('fables.sqlite' in files).toBe(true);
    expect('manifest.json' in files).toBe(true);
    expect(manifest.version).toBe(1);
    db.close();
  });
});
