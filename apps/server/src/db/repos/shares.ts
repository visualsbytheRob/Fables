/**
 * Shares repository (F1141–F1150).
 *
 * Manages per-doc scoped share tokens, guests, and audit log.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../connection.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DocType = 'note' | 'notebook' | 'story';
export type AccessLevel = 'read' | 'edit';
export type AuditEvent = 'accessed' | 'edited' | 'revoked' | 'expired' | 'joined';

export interface Share {
  id: string;
  docId: string;
  docType: DocType;
  accessLevel: AccessLevel;
  token: string;
  label: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShareGuest {
  id: string;
  shareId: string;
  name: string;
  color: string;
  lastSeenAt: string;
  createdAt: string;
}

export interface ShareAuditEntry {
  id: number;
  shareId: string;
  event: AuditEvent;
  guestId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

// ── Row mappers ───────────────────────────────────────────────────────────────

interface ShareRow {
  id: string;
  doc_id: string;
  doc_type: string;
  access_level: string;
  token: string;
  label: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function toShare(row: ShareRow): Share {
  return {
    id: row.id,
    docId: row.doc_id,
    docType: row.doc_type as DocType,
    accessLevel: row.access_level as AccessLevel,
    token: row.token,
    label: row.label,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface GuestRow {
  id: string;
  share_id: string;
  name: string;
  color: string;
  last_seen_at: string;
  created_at: string;
}

function toGuest(row: GuestRow): ShareGuest {
  return {
    id: row.id,
    shareId: row.share_id,
    name: row.name,
    color: row.color,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  };
}

interface AuditRow {
  id: number;
  share_id: string;
  event: string;
  guest_id: string | null;
  detail: string;
  created_at: string;
}

function toAuditEntry(row: AuditRow): ShareAuditEntry {
  return {
    id: row.id,
    shareId: row.share_id,
    event: row.event as AuditEvent,
    guestId: row.guest_id,
    detail: JSON.parse(row.detail) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

// ── Token generation ──────────────────────────────────────────────────────────

/** Generate a cryptographically-random URL-safe token. */
function generateShareToken(): string {
  return randomBytes(24).toString('base64url');
}

// ── Repository ────────────────────────────────────────────────────────────────

export function sharesRepo(db: Db) {
  return {
    /**
     * Create a new share link for a document.
     */
    create(input: {
      docId: string;
      docType: DocType;
      accessLevel: AccessLevel;
      label?: string;
      expiresAt?: string | null;
      createdBy?: string;
    }): Share {
      const id = crypto.randomUUID();
      const token = generateShareToken();
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO shares (id, doc_id, doc_type, access_level, token, label, expires_at, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.docId,
        input.docType,
        input.accessLevel,
        token,
        input.label ?? '',
        input.expiresAt ?? null,
        input.createdBy ?? '',
        now,
        now,
      );

      return this.getById(id)!;
    },

    /** Get share by primary key. */
    getById(id: string): Share | null {
      const row = db.prepare('SELECT * FROM shares WHERE id = ?').get(id) as ShareRow | undefined;
      return row ? toShare(row) : null;
    },

    /** Get share by token (used for validation on incoming requests). */
    getByToken(token: string): Share | null {
      const row = db.prepare('SELECT * FROM shares WHERE token = ?').get(token) as
        | ShareRow
        | undefined;
      return row ? toShare(row) : null;
    },

    /** List all active (not revoked, not expired) shares for a document. */
    listForDoc(docId: string, docType?: DocType): Share[] {
      const now = new Date().toISOString();
      if (docType) {
        return (
          db
            .prepare(
              `SELECT * FROM shares
               WHERE doc_id = ? AND doc_type = ?
                 AND revoked_at IS NULL
                 AND (expires_at IS NULL OR expires_at > ?)
               ORDER BY created_at DESC`,
            )
            .all(docId, docType, now) as ShareRow[]
        ).map(toShare);
      }
      return (
        db
          .prepare(
            `SELECT * FROM shares
             WHERE doc_id = ?
               AND revoked_at IS NULL
               AND (expires_at IS NULL OR expires_at > ?)
             ORDER BY created_at DESC`,
          )
          .all(docId, now) as ShareRow[]
      ).map(toShare);
    },

    /** List ALL shares (including revoked/expired) for admin view. */
    listAll(limit = 200): Share[] {
      return (
        db.prepare('SELECT * FROM shares ORDER BY created_at DESC LIMIT ?').all(limit) as ShareRow[]
      ).map(toShare);
    },

    /**
     * Revoke a share — sets revoked_at to NOW.
     * Returns true if found and revoked, false if not found.
     */
    revoke(id: string): boolean {
      const now = new Date().toISOString();
      const result = db
        .prepare(
          `UPDATE shares SET revoked_at = ?, updated_at = ?
           WHERE id = ? AND revoked_at IS NULL`,
        )
        .run(now, now, id);
      return result.changes > 0;
    },

    /**
     * Validate a token: returns the share if it's active, non-revoked, and
     * non-expired. Returns null otherwise.
     */
    validate(token: string): Share | null {
      const share = this.getByToken(token);
      if (!share) return null;
      if (share.revokedAt) return null;
      if (share.expiresAt && share.expiresAt <= new Date().toISOString()) return null;
      return share;
    },

    // ── Guests ─────────────────────────────────────────────────────────────────

    /** Register or update a guest for a share link. */
    upsertGuest(input: {
      shareId: string;
      name: string;
      color: string;
      existingId?: string;
    }): ShareGuest {
      const now = new Date().toISOString();
      const id = input.existingId ?? crypto.randomUUID();
      db.prepare(
        `INSERT INTO share_guests (id, share_id, name, color, last_seen_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           name = excluded.name,
           color = excluded.color,
           last_seen_at = excluded.last_seen_at`,
      ).run(id, input.shareId, input.name, input.color, now, now);
      return this.getGuest(id)!;
    },

    getGuest(id: string): ShareGuest | null {
      const row = db.prepare('SELECT * FROM share_guests WHERE id = ?').get(id) as
        | GuestRow
        | undefined;
      return row ? toGuest(row) : null;
    },

    listGuests(shareId: string): ShareGuest[] {
      return (
        db
          .prepare('SELECT * FROM share_guests WHERE share_id = ? ORDER BY last_seen_at DESC')
          .all(shareId) as GuestRow[]
      ).map(toGuest);
    },

    touchGuest(guestId: string): void {
      const now = new Date().toISOString();
      db.prepare('UPDATE share_guests SET last_seen_at = ? WHERE id = ?').run(now, guestId);
    },

    // ── Audit log ──────────────────────────────────────────────────────────────

    audit(
      shareId: string,
      event: AuditEvent,
      guestId?: string | null,
      detail?: Record<string, unknown>,
    ): void {
      db.prepare(
        `INSERT INTO share_audit_log (share_id, event, guest_id, detail)
         VALUES (?, ?, ?, ?)`,
      ).run(shareId, event, guestId ?? null, JSON.stringify(detail ?? {}));
    },

    listAudit(shareId: string, limit = 100): ShareAuditEntry[] {
      return (
        db
          .prepare(
            `SELECT * FROM share_audit_log
             WHERE share_id = ?
             ORDER BY created_at DESC LIMIT ?`,
          )
          .all(shareId, limit) as AuditRow[]
      ).map(toAuditEntry);
    },

    /** Hash a token for safe comparison (same approach as security.ts). */
    hashToken(token: string): string {
      return createHash('sha256').update(token).digest('hex');
    },
  };
}
