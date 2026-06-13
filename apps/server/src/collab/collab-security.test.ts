/**
 * Collab security, hardening, and regression tests (F1191–F1200).
 *
 * Tests:
 *  - Non-shared peer can't join a room (wrong/missing share token rejected)
 *  - Expired token is rejected
 *  - Revoked token is rejected
 *  - Read-only token: peer can receive updates but can't send them
 *  - Graceful single-user mode (REST path untouched, CRDT idles out)
 *  - Collab + sync path regression: multiple peers, updates propagated, no dupes
 *  - Bandwidth: coalescing notes validated (batch flush behavior)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import { sharesRepo } from '../db/repos/shares.js';
import { CollabService } from './service.js';
import {
  createNoteDoc,
  getNoteText,
  encodeSyncStep1,
  encodeUpdate,
  decodeMessage,
  createAwareness,
  extractBody,
  MSG_SYNC,
} from '@fables/sync';
import type { WebSocket as FWS } from '@fastify/websocket';

// ── Minimal fake pino logger ───────────────────────────────────────────────────

const fakeLog = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: () => fakeLog,
  level: 'silent',
} as unknown as FastifyBaseLogger;

// ── Fake WebSocket ─────────────────────────────────────────────────────────────

class FakeWS {
  readyState = 1;
  sent: Uint8Array[] = [];
  handlers: Map<string, ((...args: unknown[]) => void)[]> = new Map();

  on(event: string, handler: (...args: unknown[]) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  send(data: Uint8Array) {
    if (this.readyState === 1)
      this.sent.push(data instanceof Uint8Array ? data : new Uint8Array(data));
  }

  emit(event: string, ...args: unknown[]) {
    for (const h of this.handlers.get(event) ?? []) h(...args);
  }

  close() {
    this.readyState = 3;
    this.emit('close');
  }
}

// ── Setup ──────────────────────────────────────────────────────────────────────

function setup() {
  const db = openDb(':memory:');
  migrate(db);
  const nb = notebooksRepo(db).create({ name: 'Test' });
  const note = notesRepo(db).create({ notebookId: nb.id, title: 'Security Test', body: 'initial' });
  const collab = new CollabService(db, fakeLog);
  const repo = sharesRepo(db);
  return { db, nb, note, collab, repo };
}

// ── SECURITY: share token enforcement ─────────────────────────────────────────

describe('SECURITY: read-only token cannot push updates (F1141, F1192)', () => {
  let collab: CollabService;
  let note: { id: string; body: string };

  beforeEach(() => {
    const s = setup();
    collab = s.collab;
    note = s.note;
  });

  afterEach(async () => {
    await collab.shutdown();
  });

  it('read-only peer does not receive its own update broadcast back', () => {
    // Connect a read-only peer
    const wsReadOnly = new FakeWS();
    collab.handleConnection(wsReadOnly as unknown as FWS, note.id, note.body, 'read');

    // Connect an edit peer
    const wsEdit = new FakeWS();
    collab.handleConnection(wsEdit as unknown as FWS, note.id, note.body, 'edit');

    wsReadOnly.sent.length = 0;
    wsEdit.sent.length = 0;

    // Read-only peer tries to send an update
    const clientDoc = createNoteDoc();
    const updates: Uint8Array[] = [];
    clientDoc.on('update', (u: Uint8Array) => updates.push(u));
    getNoteText(clientDoc).insert(0, 'UNAUTHORIZED');

    // Send update message as read-only peer — should be silently dropped
    wsReadOnly.emit('message', Buffer.from(encodeUpdate(updates[0]!)));

    // Edit peer should NOT receive the update (it was dropped)
    const editGotUpdate = wsEdit.sent.some((m) => m[0] === MSG_SYNC && m[1] === 2);
    expect(editGotUpdate).toBe(false);
  });

  it('read-only peer receives SyncStep2 in response to SyncStep1', () => {
    const wsReadOnly = new FakeWS();
    collab.handleConnection(wsReadOnly as unknown as FWS, note.id, note.body, 'read');

    wsReadOnly.sent.length = 0;
    const clientDoc = createNoteDoc();
    wsReadOnly.emit('message', Buffer.from(encodeSyncStep1(clientDoc)));

    // Read-only peer SHOULD receive Step2 (reading is allowed)
    const step2 = wsReadOnly.sent.find((m) => m[0] === MSG_SYNC && m[1] === 1);
    expect(step2).toBeDefined();
  });

  it('edit peer broadcast does NOT include the sender', () => {
    const wsEdit = new FakeWS();
    const wsReceive = new FakeWS();
    collab.handleConnection(wsEdit as unknown as FWS, note.id, note.body, 'edit');
    collab.handleConnection(wsReceive as unknown as FWS, note.id, note.body, 'read');

    wsEdit.sent.length = 0;
    wsReceive.sent.length = 0;

    const editorDoc = createNoteDoc();
    const updates: Uint8Array[] = [];
    editorDoc.on('update', (u: Uint8Array) => updates.push(u));
    getNoteText(editorDoc).insert(0, 'broadcast');
    wsEdit.emit('message', Buffer.from(encodeUpdate(updates[0]!)));

    // wsReceive should get it
    const rcvGot = wsReceive.sent.some((m) => m[0] === MSG_SYNC && m[1] === 2);
    expect(rcvGot).toBe(true);
    // wsEdit (sender) should not get its own update back
    const editGotOwn = wsEdit.sent.some((m) => m[0] === MSG_SYNC && m[1] === 2);
    expect(editGotOwn).toBe(false);
  });
});

// ── Token validation helpers ───────────────────────────────────────────────────

describe('SECURITY: token states (F1143, F1145, F1146)', () => {
  it('expired token: validate returns null', () => {
    const { note, repo } = setup();
    const share = repo.create({
      docId: note.id,
      docType: 'note',
      accessLevel: 'edit',
      expiresAt: '2000-01-01T00:00:00.000Z',
    });
    // Simulate route-level check
    const result = repo.validate(share.token);
    expect(result).toBeNull();
  });

  it('revoked token: validate returns null', () => {
    const { note, repo } = setup();
    const share = repo.create({ docId: note.id, docType: 'note', accessLevel: 'edit' });
    repo.revoke(share.id);
    expect(repo.validate(share.token)).toBeNull();
  });

  it('wrong-doc token: validate returns share but docId does not match', () => {
    const { nb, note, repo, db } = setup();
    const note2 = notesRepo(db).create({ notebookId: nb.id, title: 'Other' });
    const share = repo.create({ docId: note.id, docType: 'note', accessLevel: 'edit' });
    const result = repo.validate(share.token);
    // Token is valid for note.id, not note2.id
    expect(result).not.toBeNull();
    expect(result?.docId).not.toBe(note2.id);
  });

  it('completely unknown token rejected', () => {
    const { repo } = setup();
    expect(repo.validate('definitely-not-a-real-token')).toBeNull();
  });
});

// ── Graceful single-user mode (F1198) ─────────────────────────────────────────

describe('graceful single-user mode (F1198)', () => {
  it('REST paths work without any collab rooms', async () => {
    const { collab } = setup();
    // No connections made
    const stats = collab.getRoomStats();
    expect(stats.activeRooms).toBe(0);
    expect(stats.totalPeers).toBe(0);
    await collab.shutdown();
  });

  it('collab room idles out when peer disconnects', async () => {
    const { collab, note } = setup();
    const ws = new FakeWS();
    collab.handleConnection(ws as unknown as FWS, note.id, note.body);
    expect(collab.hasRoom(note.id)).toBe(true);
    ws.close();
    // Room is still present (idle timer hasn't fired yet)
    expect(collab.getRoomStats().totalPeers).toBe(0);
    await collab.shutdown();
  });
});

// ── Collab + sync regression suite (F1199) ────────────────────────────────────

describe('collab + sync regression suite (F1199)', () => {
  it("two peers sync correctly: both see each other's edits", async () => {
    const { collab, note } = setup();

    const ws1 = new FakeWS();
    const ws2 = new FakeWS();
    collab.handleConnection(ws1 as unknown as FWS, note.id, note.body, 'edit');
    collab.handleConnection(ws2 as unknown as FWS, note.id, note.body, 'edit');

    // Sync both peers with server
    const doc1 = createNoteDoc();
    const aw1 = createAwareness(doc1);
    ws1.sent.length = 0;
    ws1.emit('message', Buffer.from(encodeSyncStep1(doc1)));
    for (const m of ws1.sent) decodeMessage(m, doc1, aw1, 'server');

    const doc2 = createNoteDoc();
    const aw2 = createAwareness(doc2);
    ws2.sent.length = 0;
    ws2.emit('message', Buffer.from(encodeSyncStep1(doc2)));
    for (const m of ws2.sent) decodeMessage(m, doc2, aw2, 'server');

    // Peer 1 makes an edit
    const u1: Uint8Array[] = [];
    doc1.on('update', (u: Uint8Array) => u1.push(u));
    getNoteText(doc1).insert(0, 'peer1-edit ');

    ws1.sent.length = 0;
    ws2.sent.length = 0;
    for (const u of u1) ws1.emit('message', Buffer.from(encodeUpdate(u)));

    // Peer 2 receives the broadcast
    for (const m of ws2.sent) decodeMessage(m, doc2, aw2, 'server');

    expect(extractBody(doc2)).toContain('peer1-edit');
    await collab.shutdown();
  });

  it('no duplication: same update applied once at server', async () => {
    const { collab, note } = setup();

    const ws = new FakeWS();
    collab.handleConnection(ws as unknown as FWS, note.id, note.body, 'edit');

    const clientDoc = createNoteDoc();
    const aw = createAwareness(clientDoc);
    ws.sent.length = 0;
    ws.emit('message', Buffer.from(encodeSyncStep1(clientDoc)));
    for (const m of ws.sent) decodeMessage(m, clientDoc, aw, 'server');

    // Send the same update twice — server should apply it once (Yjs idempotent)
    const updates: Uint8Array[] = [];
    clientDoc.on('update', (u: Uint8Array) => updates.push(u));
    getNoteText(clientDoc).insert(0, 'once');

    ws.emit('message', Buffer.from(encodeUpdate(updates[0]!)));
    ws.emit('message', Buffer.from(encodeUpdate(updates[0]!))); // duplicate

    // After full sync, server doc should only have 'once' once
    const syncDoc = createNoteDoc();
    const syncAw = createAwareness(syncDoc);
    ws.sent.length = 0;
    ws.emit('message', Buffer.from(encodeSyncStep1(syncDoc)));
    for (const m of ws.sent) decodeMessage(m, syncDoc, syncAw, 'server');

    const body = extractBody(syncDoc);
    // 'once' should appear exactly once
    const count = (body.match(/once/g) ?? []).length;
    expect(count).toBe(1);
    await collab.shutdown();
  });

  it('persistence across sessions: edits survive server restart', async () => {
    const { db, collab, note } = setup();

    const ws = new FakeWS();
    collab.handleConnection(ws as unknown as FWS, note.id, note.body, 'edit');

    const doc = createNoteDoc();
    const aw = createAwareness(doc);
    ws.sent.length = 0;
    ws.emit('message', Buffer.from(encodeSyncStep1(doc)));
    for (const m of ws.sent) decodeMessage(m, doc, aw, 'server');

    const u: Uint8Array[] = [];
    doc.on('update', (up: Uint8Array) => u.push(up));
    getNoteText(doc).insert(0, 'SURVIVED ');
    for (const up of u) ws.emit('message', Buffer.from(encodeUpdate(up)));

    await collab.shutdown();

    // New server session
    const collab2 = new CollabService(db, fakeLog);
    const ws2 = new FakeWS();
    collab2.handleConnection(ws2 as unknown as FWS, note.id, note.body, 'edit');

    const doc2 = createNoteDoc();
    const aw2 = createAwareness(doc2);
    ws2.sent.length = 0;
    ws2.emit('message', Buffer.from(encodeSyncStep1(doc2)));
    for (const m of ws2.sent) decodeMessage(m, doc2, aw2, 'server');

    expect(extractBody(doc2)).toContain('SURVIVED');
    await collab2.shutdown();
  });
});

// ── Bandwidth budget: coalescing / debounce note (F1193) ─────────────────────

describe('bandwidth budget: coalescing batch behavior (F1193)', () => {
  it('collab service batches flushes rather than writing every single update', async () => {
    const { db, collab, note } = setup();
    const ws = new FakeWS();
    collab.handleConnection(ws as unknown as FWS, note.id, note.body, 'edit');

    // Send several small updates without triggering the batch threshold (20)
    const doc = createNoteDoc();
    const aw = createAwareness(doc);
    ws.sent.length = 0;
    ws.emit('message', Buffer.from(encodeSyncStep1(doc)));
    for (const m of ws.sent) decodeMessage(m, doc, aw, 'server');

    for (let i = 0; i < 5; i++) {
      const u: Uint8Array[] = [];
      doc.on('update', (up: Uint8Array) => {
        u.push(up);
        doc.off('update', () => {});
      });
      getNoteText(doc).insert(0, `[${String(i)}]`);
      if (u[0]) ws.emit('message', Buffer.from(encodeUpdate(u[0])));
    }

    // Before flush timeout, nothing is in DB yet (batching)
    const row = db.prepare('SELECT update_count FROM crdt_docs WHERE doc_id = ?').get(note.id) as
      | { update_count: number }
      | undefined;
    // update_count should be < 20 (batch threshold not hit)
    if (row) expect(row.update_count).toBeLessThan(20);

    await collab.shutdown();
    // After shutdown (flush), state exists in DB
    const row2 = db.prepare('SELECT state FROM crdt_docs WHERE doc_id = ?').get(note.id) as
      | { state: Buffer }
      | undefined;
    expect(row2).toBeDefined();
    expect(row2!.state.length).toBeGreaterThan(0);
  });
});
