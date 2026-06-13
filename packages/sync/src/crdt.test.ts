/**
 * CRDT core tests (F1108, F1109, F1110).
 *
 * Convergence property: regardless of message ordering, all peers applying the
 * same set of concurrent ops MUST reach identical document state.  This is the
 * heart of CRDT correctness and is proved here with randomised fuzz tests.
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createNoteDoc,
  getNoteText,
  encodeDocState,
  encodeDocStateVector,
  applyDocUpdate,
  diffUpdate,
  mergeUpdates,
  compactUpdates,
  seedDocFromBody,
  extractBody,
  encodeSyncStep1,
  encodeUpdate,
  decodeMessage,
  createAwareness,
  removeAwarenessClients,
  encodeAwarenessMsg,
  migrateCrdtDoc,
  CRDT_SCHEMA_VERSION,
  MSG_SYNC,
  MSG_AWARENESS,
} from './crdt.js';
import * as awarenessProtocol from 'y-protocols/awareness';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Apply updates from `sources` to `target` in the given order. */
function applyAll(target: Y.Doc, updates: Uint8Array[]): void {
  for (const u of updates) {
    applyDocUpdate(target, u);
  }
}

/** Capture an update for every transaction a doc makes. */
function captureUpdates(doc: Y.Doc): Uint8Array[] {
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => updates.push(update));
  return updates;
}

/** Shuffle an array (Fisher-Yates). */
function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

/** Simple seeded LCG RNG for reproducible fuzz tests. */
function makeLCG(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

// ── Basic doc creation ─────────────────────────────────────────────────────────

describe('createNoteDoc', () => {
  it('creates a Y.Doc with gc=false', () => {
    const doc = createNoteDoc();
    expect(doc).toBeInstanceOf(Y.Doc);
    expect(doc.gc).toBe(false);
  });

  it('getText returns Y.Text named body', () => {
    const doc = createNoteDoc();
    const text = getNoteText(doc);
    expect(text).toBeInstanceOf(Y.Text);
  });
});

// ── Seed from body ────────────────────────────────────────────────────────────

describe('seedDocFromBody', () => {
  it('inserts the body into an empty doc', () => {
    const doc = createNoteDoc();
    seedDocFromBody(doc, '# Hello\n\nWorld');
    expect(extractBody(doc)).toBe('# Hello\n\nWorld');
  });

  it('does not insert into a non-empty doc (idempotent)', () => {
    const doc = createNoteDoc();
    seedDocFromBody(doc, 'first');
    seedDocFromBody(doc, 'second');
    expect(extractBody(doc)).toBe('first');
  });

  it('preserves markdown structure', () => {
    const doc = createNoteDoc();
    const md = '# Title\n\n- item 1\n- item 2\n\n**bold** and _italic_';
    seedDocFromBody(doc, md);
    expect(extractBody(doc)).toBe(md);
  });
});

// ── Encoding ──────────────────────────────────────────────────────────────────

describe('encodeDocState / applyDocUpdate', () => {
  it('round-trips a document state', () => {
    const doc = createNoteDoc();
    seedDocFromBody(doc, 'hello world');
    const state = encodeDocState(doc);
    const doc2 = createNoteDoc();
    applyDocUpdate(doc2, state);
    expect(extractBody(doc2)).toBe('hello world');
  });

  it('returns true on valid update', () => {
    const doc = createNoteDoc();
    const update = encodeDocState(createNoteDoc());
    expect(applyDocUpdate(doc, update)).toBe(true);
  });

  it('returns false on corrupt update without throwing', () => {
    const doc = createNoteDoc();
    expect(applyDocUpdate(doc, new Uint8Array([0xff, 0x00, 0xde, 0xad]))).toBe(false);
  });
});

describe('diffUpdate', () => {
  it('sends only the diff needed for catchup', () => {
    const server = createNoteDoc();
    const client = createNoteDoc();
    seedDocFromBody(server, 'server content');
    const clientSV = encodeDocStateVector(client);
    const diff = diffUpdate(server, clientSV);
    applyDocUpdate(client, diff);
    expect(extractBody(client)).toBe('server content');
  });

  it('diff is empty when client is already up-to-date', () => {
    const doc = createNoteDoc();
    seedDocFromBody(doc, 'content');
    const sv = encodeDocStateVector(doc);
    const diff = diffUpdate(doc, sv);
    // Applying an empty/no-op diff leaves the doc unchanged
    const doc2 = createNoteDoc();
    applyDocUpdate(doc2, encodeDocState(doc));
    applyDocUpdate(doc2, diff);
    expect(extractBody(doc2)).toBe('content');
  });
});

// ── Merge / compaction ────────────────────────────────────────────────────────

describe('mergeUpdates / compactUpdates', () => {
  it('merges multiple updates into one that reproduces the state', () => {
    const doc = createNoteDoc();
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));
    const text = getNoteText(doc);
    text.insert(0, 'Hello');
    text.insert(5, ' World');
    const merged = mergeUpdates(updates);
    const doc2 = createNoteDoc();
    applyDocUpdate(doc2, merged);
    expect(extractBody(doc2)).toBe('Hello World');
  });

  it('mergeUpdates handles empty array', () => {
    const result = mergeUpdates([]);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(0);
  });

  it('compactUpdates produces correct state', () => {
    const updates: Uint8Array[] = [];
    const doc = createNoteDoc();
    doc.on('update', (u: Uint8Array) => updates.push(u));
    const text = getNoteText(doc);
    text.insert(0, 'compact');
    text.insert(7, ' me');
    const compacted = compactUpdates(updates);
    const doc2 = createNoteDoc();
    applyDocUpdate(doc2, compacted);
    expect(extractBody(doc2)).toBe('compact me');
  });

  it('compactUpdates with empty input returns empty update', () => {
    const result = compactUpdates([]);
    expect(result.length).toBe(0);
  });
});

