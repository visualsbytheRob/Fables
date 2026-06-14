/**
 * Compliance feature tests (F1290).
 *
 * Covers:
 *   F1282 — data inventory export
 *   F1286 — legal hold mode (flag persistence + trash/purge guard)
 *   F1287 — redaction tool (live row + revision history)
 *   F1288 — export-with-redactions (GET /compliance/export)
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import { buildInventory } from './inventory.js';
import { legalHoldRepo } from './legal-hold.js';
import { redactNote, REDACTED_SENTINEL } from './redaction.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

// ── Unit tests: inventory ─────────────────────────────────────────────────────

describe('buildInventory (F1282)', () => {
  it('returns schemaVersion 1 and generatedAt ISO string', () => {
    const db = freshDb();
    const inv = buildInventory(db);
    expect(inv.schemaVersion).toBe(1);
    expect(() => new Date(inv.generatedAt)).not.toThrow();
  });

  it('counts zero notes on an empty db', () => {
    const db = freshDb();
    const inv = buildInventory(db);
    expect(inv.counts.notes).toBe(0);
    expect(inv.counts.notesLive).toBe(0);
    expect(inv.counts.notesTrashed).toBe(0);
  });

  it('counts live vs trashed notes correctly', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    const repo = notesRepo(db);
    repo.create({ notebookId: nb.id, title: 'live' });
    const doomed = repo.create({ notebookId: nb.id, title: 'doomed' });
    repo.trash(doomed.id);

    const inv = buildInventory(db);
    expect(inv.counts.notes).toBe(2);
    expect(inv.counts.notesLive).toBe(1);
    expect(inv.counts.notesTrashed).toBe(1);
    expect(inv.counts.notebooks).toBe(1);
  });

  it('reflects vault not configured on fresh db', () => {
    const db = freshDb();
    const inv = buildInventory(db);
    expect(inv.vault.configured).toBe(false);
  });

  it('reflects legal hold status in inventory', () => {
    const db = freshDb();
    legalHoldRepo(db).set(true);
    const inv = buildInventory(db);
    expect(inv.legalHold).toBe(true);
  });

  it('counts audit log entries', () => {
    const db = freshDb();
    // audit log starts at 0 on fresh db
    const inv = buildInventory(db);
    expect(inv.counts.auditLogEntries).toBe(0);
  });
});

// ── Unit tests: legal hold ────────────────────────────────────────────────────

describe('legalHoldRepo (F1286)', () => {
  it('defaults to inactive on fresh db', () => {
    const db = freshDb();
    const status = legalHoldRepo(db).get();
    expect(status.active).toBe(false);
  });

  it('can be enabled and persists', () => {
    const db = freshDb();
    const repo = legalHoldRepo(db);
    repo.set(true);
    expect(repo.get().active).toBe(true);
    expect(repo.get().updatedAt).toBeTruthy();
  });

  it('can be toggled off again', () => {
    const db = freshDb();
    const repo = legalHoldRepo(db);
    repo.set(true);
    repo.set(false);
    expect(repo.get().active).toBe(false);
  });

  it('assertNotHeld throws when active', () => {
    const db = freshDb();
    const repo = legalHoldRepo(db);
    repo.set(true);
    expect(() => repo.assertNotHeld()).toThrow(/legal hold/i);
  });

  it('assertNotHeld passes when inactive', () => {
    const db = freshDb();
    expect(() => legalHoldRepo(db).assertNotHeld()).not.toThrow();
  });
});

// ── Unit tests: redaction ─────────────────────────────────────────────────────

describe('redactNote (F1287)', () => {
  it('replaces title and body in the live row with sentinel', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    const note = notesRepo(db).create({
      notebookId: nb.id,
      title: 'secret title',
      body: 'secret body',
    });

    redactNote(db, note.id);

    const after = notesRepo(db).get(note.id);
    expect(after).not.toBeNull();
    expect(after!.title).toBe(REDACTED_SENTINEL);
    expect(after!.body).toBe(REDACTED_SENTINEL);
  });

  it('increments the note revision after redaction', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    const note = notesRepo(db).create({ notebookId: nb.id, title: 'v0', body: 'content' });
    const revBefore = note.rev;

    redactNote(db, note.id);
    const after = notesRepo(db).get(note.id);
    expect(after!.rev).toBeGreaterThan(revBefore);
  });

  it('redacts revision history (replaces title and body in note_revisions)', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    const note = notesRepo(db).create({
      notebookId: nb.id,
      title: 'private',
      body: 'private body',
    });
    // Manually insert a revision snapshot
    db.prepare(
      `INSERT INTO note_revisions (note_id, rev, title, body, word_count, char_count, content_hash, created_at)
       VALUES (?, ?, ?, ?, 2, 12, 'abc123', datetime('now'))`,
    ).run(note.id, 0, 'private', 'private body');

    const result = redactNote(db, note.id);
    expect(result.revisionsRedacted).toBe(1);

    const revRows = db
      .prepare('SELECT title, body FROM note_revisions WHERE note_id = ?')
      .all(note.id) as { title: string; body: string }[];
    for (const row of revRows) {
      expect(row.title).toBe(REDACTED_SENTINEL);
      expect(row.body).toBe(REDACTED_SENTINEL);
    }
  });

  it('can redact only specific fields', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    const note = notesRepo(db).create({
      notebookId: nb.id,
      title: 'keep this',
      body: 'redact this',
    });

    redactNote(db, note.id, { fields: ['body'] });
    const after = notesRepo(db).get(note.id);
    expect(after!.body).toBe(REDACTED_SENTINEL);
    expect(after!.title).toBe('keep this');
  });

  it('throws NOT_FOUND for a nonexistent note', () => {
    const db = freshDb();
    expect(() => redactNote(db, 'note_notexist' as never)).toThrow();
  });

  it('records the redaction in the audit log', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    const note = notesRepo(db).create({ notebookId: nb.id, title: 't', body: 'b' });
    const result = redactNote(db, note.id, { reason: 'GDPR erasure' });

    expect(result.auditSeq).toBeGreaterThan(0);
    const row = db
      .prepare('SELECT event, detail FROM security_audit WHERE seq = ?')
      .get(result.auditSeq) as { event: string; detail: string } | undefined;
    expect(row).toBeTruthy();
    const detail = JSON.parse(row!.detail) as Record<string, unknown>;
    expect(detail.action).toBe('redaction');
    expect(detail.noteId).toBe(note.id);
    expect(detail.reason).toBe('GDPR erasure');
  });
});

// ── HTTP integration tests ────────────────────────────────────────────────────

describe('compliance HTTP routes', () => {
  let app: FastifyInstance;
  let notebookId: string;

  beforeAll(async () => {
    app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notebooks',
      payload: { name: 'ComplianceLab' },
    });
    notebookId = (res.json() as { data: { id: string } }).data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // Reset legal hold before each test so tests don't leak into each other
  beforeEach(async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/compliance/legal-hold',
      payload: { active: false },
    });
  });

  // ── F1282: inventory ──────────────────────────────────────────────────────

  describe('GET /compliance/inventory (F1282)', () => {
    it('returns 200 with schemaVersion 1', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/compliance/inventory' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        data: { schemaVersion: number; counts: Record<string, number> };
      };
      expect(body.data.schemaVersion).toBe(1);
      expect(typeof body.data.counts.notes).toBe('number');
    });

    it('reflects a created note in the counts', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/notes',
        payload: { notebookId, title: 'counted note' },
      });
      const res = await app.inject({ method: 'GET', url: '/api/v1/compliance/inventory' });
      const body = res.json() as { data: { counts: { notes: number; notesLive: number } } };
      expect(body.data.counts.notes).toBeGreaterThanOrEqual(1);
      expect(body.data.counts.notesLive).toBeGreaterThanOrEqual(1);
    });
  });

  // ── F1286: legal hold ─────────────────────────────────────────────────────

  describe('GET /compliance/legal-hold (F1286)', () => {
    it('returns 200 with active:false by default', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/compliance/legal-hold' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { active: boolean } };
      expect(body.data.active).toBe(false);
    });
  });

  describe('POST /compliance/legal-hold (F1286)', () => {
    it('can enable legal hold', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/compliance/legal-hold',
        payload: { active: true },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { active: boolean } };
      expect(body.data.active).toBe(true);
    });

    it('rejects invalid payloads', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/compliance/legal-hold',
        payload: { active: 'yes' },
      });
      expect(res.statusCode).toBe(422);
    });

    it('blocks POST /trash/empty when legal hold is active', async () => {
      // Create a note and trash it
      const noteRes = await app.inject({
        method: 'POST',
        url: '/api/v1/notes',
        payload: { notebookId, title: 'hold-test' },
      });
      const noteId = (noteRes.json() as { data: { id: string } }).data.id;
      await app.inject({ method: 'DELETE', url: `/api/v1/notes/${noteId}` });

      // Enable legal hold
      await app.inject({
        method: 'POST',
        url: '/api/v1/compliance/legal-hold',
        payload: { active: true },
      });

      // Try to empty trash
      const purgeRes = await app.inject({ method: 'POST', url: '/api/v1/trash/empty' });
      expect(purgeRes.statusCode).toBe(403);
      const body = purgeRes.json() as { error: { code: string; details: { legalHold: boolean } } };
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.details.legalHold).toBe(true);
    });

    it('allows POST /trash/empty when legal hold is inactive', async () => {
      // Ensure hold is off (done in beforeEach, but confirm)
      const purgeRes = await app.inject({ method: 'POST', url: '/api/v1/trash/empty' });
      expect(purgeRes.statusCode).toBe(200);
    });
  });

  // ── F1287: redaction ──────────────────────────────────────────────────────

  describe('POST /notes/:id/redact (F1287)', () => {
    it('redacts a note and returns result', async () => {
      const noteRes = await app.inject({
        method: 'POST',
        url: '/api/v1/notes',
        payload: { notebookId, title: 'sensitive title', body: 'sensitive body' },
      });
      const noteId = (noteRes.json() as { data: { id: string } }).data.id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/notes/${noteId}/redact`,
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        data: { noteId: string; revisionsRedacted: number; auditSeq: number };
      };
      expect(body.data.noteId).toBe(noteId);
      expect(typeof body.data.auditSeq).toBe('number');
    });

    it('returns 404 for a nonexistent note', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/notes/note_notexists/redact',
        payload: {},
      });
      expect(res.statusCode).toBe(404);
    });

    it('can redact only body field', async () => {
      const noteRes = await app.inject({
        method: 'POST',
        url: '/api/v1/notes',
        payload: { notebookId, title: 'keep me', body: 'erase me' },
      });
      const noteId = (noteRes.json() as { data: { id: string } }).data.id;

      await app.inject({
        method: 'POST',
        url: `/api/v1/notes/${noteId}/redact`,
        payload: { fields: ['body'] },
      });

      const noteAfter = await app.inject({ method: 'GET', url: `/api/v1/notes/${noteId}` });
      const note = (noteAfter.json() as { data: { title: string; body: string } }).data;
      expect(note.body).toBe('[REDACTED]');
      expect(note.title).toBe('keep me');
    });
  });

  // ── F1288: export-with-redactions ─────────────────────────────────────────

  describe('GET /compliance/export (F1288)', () => {
    it('returns a JSON attachment with content-disposition header', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/compliance/export' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.headers['content-disposition']).toMatch(
        /attachment; filename="fables-compliance-export-/,
      );
    });

    it('export body is valid JSON with schemaVersion 1', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/compliance/export' });
      const parsed = JSON.parse(res.body) as { schemaVersion: number };
      expect(parsed.schemaVersion).toBe(1);
    });

    it('export legalHold field matches current hold status', async () => {
      // Enable legal hold
      await app.inject({
        method: 'POST',
        url: '/api/v1/compliance/legal-hold',
        payload: { active: true },
      });
      const res = await app.inject({ method: 'GET', url: '/api/v1/compliance/export' });
      const parsed = JSON.parse(res.body) as { legalHold: boolean };
      expect(parsed.legalHold).toBe(true);
    });
  });
});
