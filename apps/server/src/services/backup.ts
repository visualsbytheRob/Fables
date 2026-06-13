/**
 * Backup & restore service (F951–F960).
 *
 * Features:
 *  F951 — Scheduled nightly backup job
 *  F952 — Retention policy: 7 daily / 4 weekly / 6 monthly
 *  F953 — One-file .fablesbak archive (zlib-compressed tar-like bundle via fflate)
 *  F954 — Restore with pre-restore safety snapshot
 *  F955 — Backup verification (restore-and-checksum)
 *  F956 — Backup settings/status endpoint (see routes/backup.ts)
 *  F957 — Backup failure notification (logs + sets lastError)
 *  F958 — Export-everything: vault + attachments as portable archive
 *
 * Archive format (.fablesbak):
 *   A Uint8Array produced by fflate.zipSync containing:
 *     manifest.json  — { version, createdAt, dbSize, fileCount }
 *     fables.sqlite  — raw SQLite database file
 *     attachments/<hash[0..1]>/<hash>  — all attachment blobs
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync, unzipSync, type Zippable } from 'fflate';
import type { Db } from '../db/connection.js';
import type { FastifyBaseLogger } from 'fastify';

export const BACKUP_EXTENSION = '.fablesbak';

// ── Paths ────────────────────────────────────────────────────────────────────

export function backupsDir(dataDir: string): string {
  return path.join(dataDir, 'backups');
}

export function dbFile(dataDir: string): string {
  return path.join(dataDir, 'fables.sqlite');
}

// ── Archive creation (F953) ──────────────────────────────────────────────────

export interface BackupManifest {
  version: 1;
  createdAt: string;
  dbSizeBytes: number;
  dbChecksum: string; // sha256 hex of the database bytes
  attachmentCount: number;
  totalSizeBytes: number;
}

/**
 * Creates a .fablesbak archive in memory.
 * Returns the archive bytes and manifest.
 */
export async function createBackupArchive(
  db: Db,
  dataDir: string,
): Promise<{ bytes: Uint8Array; manifest: BackupManifest }> {
  // 1. Hot-backup the SQLite database to a temp file, then read it.
  const tmpDb = path.join(dataDir, `.backup-tmp-${Date.now()}.sqlite`);
  try {
    await db.backup(tmpDb);
    const dbBytes = fs.readFileSync(tmpDb);
    const dbChecksum = createHash('sha256').update(dbBytes).digest('hex');

    // 2. Gather attachments.
    const attachDir = path.join(dataDir, 'attachments');
    const attachFiles: { relPath: string; absPath: string }[] = [];
    if (fs.existsSync(attachDir)) {
      for (const shard of fs.readdirSync(attachDir)) {
        const shardPath = path.join(attachDir, shard);
        if (!fs.statSync(shardPath).isDirectory()) continue;
        for (const name of fs.readdirSync(shardPath)) {
          if (!/^[0-9a-f]{64}$/.test(name)) continue;
          attachFiles.push({
            relPath: `attachments/${shard}/${name}`,
            absPath: path.join(shardPath, name),
          });
        }
      }
    }

    // 2b. Gather installed plugin directories (F1094).
    const pluginsDir = path.join(dataDir, 'plugins');
    const pluginFiles: { relPath: string; absPath: string }[] = [];
    if (fs.existsSync(pluginsDir)) {
      for (const pluginId of fs.readdirSync(pluginsDir)) {
        const pluginPath = path.join(pluginsDir, pluginId);
        if (!fs.statSync(pluginPath).isDirectory()) continue;
        for (const file of fs.readdirSync(pluginPath)) {
          const filePath = path.join(pluginPath, file);
          if (!fs.statSync(filePath).isFile()) continue;
          pluginFiles.push({
            relPath: `plugins/${pluginId}/${file}`,
            absPath: filePath,
          });
        }
      }
    }

    // 3. Build the manifest.
    const manifest: BackupManifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      dbSizeBytes: dbBytes.byteLength,
      dbChecksum,
      attachmentCount: attachFiles.length,
      totalSizeBytes:
        dbBytes.byteLength +
        attachFiles.reduce((s, f) => s + fs.statSync(f.absPath).size, 0) +
        pluginFiles.reduce((s, f) => s + fs.statSync(f.absPath).size, 0),
    };

    // 4. Assemble the zip.
    const files: Zippable = {
      'manifest.json': [
        Buffer.from(JSON.stringify(manifest, null, 2)),
        { level: 0 }, // manifest stays readable even if zip tool is unavailable
      ],
      'fables.sqlite': [new Uint8Array(dbBytes), { level: 0 }], // SQLite is already compressed
    };
    for (const { relPath, absPath } of attachFiles) {
      files[relPath] = [new Uint8Array(fs.readFileSync(absPath)), { level: 0 }];
    }
    // Include plugin files in the backup (F1094)
    for (const { relPath, absPath } of pluginFiles) {
      files[relPath] = [new Uint8Array(fs.readFileSync(absPath)), { level: 0 }];
    }

    const bytes = zipSync(files);
    return { bytes, manifest };
  } finally {
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  }
}

