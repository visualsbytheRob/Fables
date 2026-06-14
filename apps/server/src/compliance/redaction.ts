/**
 * Redaction tool (F1287) and export-with-redactions (F1288).
 *
 * `redactNote` performs a true removal of content from both the live row and
 * ALL revision snapshots. Redacted fields are replaced with a sentinel string
 * that makes the erasure auditable. The operation is recorded in the security
 * audit log.
 *
 * This module intentionally does NOT touch the vault encryption layer — it
 * operates at the SQL level, writing the sentinel directly into whatever column
 * encoding is in place (plaintext or ciphertext). If the vault is locked and
 * data is encrypted, the caller must arrange for plaintext sentinels to be
 * encrypted before passing them; the default sentinel is plaintext.
 */

import { notFound } from '@fables/core';
import type { NoteId } from '@fables/core';
import type { Db } from '../db/connection.js';
import { auditLog, type AuditEvent } from '../vault/audit.js';

export const REDACTED_SENTINEL = '[REDACTED]';

export interface RedactionResult {
  noteId: NoteId;
  revisionsRedacted: number;
  redactedAt: string;
  auditSeq: number;
}

/**
 * Redacts the title and/or body of a note and all its revision history.
 *
 * @param fields - which fields to redact; defaults to both title and body.
 * @param reason - optional reason, recorded in the audit log.
 */
export function redactNote(
  db: Db,
  noteId: NoteId,
  opts: {
    fields?: ('title' | 'body')[];
    reason?: string;
    sentinel?: string;
  } = {},
): RedactionResult {
  const fields = opts.fields ?? ['title', 'body'];
  const sentinel = opts.sentinel ?? REDACTED_SENTINEL;
  const reason = opts.reason ?? 'compliance redaction';

  // Verify note exists
  const noteRow = db.prepare('SELECT id FROM notes WHERE id = ?').get(noteId) as
    | { id: string }
    | undefined;
  if (!noteRow) throw notFound('Note', noteId);

  const now = new Date().toISOString();

  // Build SET clause for the live notes row
  const liveSets: string[] = [];
  if (fields.includes('title')) liveSets.push('title = ?');
  if (fields.includes('body')) liveSets.push('body = ?');
  // Always bump the revision so clients can detect the change
  liveSets.push('updated_at = ?', 'rev = rev + 1');

  const liveArgs: unknown[] = [];
  for (const f of fields) {
    void f; // just filling with sentinel below
    liveArgs.push(sentinel);
  }
  liveArgs.push(now, noteId);

  db.prepare(`UPDATE notes SET ${liveSets.join(', ')} WHERE id = ?`).run(...liveArgs);

  // Build SET clause for note_revisions
  const revSets: string[] = [];
  if (fields.includes('title')) revSets.push('title = ?');
  if (fields.includes('body')) revSets.push('body = ?');

  let revisionsRedacted = 0;
  if (revSets.length > 0) {
    const revArgs: unknown[] = [];
    if (fields.includes('title')) revArgs.push(sentinel);
    if (fields.includes('body')) revArgs.push(sentinel);
    revArgs.push(noteId);
    revisionsRedacted = db
      .prepare(`UPDATE note_revisions SET ${revSets.join(', ')} WHERE note_id = ?`)
      .run(...revArgs).changes;
  }

  // Record in security audit log.
  // 'vault.wiped' is the closest canonical AuditEvent to a content erasure;
  // the detail payload identifies this as a field-level redaction.
  const REDACTION_EVENT: AuditEvent = 'vault.wiped';
  const entry = auditLog(db).append(REDACTION_EVENT, {
    action: 'redaction',
    noteId,
    fields,
    reason,
    revisionsRedacted,
    redactedAt: now,
  });

  return {
    noteId,
    revisionsRedacted,
    redactedAt: now,
    auditSeq: entry.seq,
  };
}
