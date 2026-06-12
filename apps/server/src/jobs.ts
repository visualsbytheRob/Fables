import type { FastifyBaseLogger } from 'fastify';
import { gcAttachments } from './attachments/store.js';
import type { Db } from './db/connection.js';
import { notesRepo } from './db/repos/notes.js';
import { tagsRepo } from './db/repos/tags.js';

/** Trash retention (F107): notes trashed longer than this are purged on boot. */
export const TRASH_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Hard-deletes notes that have sat in the trash past the retention window. */
export function purgeExpiredTrash(db: Db, now: Date = new Date()): number {
  const cutoff = new Date(now.getTime() - TRASH_RETENTION_DAYS * DAY_MS).toISOString();
  return notesRepo(db).purgeTrashed({ olderThan: cutoff });
}

/** Boot-time maintenance: trash auto-purge, orphan tag cleanup, attachment GC. */
export function runBootJobs(db: Db, dataDir: string, log: FastifyBaseLogger): void {
  const purgedNotes = purgeExpiredTrash(db);
  const orphanTags = tagsRepo(db).cleanupOrphans();
  const attachments = gcAttachments(db, dataDir);
  log.info({ purgedNotes, orphanTags, attachments }, 'boot maintenance complete');
}