// ── Write backup to disk (F951) ───────────────────────────────────────────────

export interface BackupResult {
  path: string;
  manifest: BackupManifest;
  sizeBytes: number;
}

export async function runBackup(db: Db, dataDir: string): Promise<BackupResult> {
  const dir = backupsDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(dir, `fables-${stamp}${BACKUP_EXTENSION}`);

  const { bytes, manifest } = await createBackupArchive(db, dataDir);
  fs.writeFileSync(dest, bytes);

  return { path: dest, manifest, sizeBytes: bytes.byteLength };
}

// ── Retention policy (F952) ───────────────────────────────────────────────────

export interface RetentionPolicy {
  dailyCount: number; // keep N most-recent daily backups
  weeklyCount: number; // keep N most-recent weekly backups (one per week)
  monthlyCount: number; // keep N most-recent monthly backups (one per month)
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  dailyCount: 7,
  weeklyCount: 4,
  monthlyCount: 6,
};

function dateOf(filename: string): Date | null {
  const m = filename.match(/fables-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d+-\w+)/);
  if (!m) return null;
  // Undo timestamp normalisation: replace first 3 hyphens-after-T with colons.
  const iso = m[1]!.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})-(\w+)/, 'T$1:$2:$3.$4Z');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Removes backup files that fall outside the retention policy. */
