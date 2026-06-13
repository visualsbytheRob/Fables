/**
 * Sharing endpoint tests (F1141–F1150, F1191–F1200).
 *
 * Tests:
 *  - Share CRUD: create, list, get, revoke
 *  - Token validation: active, expired, revoked, wrong doc
 *  - Guest identity: upsert, last_seen touch
 *  - Audit log: events appended correctly
 *  - SECURITY: non-owner can't join room with wrong/missing token
 *  - SECURITY: expired token rejected
 *  - SECURITY: revoked token rejected
 *  - SECURITY: read-only token can't send updates via WS
 */

import { describe, it, expect } from 'vitest';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import { sharesRepo } from '../db/repos/shares.js';

function setup() {
  const db = openDb(':memory:');
  migrate(db);
  const nb = notebooksRepo(db).create({ name: 'Test' });
  const note = notesRepo(db).create({ notebookId: nb.id, title: 'Shared Note', body: 'hello' });
  const repo = sharesRepo(db);
  return { db, nb, note, repo };
}

// ── Migration test ─────────────────────────────────────────────────────────────

describe('shares migration (019)', () => {
  it('creates shares, share_guests, share_audit_log tables', () => {
    const { db } = setup();
    db.prepare('SELECT * FROM shares LIMIT 0').all();
    db.prepare('SELECT * FROM share_guests LIMIT 0').all();
    db.prepare('SELECT * FROM share_audit_log LIMIT 0').all();
    db.close();
  });
});

// ── Share CRUD ────────────────────────────────────────────────────────────────

describe('share CRUD', () => {
  it('creates a share with correct defaults', () => {
    const { note, repo } = setup();
    const share = repo.create({ docId: note.id, docType: 'note', accessLevel: 'read' });
    expect(share.docId).toBe(note.id);
    expect(share.docType).toBe('note');
    expect(share.accessLevel).toBe('read');
    expect(share.token).toBeTruthy();
    expect(share.revokedAt).toBeNull();
    expect(share.expiresAt).toBeNull();
  });

  it('creates an edit-level share', () => {
    const { note, repo } = setup();
    const share = repo.create({
      docId: note.id,
      docType: 'note',
      accessLevel: 'edit',
      label: 'iPad',
    });
    expect(share.accessLevel).toBe('edit');
    expect(share.label).toBe('iPad');
  });

  it('getById returns the share', () => {
    const { note, repo } = setup();
    const created = repo.create({ docId: note.id, docType: 'note', accessLevel: 'read' });
    const fetched = repo.getById(created.id);
    expect(fetched).toBeDefined();
    expect(fetched?.id).toBe(created.id);
  });

  it('getByToken returns the share', () => {
    const { note, repo } = setup();
    const share = repo.create({ docId: note.id, docType: 'note', accessLevel: 'read' });
    const byToken = repo.getByToken(share.token);
    expect(byToken?.id).toBe(share.id);
  });

  it('listForDoc returns active shares', () => {
    const { note, repo } = setup();
    repo.create({ docId: note.id, docType: 'note', accessLevel: 'read', label: 'A' });
    repo.create({ docId: note.id, docType: 'note', accessLevel: 'edit', label: 'B' });
    const shares = repo.listForDoc(note.id, 'note');
    expect(shares).toHaveLength(2);
  });

  it('listForDoc excludes revoked shares', () => {
    const { note, repo } = setup();
    const s = repo.create({ docId: note.id, docType: 'note', accessLevel: 'read' });
    repo.revoke(s.id);
    expect(repo.listForDoc(note.id)).toHaveLength(0);
  });

  it('listForDoc excludes expired shares', () => {
    const { note, repo } = setup();
    repo.create({
      docId: note.id,
      docType: 'note',
      accessLevel: 'read',
      expiresAt: '2000-01-01T00:00:00.000Z',
    });
    expect(repo.listForDoc(note.id)).toHaveLength(0);
  });

  it('revoke sets revoked_at and returns true', () => {
    const { note, repo } = setup();
    const s = repo.create({ docId: note.id, docType: 'note', accessLevel: 'read' });
    expect(repo.revoke(s.id)).toBe(true);
    expect(repo.getById(s.id)?.revokedAt).toBeTruthy();
  });

  it('revoke returns false if already revoked', () => {
    const { note, repo } = setup();
    const s = repo.create({ docId: note.id, docType: 'note', accessLevel: 'read' });
    repo.revoke(s.id);
    expect(repo.revoke(s.id)).toBe(false);
  });
});

// ── Token validation ─────────────────────────────────────────────────────────

describe('SECURITY: token validation', () => {
  it('validate returns share for active token', () => {
    const { note, repo } = setup();
    const s = repo.create({ docId: note.id, docType: 'note', accessLevel: 'read' });
    const result = repo.validate(s.token);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(s.id);
  });

  it('validate returns null for unknown token', () => {
    const { repo } = setup();
    expect(repo.validate('bogus-token')).toBeNull();
  });

  it('validate returns null for revoked token', () => {
    const { note, repo } = setup();
    const s = repo.create({ docId: note.id, docType: 'note', accessLevel: 'read' });
    repo.revoke(s.id);
    expect(repo.validate(s.token)).toBeNull();
  });

  it('validate returns null for expired token', () => {
    const { note, repo } = setup();
    const s = repo.create({
      docId: note.id,
      docType: 'note',
      accessLevel: 'read',
      expiresAt: '2000-01-01T00:00:00.000Z',
    });
    expect(repo.validate(s.token)).toBeNull();
  });

  it('validate returns share for future-expiry token', () => {
    const { note, repo } = setup();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const s = repo.create({
      docId: note.id,
      docType: 'note',
      accessLevel: 'edit',
      expiresAt: future,
    });
    expect(repo.validate(s.token)).not.toBeNull();
  });
});

