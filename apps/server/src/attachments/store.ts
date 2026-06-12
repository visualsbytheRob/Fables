import fs from 'node:fs';
import path from 'node:path';
import { withTransaction, type Db } from '../db/connection.js';
import { attachmentsRepo } from '../db/repos/attachments.js';

/**
 * Content-addressed attachment store (F161): files live at
 * `DATA_DIR/attachments/<hash[0..2]>/<hash>`, so identical uploads share bytes.
 */

export function attachmentsDir(dataDir: string): string {
  return path.join(dataDir, 'attachments');
}

export function attachmentPath(dataDir: string, hash: string): string {
  return path.join(attachmentsDir(dataDir), hash.slice(0, 2), hash);
}

/** Writes the blob if its hash isn't stored yet (tmp file + rename, so never partial). */
export function saveAttachmentFile(dataDir: string, hash: string, content: Buffer): void {
  const dest = attachmentPath(dataDir, hash);
  if (fs.existsSync(dest)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, dest);
}

export function removeAttachmentFile(dataDir: string, hash: string): boolean {
  const file = attachmentPath(dataDir, hash);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

/** All content hashes present on disk, with mtimes (for GC grace checks). */
export function listStoredFiles(dataDir: string): { hash: string; mtimeMs: number }[] {
  const root = attachmentsDir(dataDir);
  if (!fs.existsSync(root)) return [];
  const out: { hash: string; mtimeMs: number }[] = [];
  for (const shard of fs.readdirSync(root)) {
    const shardDir = path.join(root, shard);
    if (!fs.statSync(shardDir).isDirectory()) continue;
    for (const name of fs.readdirSync(shardDir)) {
      if (!/^[0-9a-f]{64}$/.test(name)) continue; // skip stray tmp files
      out.push({ hash: name, mtimeMs: fs.statSync(path.join(shardDir, name)).mtimeMs });
    }
  }
  return out;
}

export interface GcResult {
  removedRows: number;
  removedFiles: number;
}

/**
 * Attachment garbage collection (F164). Two passes:
 *  1. drop metadata rows that no note owns (older than the grace window, so
 *     uploads that haven't been saved into a note yet survive);
 *  2. unlink files on disk whose hash no remaining row references.
 */
export function gcAttachments(
  db: Db,
  dataDir: string,
  opts: { graceMs?: number; now?: Date } = {},
): GcResult {
  const graceMs = opts.graceMs ?? 60 * 60 * 1000;
  const now = opts.now ?? new Date();
  const cutoffIso = new Date(now.getTime() - graceMs).toISOString();
  const repo = attachmentsRepo(db);

  const removedRows = withTransaction(db, () => {
    let removed = 0;
    for (const attachment of repo.unreferenced(cutoffIso)) {
      if (repo.remove(attachment.id)) removed += 1;
    }
    return removed;
  });

  const live = repo.allHashes();
  let removedFiles = 0;
  for (const file of listStoredFiles(dataDir)) {
    if (live.has(file.hash)) continue;
    if (file.mtimeMs > now.getTime() - graceMs) continue;
    if (removeAttachmentFile(dataDir, file.hash)) removedFiles += 1;
  }
  return { removedRows, removedFiles };
}