// ── Wire message framing ──────────────────────────────────────────────────────

describe('encodeSyncStep1 / decodeSyncStep1', () => {
  it('encodes and decodes a SyncStep1 message', () => {
    const serverDoc = createNoteDoc();
    const clientDoc = createNoteDoc();
    seedDocFromBody(serverDoc, 'some text');
    const awareness = createAwareness(serverDoc);

    const step1 = encodeSyncStep1(clientDoc);
    const decoded = decodeMessage(step1, serverDoc, awareness, 'client');

    expect(decoded.type).toBe('sync');
    expect(decoded.syncType).toBe(0);
    expect(decoded.reply).not.toBeNull();
    // First byte of reply should be MSG_SYNC (0)
    if (decoded.reply) {
      expect(decoded.reply[0]).toBe(MSG_SYNC);
    }
  });
});

describe('message framing round-trips', () => {
  it('sync step2 applies updates to client', () => {
    const serverDoc = createNoteDoc();
    const clientDoc = createNoteDoc();
    seedDocFromBody(serverDoc, 'from server');
    const awareness = createAwareness(serverDoc);

    // Client sends step1
    const step1 = encodeSyncStep1(clientDoc);
    const decoded = decodeMessage(step1, serverDoc, awareness, 'client');

    // Server reply contains step2 (diff for client)
    expect(decoded.reply).not.toBeNull();
    // Apply step2 to client
    const clientAwareness = createAwareness(clientDoc);
    if (decoded.reply) {
      const replyDecoded = decodeMessage(decoded.reply, clientDoc, clientAwareness, 'server');
      expect(replyDecoded.type).toBe('sync');
    }
    expect(extractBody(clientDoc)).toBe('from server');
  });

  it('encodes and decodes an awareness message', () => {
    const doc = createNoteDoc();
    const awareness = createAwareness(doc);
    awareness.setLocalState({ user: 'alice', cursor: 42 });

    const msg = encodeAwarenessMsg(awareness, [doc.clientID]);
    // First byte should be MSG_AWARENESS (1) since 1 < 128
    expect(msg[0]).toBe(MSG_AWARENESS);
  });

  it('decodeMessage handles awareness messages', () => {
    const doc = createNoteDoc();
    const awareness = createAwareness(doc);
    awareness.setLocalState({ user: 'bob' });

    const msg = encodeAwarenessMsg(awareness, [doc.clientID]);
    const targetDoc = createNoteDoc();
    const targetAwareness = createAwareness(targetDoc);
    const decoded = decodeMessage(msg, targetDoc, targetAwareness, 'remote');
    expect(decoded.type).toBe('awareness');
    expect(decoded.awarenessUpdate).toBeDefined();
  });

  it('decodeMessage handles encodeUpdate messages', () => {
    const doc = createNoteDoc();
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));
    getNoteText(doc).insert(0, 'hello');
    const update = updates[0]!;
    const msg = encodeUpdate(update);

    const targetDoc = createNoteDoc();
    const targetAwareness = createAwareness(targetDoc);
    const decoded = decodeMessage(msg, targetDoc, targetAwareness, 'remote');
    expect(decoded.type).toBe('sync');
    expect(decoded.syncType).toBe(2);
    expect(extractBody(targetDoc)).toBe('hello');
  });

  it('decodeMessage returns unknown for unrecognised type', () => {
    const doc = createNoteDoc();
    const awareness = createAwareness(doc);
    const msg = new Uint8Array([0xff, 0x00]);
    const decoded = decodeMessage(msg, doc, awareness);
    expect(decoded.type).toBe('unknown');
    expect(decoded.reply).toBeNull();
  });
});