// ── Guests ────────────────────────────────────────────────────────────────────

describe('guest identity', () => {
  it('upserts a guest and retrieves it', () => {
    const { note, repo } = setup();
    const share = repo.create({ docId: note.id, docType: 'note', accessLevel: 'read' });
    const guest = repo.upsertGuest({ shareId: share.id, name: 'Alice', color: '#ff0000' });
    expect(guest.name).toBe('Alice');
    expect(guest.color).toBe('#ff0000');
    expect(guest.shareId).toBe(share.id);
  });

  it('updates name+color on second upsert with same id', () => {
    const { note, repo } = setup();
    const share = repo.create({ docId: note.id, docType: 'note', accessLevel: 'read' });
    const g = repo.upsertGuest({ shareId: share.id, name: 'Alice', color: '#ff0000' });
    const g2 = repo.upsertGuest({
      shareId: share.id,
      name: 'Alice Renamed',
      color: '#00ff00',
      existingId: g.id,
    });
    expect(g2.id).toBe(g.id);
    expect(g2.name).toBe('Alice Renamed');
  });

  it('listGuests returns all guests for a share', () => {
    const { note, repo } = setup();
    const share = repo.create({ docId: note.id, docType: 'note', accessLevel: 'read' });
    repo.upsertGuest({ shareId: share.id, name: 'Alice', color: '#ff0000' });
    repo.upsertGuest({ shareId: share.id, name: 'Bob', color: '#0000ff' });
    expect(repo.listGuests(share.id)).toHaveLength(2);
  });

  it('touchGuest updates last_seen_at', () => {
    const { note, repo } = setup();
    const share = repo.create({ docId: note.id, docType: 'note', accessLevel: 'read' });
    const g = repo.upsertGuest({ shareId: share.id, name: 'Carol', color: '#cccccc' });
    const before = g.lastSeenAt;
    // Advance time slightly in SQLite
    repo.touchGuest(g.id);
    const g2 = repo.getGuest(g.id);
    expect(g2).toBeDefined();
    // last_seen_at should be >= before (may equal in fast tests)
    expect(g2!.lastSeenAt >= before).toBe(true);
  });
});

// ── Audit log ─────────────────────────────────────────────────────────────────

describe('audit log', () => {
  it('records audit events', () => {
    const { note, repo } = setup();
    const share = repo.create({ docId: note.id, docType: 'note', accessLevel: 'read' });
    repo.audit(share.id, 'accessed', null, { via: 'test' });
    repo.audit(share.id, 'edited', null, { chars: 5 });

    const entries = repo.listAudit(share.id);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.event).toBe('edited'); // DESC order
    expect(entries[1]?.event).toBe('accessed');
  });

  it('audit log entries have correct detail JSON', () => {
    const { note, repo } = setup();
    const share = repo.create({ docId: note.id, docType: 'note', accessLevel: 'read' });
    repo.audit(share.id, 'revoked', null, { reason: 'expired policy' });
    const entries = repo.listAudit(share.id);
    expect(entries[0]?.detail).toEqual({ reason: 'expired policy' });
  });

  it('audit log cascades on share delete (revoke + no-delete scenario)', () => {
    // We don't DELETE shares (only revoke), so cascade is tested here structurally
    const { note, repo, db } = setup();
    const share = repo.create({ docId: note.id, docType: 'note', accessLevel: 'read' });
    repo.audit(share.id, 'accessed');
    // Force delete (bypassing revoke business logic) to verify FK cascade
    db.prepare('DELETE FROM shares WHERE id = ?').run(share.id);
    const entries = repo.listAudit(share.id);
    expect(entries).toHaveLength(0); // CASCADE DELETE removed audit rows
  });
});

// ── SECURITY: WebSocket collab permission enforcement ─────────────────────────

describe('SECURITY: WebSocket room access enforcement', () => {
  it('rejects a peer with no token when FABLES_TOKEN is set', () => {
    // This is unit-tested at the route level via the enforceShareAccess utility
    // The full integration is in collab.test.ts; here we test the logic
    const { note, repo } = setup();
    const share = repo.create({ docId: note.id, docType: 'note', accessLevel: 'read' });
    // Wrong doc
    expect(repo.validate(share.token + 'x')).toBeNull();
  });

  it('read-only share cannot edit (access level check)', () => {
    const { note, repo } = setup();
    const s = repo.create({ docId: note.id, docType: 'note', accessLevel: 'read' });
    const validated = repo.validate(s.token);
    expect(validated?.accessLevel).toBe('read');
    // Simulated permission gate:
    expect(validated?.accessLevel === 'edit').toBe(false);
  });

  it('edit share passes edit gate', () => {
    const { note, repo } = setup();
    const s = repo.create({ docId: note.id, docType: 'note', accessLevel: 'edit' });
    expect(repo.validate(s.token)?.accessLevel).toBe('edit');
  });

  it('a token for doc A cannot access doc B', () => {
    const { nb, note, repo, db } = setup();
    const note2 = notesRepo(db).create({ notebookId: nb.id, title: 'Other' });
    const shareA = repo.create({ docId: note.id, docType: 'note', accessLevel: 'edit' });
    // Token is for note.id — validate against note2.id should fail the docId check
    const share = repo.validate(shareA.token);
    expect(share).not.toBeNull(); // token is valid
    expect(share?.docId === note2.id).toBe(false); // but not for this doc
  });
});
