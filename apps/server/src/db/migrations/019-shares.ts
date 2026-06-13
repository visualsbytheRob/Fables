import type { Migration } from './index.js';

/**
 * Sharing, invites, and audit log (F1141–F1150).
 *
 * `shares`: per-doc scoped share tokens.
 *   - id: UUID share ID
 *   - doc_id: note/notebook/story being shared (text; not FK so it can be any resource type)
 *   - doc_type: 'note' | 'notebook' | 'story'
 *   - access_level: 'read' | 'edit'
 *   - token: cryptographically random token used in share URLs
 *   - label: human-readable label (e.g. device/user name)
 *   - expires_at: ISO timestamp or NULL (no expiry)
 *   - revoked_at: ISO timestamp or NULL (not revoked)
 *   - created_by: device/user identifier
 *   - created_at, updated_at
 *
 * `share_guests`: identity records for link visitors (name + color).
 *   - id: guest session UUID
 *   - share_id: FK → shares.id
 *   - name: display name
 *   - color: hex color for cursor/avatar
 *   - last_seen_at: ISO
 *   - created_at: ISO
 *
 * `share_audit_log`: access events (join, edit, revoke, expire).
 *   - id: INTEGER PK autoincrement
 *   - share_id: FK → shares.id ON DELETE CASCADE
 *   - event: 'accessed' | 'edited' | 'revoked' | 'expired'
 *   - guest_id: NULL for server-side events, share_guests.id for client events
 *   - detail: JSON blob
 *   - created_at: ISO
 */
export const migration019Shares: Migration = {
  id: 19,
  name: 'shares',
  sql: /* sql */ `
    CREATE TABLE shares (
      id           TEXT NOT NULL PRIMARY KEY,
      doc_id       TEXT NOT NULL,
      doc_type     TEXT NOT NULL DEFAULT 'note' CHECK (doc_type IN ('note', 'notebook', 'story')),
      access_level TEXT NOT NULL DEFAULT 'read' CHECK (access_level IN ('read', 'edit')),
      token        TEXT NOT NULL UNIQUE,
      label        TEXT NOT NULL DEFAULT '',
      expires_at   TEXT,
      revoked_at   TEXT,
      created_by   TEXT NOT NULL DEFAULT '',
      created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX idx_shares_doc ON shares (doc_id, doc_type);
    CREATE INDEX idx_shares_token ON shares (token);

    CREATE TABLE share_guests (
      id           TEXT NOT NULL PRIMARY KEY,
      share_id     TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
      name         TEXT NOT NULL DEFAULT 'Guest',
      color        TEXT NOT NULL DEFAULT '#6366f1',
      last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX idx_share_guests_share ON share_guests (share_id);

    CREATE TABLE share_audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      share_id   TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
      event      TEXT NOT NULL CHECK (event IN ('accessed', 'edited', 'revoked', 'expired', 'joined')),
      guest_id   TEXT,
      detail     TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX idx_share_audit_share ON share_audit_log (share_id, created_at);
  `,
};