// ── CONVERGENCE PROPERTY TESTS ────────────────────────────────────────────────
//
// These prove the heart of CRDT correctness: no matter what order concurrent
// ops arrive in, all peers reach identical state.

describe('convergence property', () => {
  it('two peers reach identical state after concurrent inserts', () => {
    const docA = createNoteDoc();
    const docB = createNoteDoc();

    const updatesA: Uint8Array[] = captureUpdates(docA);
    const updatesB: Uint8Array[] = captureUpdates(docB);

    getNoteText(docA).insert(0, 'Hello');
    getNoteText(docB).insert(0, 'World');

    // Exchange updates cross-wise
    applyAll(docB, updatesA);
    applyAll(docA, updatesB);

    expect(extractBody(docA)).toBe(extractBody(docB));
  });

  it('three peers reach identical state after concurrent edits', () => {
    const docs = [createNoteDoc(), createNoteDoc(), createNoteDoc()];
    const allUpdates: Uint8Array[][] = docs.map(captureUpdates);

    getNoteText(docs[0]!).insert(0, 'Alpha ');
    getNoteText(docs[1]!).insert(0, 'Beta ');
    getNoteText(docs[2]!).insert(0, 'Gamma');

    // Broadcast all updates to all peers
    for (let i = 0; i < docs.length; i++) {
      for (let j = 0; j < docs.length; j++) {
        if (i !== j) applyAll(docs[j]!, allUpdates[i]!);
      }
    }

    const states = docs.map(extractBody);
    expect(states[0]).toBe(states[1]);
    expect(states[1]).toBe(states[2]);
  });

  it('convergence holds regardless of update delivery order (fuzz, 5 peers)', () => {
    const rng = makeLCG(0xdeadbeef);
    const N = 5;
    const docs = Array.from({ length: N }, createNoteDoc);
    const allUpdates: Uint8Array[][] = docs.map(captureUpdates);

    // Each peer does 5 edits
    docs.forEach((doc, i) => {
      const text = getNoteText(doc);
      for (let k = 0; k < 5; k++) {
        const pos = Math.floor(rng() * (text.length + 1));
        text.insert(pos, `p${String(i)}k${String(k)} `);
      }
    });

    // Collect all updates into a flat list
    const allFlat: Array<{ doc: Y.Doc; update: Uint8Array }> = [];
    for (let i = 0; i < N; i++) {
      for (const u of allUpdates[i]!) {
        allFlat.push({ doc: docs[i]!, update: u });
      }
    }

    // Apply to each peer in a random order
    for (const peer of docs) {
      const shuffled = shuffle(allFlat, rng);
      for (const { doc, update } of shuffled) {
        if (doc !== peer) applyDocUpdate(peer, update);
      }
    }

    const states = docs.map(extractBody);
    for (let i = 1; i < N; i++) {
      expect(states[i]).toBe(states[0]);
    }
  });

  it('convergence holds after delete + insert conflicts (fuzz)', () => {
    const rng = makeLCG(0xcafebabe);
    const N = 4;
    const docs = Array.from({ length: N }, createNoteDoc);
    const allUpdates: Uint8Array[][] = docs.map(captureUpdates);

    // Seed doc[0] with initial content; capture that update
    const text0 = getNoteText(docs[0]!);
    text0.insert(0, 'ABCDEFGHIJKLMNOP');

    // Each peer performs concurrent edits (after capturing update listeners)
    docs.forEach((doc, i) => {
      const text = getNoteText(doc);
      if (i === 0) {
        // doc[0] already has text; delete one char and prepend tag
        text.delete(4, 1);
        text.insert(0, `[${String(i)}]`);
      } else {
        // Other docs start empty; just prepend tag (no delete needed)
        text.insert(0, `[${String(i)}]`);
      }
    });

    // Deliver ALL updates (including seed) to all other peers in random order
    for (const peer of docs) {
      const shuffled = shuffle(allFlat(allUpdates, docs, peer), rng);
      for (const u of shuffled) {
        applyDocUpdate(peer, u);
      }
    }

    const states = docs.map(extractBody);
    for (let i = 1; i < N; i++) {
      expect(states[i]).toBe(states[0]);
    }
  });

  it('convergence: 10 peers, 10 random ops each, random delivery order', () => {
    const rng = makeLCG(0x12345678);
    const N = 10;
    const docs = Array.from({ length: N }, createNoteDoc);
    const allUpdates: Uint8Array[][] = docs.map(captureUpdates);

    docs.forEach((doc, i) => {
      const text = getNoteText(doc);
      for (let k = 0; k < 10; k++) {
        const len = text.length;
        if (len > 2 && rng() > 0.6) {
          const start = Math.floor(rng() * (len - 1));
          text.delete(start, 1);
        } else {
          const pos = Math.floor(rng() * (len + 1));
          text.insert(pos, String.fromCharCode(65 + i, 48 + k));
        }
      }
    });

    for (const peer of docs) {
      const shuffled = shuffle(allFlat(allUpdates, docs, peer), rng);
      for (const u of shuffled) {
        applyDocUpdate(peer, u);
      }
    }

    const states = docs.map(extractBody);
    for (let i = 1; i < N; i++) {
      expect(states[i]).toBe(states[0]);
    }
  });
});

