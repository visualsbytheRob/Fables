import type { FastifyBaseLogger } from 'fastify';
import { gcAttachments } from './attachments/store.js';
import type { Db } from './db/connection.js';
import { linksRepo } from './db/repos/links.js';
import { notesRepo } from './db/repos/notes.js';
import { tagsRepo } from './db/repos/tags.js';
import { scheduleBackupJob } from './services/backup.js';
import { pruneMutationAudit } from './services/world.js';

/** Trash retention (F107): notes trashed longer than this are purged on boot. */
export const TRASH_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Hard-deletes notes that have sat in the trash past the retention window. */
export function purgeExpiredTrash(db: Db, now: Date = new Date()): number {
  const cutoff = new Date(now.getTime() - TRASH_RETENTION_DAYS * DAY_MS).toISOString();
  return notesRepo(db).purgeTrashed({ olderThan: cutoff });
}

/** Boot-time maintenance: trash auto-purge, orphan tags, link integrity, attachment GC. */
export function runBootJobs(db: Db, dataDir: string, log: FastifyBaseLogger): void {
  const purgedNotes = purgeExpiredTrash(db);
  const orphanTags = tagsRepo(db).cleanupOrphans();
  // Link integrity (F219): rows orphaned by hard-deleted notes are swept here.
  const links = linksRepo(db).cleanupOrphans();
  const attachments = gcAttachments(db, dataDir);
  // Mutation-audit retention (F690): drop world-mutation rows past 90 days.
  const prunedMutations = pruneMutationAudit(db);
  log.info(
    { purgedNotes, orphanTags, links, attachments, prunedMutations },
    'boot maintenance complete',
  );

  // Schedule nightly backup job (F951). First run 5 minutes after boot.
  scheduleBackupJob(db, dataDir, log);
}
