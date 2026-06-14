/**
 * Data inventory export (F1282).
 *
 * Produces a machine-readable JSON snapshot of everything stored in the vault:
 * counts, vault status, and the audit-log length. Used for compliance audits,
 * GDPR data-subject requests, and internal reporting.
 */

import type { Db } from '../db/connection.js';
import { auditLog } from '../vault/audit.js';

export interface DataInventory {
  generatedAt: string;
  schemaVersion: 1;
  counts: {
    notes: number;
    notesLive: number;
    notesTrashed: number;
    notebooks: number;
    stories: number;
    attachments: number;
    tags: number;
    tagLinks: number;
    shares: number;
    sharesActive: number;
    noteRevisions: number;
    auditLogEntries: number;
  };
  vault: {
    configured: boolean;
    /** Reflects the in-DB vault row existence — does not expose key material. */
  };
  legalHold: boolean;
}

function count(db: Db, sql: string, ...args: unknown[]): number {
  const row = db.prepare(sql).get(...args) as { n: number } | undefined;
  return row?.n ?? 0;
}

export function buildInventory(db: Db): DataInventory {
  const notesTotal = count(db, 'SELECT COUNT(*) AS n FROM notes');
  const notesLive = count(db, 'SELECT COUNT(*) AS n FROM notes WHERE trashed_at IS NULL');
  const notesTrashed = notesTotal - notesLive;
  const notebooks = count(db, 'SELECT COUNT(*) AS n FROM notebooks');
  const stories = count(db, 'SELECT COUNT(*) AS n FROM stories');
  const attachments = count(db, 'SELECT COUNT(*) AS n FROM attachments');
  const tags = count(db, 'SELECT COUNT(*) AS n FROM tags');
  const tagLinks = count(db, 'SELECT COUNT(*) AS n FROM note_tags');
  const shares = count(db, 'SELECT COUNT(*) AS n FROM shares');
  const sharesActive = count(
    db,
    `SELECT COUNT(*) AS n FROM shares WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > datetime('now'))`,
  );
  const noteRevisions = count(db, 'SELECT COUNT(*) AS n FROM note_revisions');
  const auditEntries = auditLog(db).count();
  const vaultConfigured =
    (db.prepare('SELECT 1 FROM vault WHERE id = 1').get() as unknown) !== undefined;

  const legalHoldRow = db
    .prepare(`SELECT value FROM compliance_settings WHERE key = 'legal_hold'`)
    .get() as { value: string } | undefined;
  const legalHold = legalHoldRow?.value === 'true';

  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    counts: {
      notes: notesTotal,
      notesLive,
      notesTrashed,
      notebooks,
      stories,
      attachments,
      tags,
      tagLinks,
      shares,
      sharesActive,
      noteRevisions,
      auditLogEntries: auditEntries,
    },
    vault: {
      configured: vaultConfigured,
    },
    legalHold,
  };
}