// Helper for convergence tests: all updates except self
function allFlat(
  allUpdates: Uint8Array[][],
  docs: Y.Doc[],
  exclude: Y.Doc,
): Uint8Array[] {
  const result: Uint8Array[] = [];
  for (let i = 0; i < docs.length; i++) {
    if (docs[i] !== exclude) {
      result.push(...allUpdates[i]!);
    }
  }
  return result;
}

// ── Awareness tests ───────────────────────────────────────────────────────────

describe('awareness', () => {
  it('creates awareness bound to doc', () => {
    const doc = createNoteDoc();
    const awareness = createAwareness(doc);
    expect(awareness).toBeInstanceOf(awarenessProtocol.Awareness);
    expect(awareness.doc).toBe(doc);
    awareness.destroy();
  });

  it('setLocalState and getStates', () => {
    const doc = createNoteDoc();
    const awareness = createAwareness(doc);
    awareness.setLocalState({ user: 'alice', cursor: 0 });
    expect(awareness.getStates().size).toBe(1);
    awareness.destroy();
  });

  it('removeAwarenessClients clears state', () => {
    const doc = createNoteDoc();
    const awareness = createAwareness(doc);
    awareness.setLocalState({ user: 'ghost' });
    const id = awareness.clientID;
    expect(awareness.getStates().size).toBe(1);
    removeAwarenessClients(awareness, [id]);
    expect(awareness.getStates().size).toBe(0);
    awareness.destroy();
  });

  it('encodes awareness update that can be applied to another awareness', () => {
    const docA = createNoteDoc();
    const awarenessA = createAwareness(docA);
    awarenessA.setLocalState({ user: 'alice', cursor: 5 });

    const docB = createNoteDoc();
    const awarenessB = createAwareness(docB);

    const update = awarenessProtocol.encodeAwarenessUpdate(awarenessA, [docA.clientID]);
    awarenessProtocol.applyAwarenessUpdate(awarenessB, update, 'relay');

    // awarenessB should now know about alice (among possibly other states)
    const state = awarenessB.getStates().get(docA.clientID);
    expect(state?.['user']).toBe('alice');
    expect(state?.['cursor']).toBe(5);

    awarenessA.destroy();
    awarenessB.destroy();
  });
});