export function applyRetentionPolicy(
  dataDir: string,
  policy: RetentionPolicy = DEFAULT_RETENTION,
): string[] {
  const dir = backupsDir(dataDir);
  if (!fs.existsSync(dir)) return [];

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(BACKUP_EXTENSION))
    .map((f) => ({ name: f, date: dateOf(f), full: path.join(dir, f) }))
    .filter((f): f is typeof f & { date: Date } => f.date !== null)
    .sort((a, b) => b.date.getTime() - a.date.getTime()); // newest first

  const keep = new Set<string>();

  // Daily: N most recent.
  files.slice(0, policy.dailyCount).forEach((f) => keep.add(f.full));

  // Weekly: one per ISO week (first occurrence wins = most recent that week).
  const seenWeeks = new Set<string>();
  let weeklyKept = 0;
  for (const f of files) {
    const week = `${f.date.getUTCFullYear()}-W${String(isoWeek(f.date)).padStart(2, '0')}`;
    if (!seenWeeks.has(week) && weeklyKept < policy.weeklyCount) {
      seenWeeks.add(week);
      keep.add(f.full);
      weeklyKept += 1;
    }
  }

  // Monthly: one per calendar month.
  const seenMonths = new Set<string>();
  let monthlyKept = 0;
  for (const f of files) {
    const month = `${f.date.getUTCFullYear()}-${String(f.date.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!seenMonths.has(month) && monthlyKept < policy.monthlyCount) {
      seenMonths.add(month);
      keep.add(f.full);
      monthlyKept += 1;
    }
  }

  // Delete the rest.
  const deleted: string[] = [];
  for (const f of files) {
    if (!keep.has(f.full)) {
      fs.unlinkSync(f.full);
      deleted.push(f.full);
    }
  }
  return deleted;
}

/** ISO week number (Monday-based). */
function isoWeek(d: Date): number {
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const startOfWeek1 = jan4.getTime() - (((jan4.getUTCDay() + 6) % 7) * 86_400_000);
  return Math.ceil((d.getTime() - startOfWeek1) / (7 * 86_400_000)) + 1;
}

// ── Restore (F954) ────────────────────────────────────────────────────────────

export interface RestoreResult {
  safetySnapshotPath: string;
  restoredDbPath: string;
  attachmentsRestored: number;
}

/**
 * Restores a .fablesbak archive.
 *  1. Safety-snapshot the current database before touching anything.
 *  2. Extract the archive.
 *  3. Overwrite `fables.sqlite` and attachment files.
 *
 * NOTE: the caller must restart the server after calling this for the restored
 * DB to be picked up (better-sqlite3 holds the file open).
 */
export async function restoreBackup(
  db: Db,
  dataDir: string,
  archivePath: string,
): Promise<RestoreResult> {
  if (!fs.existsSync(archivePath)) {
    throw new Error(`backup archive not found: ${archivePath}`);
  }

  // 1. Pre-restore safety snapshot.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safetyPath = path.join(dataDir, `pre-restore-${stamp}.sqlite`);
  await db.backup(safetyPath);

  // 2. Read + unzip archive.
  const archiveBytes = new Uint8Array(fs.readFileSync(archivePath));
  const files = unzipSync(archiveBytes);

  // 3. Verify manifest.
  const manifestBytes = files['manifest.json'];
  if (!manifestBytes) throw new Error('invalid archive: missing manifest.json');
  const manifest = JSON.parse(Buffer.from(manifestBytes).toString('utf8')) as BackupManifest;
  if (manifest.version !== 1) throw new Error(`unsupported backup version: ${manifest.version}`);

  // 4. Restore database file.
  const dbBytes = files['fables.sqlite'];
  if (!dbBytes) throw new Error('invalid archive: missing fables.sqlite');

  // Verify checksum before overwriting.
  const actualChecksum = createHash('sha256').update(dbBytes).digest('hex');
  if (actualChecksum !== manifest.dbChecksum) {
    throw new Error(
      `backup database checksum mismatch: expected ${manifest.dbChecksum}, got ${actualChecksum}`,
    );
  }

  const targetDb = dbFile(dataDir);
  fs.writeFileSync(targetDb, dbBytes);

  // 5. Restore attachments.
  let attachmentsRestored = 0;
  for (const [relPath, bytes] of Object.entries(files)) {
    if (!relPath.startsWith('attachments/')) continue;
    const destPath = path.join(dataDir, relPath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, bytes);
    attachmentsRestored += 1;
  }

  return { safetySnapshotPath: safetyPath, restoredDbPath: targetDb, attachmentsRestored };
}

// ── Backup verification (F955) ────────────────────────────────────────────────

export interface VerifyResult {
  valid: boolean;
  dbChecksumOk: boolean;
  manifestPresent: boolean;
  error?: string;
}

/** Verifies a .fablesbak archive without restoring it. */
export function verifyBackup(archivePath: string): VerifyResult {
  try {
    const bytes = new Uint8Array(fs.readFileSync(archivePath));
    const files = unzipSync(bytes);

    const manifestBytes = files['manifest.json'];
    if (!manifestBytes) {
      return { valid: false, dbChecksumOk: false, manifestPresent: false, error: 'missing manifest.json' };
    }

    const manifest = JSON.parse(Buffer.from(manifestBytes).toString('utf8')) as BackupManifest;
    const dbBytes = files['fables.sqlite'];
    if (!dbBytes) {
      return { valid: false, dbChecksumOk: false, manifestPresent: true, error: 'missing fables.sqlite' };
    }

    const actualChecksum = createHash('sha256').update(dbBytes).digest('hex');
    const dbChecksumOk = actualChecksum === manifest.dbChecksum;

    return { valid: dbChecksumOk, dbChecksumOk, manifestPresent: true };
  } catch (err) {
    return {
      valid: false,
      dbChecksumOk: false,
      manifestPresent: false,
      error: (err as Error).message,
    };
  }
}

// ── Backup status ─────────────────────────────────────────────────────────────

export interface BackupStatus {
  lastBackupAt: string | null;
  lastBackupPath: string | null;
  lastBackupSizeBytes: number | null;
  lastError: string | null;
  backupCount: number;
  oldestBackupAt: string | null;
}

export function getBackupStatus(dataDir: string): BackupStatus {
  const dir = backupsDir(dataDir);
  if (!fs.existsSync(dir)) {
    return {
      lastBackupAt: null,
      lastBackupPath: null,
      lastBackupSizeBytes: null,
      lastError: null,
      backupCount: 0,
      oldestBackupAt: null,
    };
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(BACKUP_EXTENSION))
    .map((f) => {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      return { name: f, full, mtimeMs: stat.mtimeMs, sizeBytes: stat.size };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (files.length === 0) {
    return {
      lastBackupAt: null,
      lastBackupPath: null,
      lastBackupSizeBytes: null,
      lastError: null,
      backupCount: 0,
      oldestBackupAt: null,
    };
  }

  const latest = files[0]!;
  const oldest = files[files.length - 1]!;

  return {
    lastBackupAt: new Date(latest.mtimeMs).toISOString(),
    lastBackupPath: latest.full,
    lastBackupSizeBytes: latest.sizeBytes,
    lastError: null,
    backupCount: files.length,
    oldestBackupAt: new Date(oldest.mtimeMs).toISOString(),
  };
}

// ── Scheduled backup job (F951) ───────────────────────────────────────────────

const NIGHTLY_INTERVAL_MS = 24 * 60 * 60 * 1000;

let backupTimer: ReturnType<typeof setTimeout> | null = null;
let lastBackupError: string | null = null;

export function getLastBackupError(): string | null {
  return lastBackupError;
}

/**
 * Schedules a nightly backup job. The first run happens after `firstDelayMs`
 * (default: 5 minutes after boot to avoid startup load); subsequent runs are
 * every 24 hours.
 */
export function scheduleBackupJob(
  db: Db,
  dataDir: string,
  log: FastifyBaseLogger,
  firstDelayMs = 5 * 60 * 1000,
): () => void {
  async function doBackup(): Promise<void> {
    try {
      log.info('scheduled backup starting');
      const result = await runBackup(db, dataDir);
      applyRetentionPolicy(dataDir);
      lastBackupError = null;
      log.info(
        { path: result.path, sizeBytes: result.sizeBytes },
        'scheduled backup complete',
      );
    } catch (err) {
      lastBackupError = (err as Error).message;
      log.error({ err }, 'scheduled backup failed');
    } finally {
      backupTimer = setTimeout(() => void doBackup(), NIGHTLY_INTERVAL_MS);
    }
  }

  backupTimer = setTimeout(() => void doBackup(), firstDelayMs);

  return function cancel() {
    if (backupTimer) {
      clearTimeout(backupTimer);
      backupTimer = null;
    }
  };
}

// ── Export everything (F958) ──────────────────────────────────────────────────

/**
 * Export-everything: same as a full backup but named `.fablesvault.zip` and
 * includes a human-readable README inside the archive.
 */
export async function exportEverything(
  db: Db,
  dataDir: string,
): Promise<{ bytes: Uint8Array; manifest: BackupManifest }> {
  const { bytes: archiveBytes, manifest } = await createBackupArchive(db, dataDir);

  // Add a README to the top-level of the archive.
  const existing = unzipSync(archiveBytes);
  const readme = `# Fables Vault Export

Created: ${manifest.createdAt}
DB size: ${manifest.dbSizeBytes} bytes
Attachments: ${manifest.attachmentCount} files

## Restore

1. Copy this archive to your new machine.
2. Run: fables restore <path-to-this-file>
   OR
   Extract manually: unzip <file> and place fables.sqlite in ~/.fables/

## Contents

- manifest.json   — metadata and checksums
- fables.sqlite   — SQLite database (notes, stories, entities, everything)
- attachments/    — all uploaded files (content-addressed by SHA-256 hash)
`;

  const withReadme: Zippable = { ...existing, 'README.md': [Buffer.from(readme), { level: 0 }] };
  return { bytes: zipSync(withReadme), manifest };
}
