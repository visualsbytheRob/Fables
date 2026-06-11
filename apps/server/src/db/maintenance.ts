import path from 'node:path';
import type { Db } from './connection.js';

/** Online backup to a timestamped sibling file; returns the backup path. */
export async function backup(db: Db, dataDir: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(dataDir, `fables-backup-${stamp}.sqlite`);
  await db.backup(dest);
  return dest;
}

/** PRAGMA integrity_check; returns issues (empty array = healthy). */
export function integrityCheck(db: Db): string[] {
  const rows = db.pragma('integrity_check') as { integrity_check: string }[];
  const issues = rows.map((r) => r.integrity_check).filter((msg) => msg !== 'ok');
  return issues;
}