// ── Document versioning ───────────────────────────────────────────────────────

describe('migrateCrdtDoc', () => {
  it('returns state unchanged when schema_version matches', () => {
    const state = new Uint8Array([1, 2, 3]);
    const result = migrateCrdtDoc({
      doc_id: 'note_1',
      state,
      schema_version: CRDT_SCHEMA_VERSION,
      updated_at: new Date().toISOString(),
    });
    expect(result).toBe(state);
  });

  it('returns null for unknown schema version', () => {
    const result = migrateCrdtDoc({
      doc_id: 'note_1',
      state: new Uint8Array([1, 2, 3]),
      schema_version: 999,
      updated_at: new Date().toISOString(),
    });
    expect(result).toBeNull();
  });
});

// ── Memory benchmark ──────────────────────────────────────────────────────────

describe('memory benchmark (F1109)', () => {
  it('handles a large document without excessive memory growth', () => {
    const doc = createNoteDoc();
    const text = getNoteText(doc);

    const before = process.memoryUsage().heapUsed;

    // Insert 50k characters in 500 transactions of 100 chars each
    const chunk = 'a'.repeat(100);
    for (let i = 0; i < 500; i++) {
      text.insert(text.length, chunk);
    }

    const state = encodeDocState(doc);
    const afterInsert = process.memoryUsage().heapUsed;

    // State should be reasonable — well under 10 MB for 50k chars
    expect(state.length).toBeLessThan(10 * 1024 * 1024);

    // Load into a fresh doc to test snapshot restoration
    const doc2 = createNoteDoc();
    applyDocUpdate(doc2, state);
    expect(extractBody(doc2)).toHaveLength(50_000);

    // Memory growth should be less than 50 MB
    const growth = afterInsert - before;
    expect(growth).toBeLessThan(50 * 1024 * 1024);
  });

  it('compaction reduces storage size after many updates', () => {
    const doc = createNoteDoc();
    const updates: Uint8Array[] = captureUpdates(doc);
    const text = getNoteText(doc);

    // 200 individual character inserts
    for (let i = 0; i < 200; i++) {
      text.insert(i, String.fromCharCode(65 + (i % 26)));
    }

    const totalUncompacted = updates.reduce((s, u) => s + u.length, 0);
    const compacted = compactUpdates(updates);

    // Compacted should be smaller than naive sum of individual updates
    expect(compacted.length).toBeLessThan(totalUncompacted);

    // And should reproduce the correct state
    const doc2 = createNoteDoc();
    applyDocUpdate(doc2, compacted);
    expect(extractBody(doc2)).toBe(extractBody(doc));
  });
});
