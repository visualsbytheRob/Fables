/**
 * Sync engine tests (F840, F849, F869, F870).
 *
 * Covers:
 *  - Lamport clock arithmetic
 *  - Op application (idempotency, LWW, tombstones)
 *  - Conflict resolution (LWW fields, 3-way merge, tombstone, save-slot keep-both)
 *  - Convergence property: N devices with interleaved ops reach identical state
 *  - Fuzz test: random concurrent op sequences always converge
 *  - Backoff + jitter
 *  - Checksum comparison
 *  - Compaction
 *  - Corrupt-op quarantine
 *  - Chaos test: partial batch acknowledged → no loss/dupes
 *  - 10k pending op drain
 */

import { describe, it, expect } from 'vitest';
import { advanceClock, compareLamport, tickClock } from './clock.js';
import { applyOp, applyOps } from './apply.js';
import {
  lwwField,
  threeWayMerge,
  resolveTombstoneConflict,
  createSaveSlotConflict,
} from './conflict.js';
import { computeBackoff } from './backoff.js';
import { buildChecksum, compareChecksums } from './checksum.js';
import { compactEntity } from './compaction.js';
import { MemoryStore, MemoryCursorStorage, MemoryOutbox } from './store.js';
import { SyncEngine } from './engine.js';
import type { SyncOp, PullResponse, PushResponse } from './index.js';
import { makeDeviceId, SYNC_SCHEMA_VERSION } from './types.js';
import type { SyncTransport } from './engine.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeNoteCreate(
  entityId: string,
  lamport: number,
  deviceId: string,
  notebookId = 'nb_1',
): SyncOp {
  return {
    id: `${deviceId}_${lamport}`,
    deviceId,
    lamport,
    schemaVersion: SYNC_SCHEMA_VERSION,
    clientCreatedAt: new Date().toISOString(),
    domain: 'note',
    opType: 'create',
    entityId,
    payload: { notebookId, title: `Note ${entityId}`, body: 'hello' },
  };
}

function makeNoteUpdate(
  entityId: string,
  lamport: number,
  deviceId: string,
  fields: { title?: string; body?: string },
): SyncOp {
  return {
    id: `${deviceId}_${lamport}`,
    deviceId,
    lamport,
    schemaVersion: SYNC_SCHEMA_VERSION,
    clientCreatedAt: new Date().toISOString(),
    domain: 'note',
    opType: 'update',
    entityId,
    payload: fields,
  };
}

function makeNoteDelete(entityId: string, lamport: number, deviceId: string): SyncOp {
  return {
    id: `${deviceId}_${lamport}`,
    deviceId,
    lamport,
    schemaVersion: SYNC_SCHEMA_VERSION,
    clientCreatedAt: new Date().toISOString(),
    domain: 'note',
    opType: 'delete',
    entityId,
    payload: { noteId: entityId, hard: false },
  };
}

// ── Lamport clock ──────────────────────────────────────────────────────────────

describe('Lamport clock', () => {
  it('tickClock increments by 1', () => {
    expect(tickClock(0)).toBe(1);
    expect(tickClock(5)).toBe(6);
  });

  it('advanceClock takes max+1', () => {
    expect(advanceClock(3, 7)).toBe(8);
    expect(advanceClock(7, 3)).toBe(8);
    expect(advanceClock(5, 5)).toBe(6);
  });

  it('compareLamport orders by lamport then deviceId', () => {
    expect(
      compareLamport({ lamport: 1, deviceId: 'a' }, { lamport: 2, deviceId: 'a' }),
    ).toBeLessThan(0);
    expect(
      compareLamport({ lamport: 2, deviceId: 'a' }, { lamport: 1, deviceId: 'a' }),
    ).toBeGreaterThan(0);
    expect(
      compareLamport({ lamport: 5, deviceId: 'a' }, { lamport: 5, deviceId: 'b' }),
    ).toBeLessThan(0);
    expect(
      compareLamport({ lamport: 5, deviceId: 'z' }, { lamport: 5, deviceId: 'a' }),
    ).toBeGreaterThan(0);
    expect(compareLamport({ lamport: 3, deviceId: 'x' }, { lamport: 3, deviceId: 'x' })).toBe(0);
  });
});

// ── Op application ─────────────────────────────────────────────────────────────

describe('applyOp', () => {
  it('creates a note', () => {
    const store = new MemoryStore();
    const op = makeNoteCreate('note_1', 1, 'dev_A');
    expect(applyOp(op, store).ok).toBe(true);
    const note = store.getNote('note_1');
    expect(note).not.toBeNull();
    expect(note?.title).toBe('Note note_1');
  });

  it('is idempotent — applying the same op twice yields the same state', () => {
    const store = new MemoryStore();
    const op = makeNoteCreate('note_1', 1, 'dev_A');
    applyOp(op, store);
    applyOp(op, store);
    expect(store.allNoteIds()).toHaveLength(1);
  });

  it('LWW: higher lamport wins on update', () => {
    const store = new MemoryStore();
    applyOp(makeNoteCreate('note_1', 1, 'dev_A'), store);
    applyOp(makeNoteUpdate('note_1', 5, 'dev_B', { title: 'Winner' }), store);
    applyOp(makeNoteUpdate('note_1', 3, 'dev_A', { title: 'Loser' }), store);
    expect(store.getNote('note_1')?.title).toBe('Winner');
  });

  it('LWW: lower lamport update after higher is a no-op', () => {
    const store = new MemoryStore();
    applyOp(makeNoteCreate('note_1', 10, 'dev_A'), store);
    applyOp(makeNoteUpdate('note_1', 2, 'dev_B', { title: 'Stale' }), store);
    expect(store.getNote('note_1')?.title).toBe('Note note_1');
  });

  it('tombstone wins over concurrent lower-lamport update (F846)', () => {
    const store = new MemoryStore();
    applyOp(makeNoteCreate('note_1', 1, 'dev_A'), store);
    // Delete at lamport 5
    applyOp(makeNoteDelete('note_1', 5, 'dev_A'), store);
    // Update at lamport 3 — lower than delete
    applyOp(makeNoteUpdate('note_1', 3, 'dev_B', { title: 'Ghost' }), store);
    // Tombstone should still win
    const note = store.getNote('note_1');
    expect(note?.trashedAt).not.toBeNull();
  });

  it('creates an entity', () => {
    const store = new MemoryStore();
    const op: SyncOp = {
      id: 'dev_A_1',
      deviceId: 'dev_A',
      lamport: 1,
      schemaVersion: SYNC_SCHEMA_VERSION,
      clientCreatedAt: new Date().toISOString(),
      domain: 'entity',
      opType: 'create',
      entityId: 'ent_1',
      payload: { type: 'character', name: 'Fox', fields: { health: 100 } },
    };
    applyOp(op, store);
    const entity = store.getEntity('ent_1');
    expect(entity?.name).toBe('Fox');
    expect(entity?.fields['health']).toBe(100);
  });

  it('deletes an entity (soft tombstone)', () => {
    const store = new MemoryStore();
    const create: SyncOp = {
      id: 'dev_A_1',
      deviceId: 'dev_A',
      lamport: 1,
      schemaVersion: SYNC_SCHEMA_VERSION,
      clientCreatedAt: new Date().toISOString(),
      domain: 'entity',
      opType: 'create',
      entityId: 'ent_1',
      payload: { type: 'character', name: 'Fox', fields: {} },
    };
    const del: SyncOp = {
      id: 'dev_A_2',
      deviceId: 'dev_A',
      lamport: 2,
      schemaVersion: SYNC_SCHEMA_VERSION,
      clientCreatedAt: new Date().toISOString(),
      domain: 'entity',
      opType: 'delete',
      entityId: 'ent_1',
      payload: { entityId: 'ent_1' },
    };
    applyOp(create, store);
    applyOp(del, store);
    expect(store.getEntity('ent_1')?.deletedAt).not.toBeNull();
  });

  it('upserts a save slot', () => {
    const store = new MemoryStore();
    const op: SyncOp = {
      id: 'dev_A_1',
      deviceId: 'dev_A',
      lamport: 1,
      schemaVersion: SYNC_SCHEMA_VERSION,
      clientCreatedAt: new Date().toISOString(),
      domain: 'save_slot',
      opType: 'upsert',
      entityId: 'slot_1',
      payload: {
        storyId: 'story_1',
        slotName: 'autosave',
        state: { scene: 'intro' },
        deviceLabel: 'iPhone',
      },
    };
    applyOp(op, store);
    const slot = store.getSaveSlot('slot_1');
    expect(slot?.slotName).toBe('autosave');
    expect(slot?.state['scene']).toBe('intro');
  });
});

// ── Convergence property (F840) ────────────────────────────────────────────────

describe('convergence property', () => {
  /**
   * Apply the same ops in different orders to N independent stores.
   * All stores must reach identical state.
   */
  function convergesForPermutation(ops: SyncOp[]): boolean {
    const stores = [new MemoryStore(), new MemoryStore(), new MemoryStore()];

    // Permutations: original, reversed, mid-shuffled
    const orderings = [[...ops], [...ops].reverse(), [...ops].sort(() => 0.5 - Math.random())];

    for (let i = 0; i < stores.length; i++) {
      applyOps(orderings[i]!, stores[i]!);
    }

    // All stores should agree on all note IDs
    const ids0 = stores[0]!.allNoteIds().sort();
    const ids1 = stores[1]!.allNoteIds().sort();
    const ids2 = stores[2]!.allNoteIds().sort();

    if (JSON.stringify(ids0) !== JSON.stringify(ids1)) return false;
    if (JSON.stringify(ids0) !== JSON.stringify(ids2)) return false;

    // Check all notes have the same final title (LWW guarantees this)
    for (const id of ids0) {
      const n0 = stores[0]!.getNote(id);
      const n1 = stores[1]!.getNote(id);
      const n2 = stores[2]!.getNote(id);
      if (n0?.title !== n1?.title || n0?.title !== n2?.title) return false;
      if (n0?.body !== n1?.body || n0?.body !== n2?.body) return false;
    }
    return true;
  }

  it('two devices creating the same note converge', () => {
    const ops: SyncOp[] = [
      makeNoteCreate('note_1', 1, 'dev_A'),
      makeNoteUpdate('note_1', 2, 'dev_B', { title: 'B says this' }),
    ];
    expect(convergesForPermutation(ops)).toBe(true);
  });

  it('three devices with interleaved updates converge', () => {
    const ops: SyncOp[] = [
      makeNoteCreate('note_1', 1, 'dev_A'),
      makeNoteUpdate('note_1', 3, 'dev_B', { title: 'Version B' }),
      makeNoteUpdate('note_1', 5, 'dev_C', { title: 'Version C' }),
      makeNoteUpdate('note_1', 4, 'dev_A', { body: 'A body' }),
    ];
    expect(convergesForPermutation(ops)).toBe(true);
  });

  it('delete + concurrent update converges (tombstone policy consistent)', () => {
    const ops: SyncOp[] = [
      makeNoteCreate('note_1', 1, 'dev_A'),
      makeNoteDelete('note_1', 5, 'dev_B'),
      makeNoteUpdate('note_1', 3, 'dev_C', { title: 'After delete?' }),
    ];
    expect(convergesForPermutation(ops)).toBe(true);
  });

  it('multiple notes from multiple devices converge', () => {
    const ops: SyncOp[] = [];
    for (let i = 0; i < 10; i++) {
      ops.push(makeNoteCreate(`note_${i}`, i * 3 + 1, 'dev_A'));
      ops.push(makeNoteUpdate(`note_${i}`, i * 3 + 2, 'dev_B', { title: `B title ${i}` }));
      ops.push(makeNoteUpdate(`note_${i}`, i * 3 + 3, 'dev_A', { body: `A body ${i}` }));
    }
    expect(convergesForPermutation(ops)).toBe(true);
  });
});

// ── Fuzz test (F849) ───────────────────────────────────────────────────────────

describe('fuzz: random concurrent op sequences always converge', () => {
  it('random op orderings converge (100 iterations)', () => {
    // Deterministic PRNG for reproducibility
    let seed = 42;
    function rand(): number {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return (seed >>> 0) / 0x100000000;
    }

    for (let trial = 0; trial < 100; trial++) {
      const numNotes = Math.floor(rand() * 5) + 1;
      const numDevices = Math.floor(rand() * 3) + 2;
      const ops: SyncOp[] = [];

      let lamport = 1;
      const noteIds = Array.from({ length: numNotes }, (_, i) => `note_fuzz_${trial}_${i}`);
      const deviceIds = Array.from({ length: numDevices }, (_, i) => `dev_${i}`);

      // Create all notes
      for (const nid of noteIds) {
        const dev = deviceIds[Math.floor(rand() * deviceIds.length)]!;
        ops.push(makeNoteCreate(nid, lamport++, dev));
      }

      // Random updates
      for (let k = 0; k < numNotes * 3; k++) {
        const nid = noteIds[Math.floor(rand() * noteIds.length)]!;
        const dev = deviceIds[Math.floor(rand() * deviceIds.length)]!;
        const del = rand() < 0.15; // 15% chance of delete
        if (del) {
          ops.push(makeNoteDelete(nid, lamport++, dev));
        } else {
          ops.push(makeNoteUpdate(nid, lamport++, dev, { title: `title_${lamport}` }));
        }
      }

      // Check convergence across 3 different orderings
      const stores = [new MemoryStore(), new MemoryStore(), new MemoryStore()];
      const sorted = [...ops].sort((a, b) =>
        compareLamport(
          { lamport: a.lamport, deviceId: a.deviceId },
          { lamport: b.lamport, deviceId: b.deviceId },
        ),
      );
      const reversed = [...sorted].reverse();
      const shuffled = [...ops].sort(() => rand() - 0.5);

      applyOps(sorted, stores[0]!);
      applyOps(reversed, stores[1]!);
      applyOps(shuffled, stores[2]!);

      for (const id of noteIds) {
        const n0 = stores[0]!.getNote(id);
        const n1 = stores[1]!.getNote(id);
        const n2 = stores[2]!.getNote(id);
        const t0 = n0?.title ?? null;
        const t1 = n1?.title ?? null;
        const t2 = n2?.title ?? null;
        expect(t0).toBe(t1);
        expect(t0).toBe(t2);
        // tombstone consistency
        const trash0 = n0?.trashedAt !== null;
        const trash1 = n1?.trashedAt !== null;
        const trash2 = n2?.trashedAt !== null;
        expect(trash0).toBe(trash1);
        expect(trash0).toBe(trash2);
      }
    }
  });
});

// ── Conflict resolution ────────────────────────────────────────────────────────

describe('conflict resolution', () => {
  describe('lwwField (F841)', () => {
    it('higher lamport wins', () => {
      const base = { value: 'old', lamport: 2, deviceId: 'dev_A' };
      const incoming = { value: 'new', lamport: 5, deviceId: 'dev_B' };
      expect(lwwField(base, incoming).value).toBe('new');
    });

    it('lower lamport loses', () => {
      const base = { value: 'current', lamport: 5, deviceId: 'dev_A' };
      const incoming = { value: 'stale', lamport: 2, deviceId: 'dev_B' };
      expect(lwwField(base, incoming).value).toBe('current');
    });

    it('same lamport: higher deviceId wins (deterministic tiebreak)', () => {
      const base = { value: 'dev_A value', lamport: 3, deviceId: 'dev_A' };
      const incoming = { value: 'dev_Z value', lamport: 3, deviceId: 'dev_Z' };
      expect(lwwField(base, incoming).value).toBe('dev_Z value');
    });
  });

  describe('threeWayMerge (F842)', () => {
    it('no-op when both sides equal base', () => {
      const result = threeWayMerge('hello', 'hello', 'hello');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.merged).toBe('hello');
    });

    it('clean merge when only one side changes', () => {
      const result = threeWayMerge('base', 'edited', 'base');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.merged).toBe('edited');
    });

    it('clean merge when only remote changes', () => {
      const result = threeWayMerge('base', 'base', 'remote edit');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.merged).toBe('remote edit');
    });

    it('conflict copy when both sides differ from base and differ from each other (F843)', () => {
      const result = threeWayMerge('base', 'local version', 'remote version');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.conflict).toBe(true);
        expect(result.localText).toBe('local version');
        expect(result.remoteText).toBe('remote version');
      }
    });

    it('identical edits merge cleanly', () => {
      const result = threeWayMerge('original', 'both changed it', 'both changed it');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.merged).toBe('both changed it');
    });
  });

  describe('tombstone conflict (F846)', () => {
    it('delete wins when delete lamport >= update lamport', () => {
      const r = resolveTombstoneConflict(5, 'dev_A', 3, 'dev_B');
      expect(r.action).toBe('delete');
    });

    it('update wins when update lamport > delete lamport', () => {
      const r = resolveTombstoneConflict(3, 'dev_A', 5, 'dev_B');
      expect(r.action).toBe('keep');
    });

    it('same lamport uses deviceId tiebreak', () => {
      const r = resolveTombstoneConflict(5, 'dev_Z', 5, 'dev_A');
      // dev_Z > dev_A → delete wins (same lamport, delete from higher device)
      expect(r.action).toBe('delete');
    });
  });

  describe('save-slot keep-both (F847)', () => {
    it('creates a conflict record with device labels', () => {
      const conflict = createSaveSlotConflict(
        'story_1',
        'autosave',
        { id: 'dev_A', label: 'iPhone', state: { scene: 'intro' } },
        { id: 'dev_B', label: 'MacBook', state: { scene: 'chapter2' } },
      );
      expect(conflict.deviceALabel).toBe('iPhone');
      expect(conflict.deviceBLabel).toBe('MacBook');
      expect(conflict.stateA['scene']).toBe('intro');
      expect(conflict.stateB['scene']).toBe('chapter2');
    });
  });
});

// ── Backoff + jitter (F861) ────────────────────────────────────────────────────

describe('backoff', () => {
  it('first attempt: ~1s', () => {
    const r = computeBackoff(1, { baseMs: 1000, maxMs: 60000, jitter: 0, maxAttempts: 0 });
    expect(r.delayMs).toBe(1000);
    expect(r.shouldGiveUp).toBe(false);
  });

  it('doubles each attempt up to cap', () => {
    const cfg = { baseMs: 1000, maxMs: 8000, jitter: 0, maxAttempts: 0 };
    expect(computeBackoff(1, cfg).delayMs).toBe(1000);
    expect(computeBackoff(2, cfg).delayMs).toBe(2000);
    expect(computeBackoff(3, cfg).delayMs).toBe(4000);
    expect(computeBackoff(4, cfg).delayMs).toBe(8000);
    expect(computeBackoff(5, cfg).delayMs).toBe(8000); // capped
  });

  it('jitter varies the result within bounds', () => {
    const cfg = { baseMs: 1000, maxMs: 60000, jitter: 0.3, maxAttempts: 0 };
    const results = new Set<number>();
    for (let i = 0; i < 20; i++) {
      results.add(computeBackoff(1, cfg).delayMs);
    }
    expect(results.size).toBeGreaterThan(1);
    for (const d of results) {
      expect(d).toBeGreaterThanOrEqual(700); // 1000 * (1 - 0.3)
      expect(d).toBeLessThanOrEqual(1300); // 1000 * (1 + 0.3)
    }
  });

  it('gives up after maxAttempts', () => {
    const cfg = { baseMs: 1000, maxMs: 60000, jitter: 0, maxAttempts: 3 };
    expect(computeBackoff(3, cfg).shouldGiveUp).toBe(false);
    expect(computeBackoff(4, cfg).shouldGiveUp).toBe(true);
  });
});

// ── Checksum (F867) ────────────────────────────────────────────────────────────

describe('checksum', () => {
  it('same ids → same checksum regardless of order', () => {
    const a = buildChecksum('notes', ['id_1', 'id_2', 'id_3']);
    const b = buildChecksum('notes', ['id_3', 'id_1', 'id_2']);
    expect(a.checksum).toBe(b.checksum);
    expect(a.rowCount).toBe(b.rowCount);
  });

  it('different ids → different checksum', () => {
    const a = buildChecksum('notes', ['id_1', 'id_2']);
    const b = buildChecksum('notes', ['id_1', 'id_3']);
    expect(a.checksum).not.toBe(b.checksum);
  });

  it('empty set → stable checksum', () => {
    const a = buildChecksum('notes', []);
    const b = buildChecksum('notes', []);
    expect(a.checksum).toBe(b.checksum);
    expect(a.rowCount).toBe(0);
  });

  it('compareChecksums reports diverged tables', () => {
    const client = [buildChecksum('notes', ['a', 'b']), buildChecksum('entities', ['e1'])];
    const server = [buildChecksum('notes', ['a', 'b', 'c']), buildChecksum('entities', ['e1'])];
    const diverged = compareChecksums(client, server);
    expect(diverged).toHaveLength(1);
    expect(diverged[0]?.table).toBe('notes');
  });

  it('compareChecksums returns empty when in sync', () => {
    const ids = ['a', 'b', 'c'];
    const checksums = [buildChecksum('notes', ids)];
    expect(compareChecksums(checksums, checksums)).toHaveLength(0);
  });
});

// ── Compaction (F836) ──────────────────────────────────────────────────────────

describe('compaction', () => {
  it('compacts create + update into a snapshot', () => {
    const ops: SyncOp[] = [
      makeNoteCreate('note_1', 1, 'dev_A'),
      makeNoteUpdate('note_1', 2, 'dev_B', { title: 'Updated' }),
    ];
    const snapshot = compactEntity({ entityId: 'note_1', domain: 'note', ops });
    expect(snapshot).not.toBeNull();
    expect(snapshot?.entityId).toBe('note_1');
    expect(snapshot?.throughLamport).toBe(2);
    expect(snapshot?.payload['title']).toBe('Updated');
  });

  it('compaction with delete marks isDeleted', () => {
    const ops: SyncOp[] = [
      makeNoteCreate('note_1', 1, 'dev_A'),
      makeNoteDelete('note_1', 3, 'dev_A'),
    ];
    const snapshot = compactEntity({ entityId: 'note_1', domain: 'note', ops });
    expect(snapshot?.payload['isDeleted']).toBe(true);
  });

  it('returns null for empty ops', () => {
    const snapshot = compactEntity({ entityId: 'note_1', domain: 'note', ops: [] });
    expect(snapshot).toBeNull();
  });
});

// ── Corrupt-op quarantine (F864) ──────────────────────────────────────────────

describe('quarantine', () => {
  it('quarantined ops are not in pending()', () => {
    const outbox = new MemoryOutbox();
    const op = makeNoteCreate('note_1', 1, 'dev_A');
    outbox.enqueue(op);
    expect(outbox.pending()).toHaveLength(1);
    outbox.quarantine(op.id, 'schema error');
    expect(outbox.pending()).toHaveLength(0);
    expect(outbox.quarantined()).toHaveLength(1);
    expect(outbox.quarantined()[0]?.reason).toBe('schema error');
  });

  it('re-enqueuing a quarantined op id is ignored', () => {
    const outbox = new MemoryOutbox();
    const op = makeNoteCreate('note_1', 1, 'dev_A');
    outbox.enqueue(op);
    outbox.quarantine(op.id, 'bad');
    outbox.enqueue(op); // should be ignored because id is quarantined
    expect(outbox.pending()).toHaveLength(0);
  });
});

// ── Cursor persistence (F837) ─────────────────────────────────────────────────

describe('cursor persistence', () => {
  it('saves and loads cursor', () => {
    const cursor = new MemoryCursorStorage();
    expect(cursor.load()).toBe(0);
    cursor.save(42);
    expect(cursor.load()).toBe(42);
    cursor.save(100);
    expect(cursor.load()).toBe(100);
  });
});

// ── Chaos test: partial batch (F870) ──────────────────────────────────────────

describe('chaos test: partial batch no loss/dupes (F870)', () => {
  it('acknowledges only the accepted subset; remaining stay in outbox', () => {
    const outbox = new MemoryOutbox();
    const ops = Array.from({ length: 5 }, (_, i) => makeNoteCreate(`note_${i}`, i + 1, 'dev_A'));
    for (const op of ops) outbox.enqueue(op);

    // Simulate partial ack: only ops 0, 1, 2 accepted
    const accepted = ops.slice(0, 3).map((o) => o.id);
    outbox.acknowledge(accepted);

    const remaining = outbox.pending();
    expect(remaining).toHaveLength(2);
    expect(remaining.map((o) => o.id)).toEqual([ops[3]!.id, ops[4]!.id]);
  });

  it('duplicate acknowledgement is idempotent', () => {
    const outbox = new MemoryOutbox();
    const op = makeNoteCreate('note_1', 1, 'dev_A');
    outbox.enqueue(op);
    outbox.acknowledge([op.id]);
    outbox.acknowledge([op.id]); // second ack of already-removed op
    expect(outbox.pending()).toHaveLength(0);
  });
});

// ── 10k op drain (F869) ────────────────────────────────────────────────────────

describe('10k pending op drain (F869)', () => {
  it('all 10000 ops applied and acknowledged without loss', async () => {
    const store = new MemoryStore();
    const outbox = new MemoryOutbox();
    const cursor = new MemoryCursorStorage();

    let serverSeq = 0;
    const serverLog: SyncOp[] = [];

    const transport: SyncTransport = {
      async push(ops: SyncOp[], _sv: number): Promise<PushResponse> {
        const acks = ops.map((op) => {
          serverLog.push(op);
          serverSeq++;
          return { opId: op.id, status: 'accepted' as const, serverSeq };
        });
        return { acks, serverSchemaVersion: SYNC_SCHEMA_VERSION };
      },
      async pull(_since: string, _limit: number): Promise<PullResponse> {
        return { ops: [], nextCursor: null, serverSchemaVersion: SYNC_SCHEMA_VERSION };
      },
    };

    const engine = new SyncEngine(
      {
        deviceId: makeDeviceId('dev_drain'),
        batchSize: 100,
        backoff: { baseMs: 0, maxMs: 0, jitter: 0, maxAttempts: 0 },
      },
      store,
      outbox,
      cursor,
      transport,
    );

    // Enqueue 10000 ops
    for (let i = 0; i < 10_000; i++) {
      engine.enqueue({
        domain: 'note',
        opType: 'create',
        entityId: `note_drain_${i}`,
        payload: { notebookId: 'nb_1', title: `Note ${i}`, body: '' },
      });
    }

    expect(outbox.pending()).toHaveLength(10_000);

    const result = await engine.sync();
    expect(result.errors).toHaveLength(0);
    expect(result.pushed).toBe(10_000);
    expect(outbox.pending()).toHaveLength(0);
    expect(serverLog).toHaveLength(10_000);
  }, 30_000); // 30s timeout for 10k ops
});

// ── Schema version negotiation (F865) ─────────────────────────────────────────

describe('schema version negotiation (F865)', () => {
  it('compatible when server matches client', () => {
    const store = new MemoryStore();
    const outbox = new MemoryOutbox();
    const cursor = new MemoryCursorStorage();
    const transport: SyncTransport = {
      async push(): Promise<PushResponse> {
        return { acks: [], serverSchemaVersion: SYNC_SCHEMA_VERSION };
      },
      async pull(): Promise<PullResponse> {
        return { ops: [], nextCursor: null, serverSchemaVersion: SYNC_SCHEMA_VERSION };
      },
    };
    const engine = new SyncEngine(
      {
        deviceId: makeDeviceId('dev_test'),
        batchSize: 10,
        backoff: { baseMs: 0, maxMs: 0, jitter: 0, maxAttempts: 0 },
      },
      store,
      outbox,
      cursor,
      transport,
    );
    const neg = engine.negotiateSchema(SYNC_SCHEMA_VERSION);
    expect(neg.compatible).toBe(true);
  });

  it('incompatible when server version is too old', () => {
    const store = new MemoryStore();
    const outbox = new MemoryOutbox();
    const cursor = new MemoryCursorStorage();
    const transport: SyncTransport = {
      async push(): Promise<PushResponse> {
        return { acks: [], serverSchemaVersion: 0 };
      },
      async pull(): Promise<PullResponse> {
        return { ops: [], nextCursor: null, serverSchemaVersion: 0 };
      },
    };
    const engine = new SyncEngine(
      {
        deviceId: makeDeviceId('dev_test'),
        batchSize: 10,
        backoff: { baseMs: 0, maxMs: 0, jitter: 0, maxAttempts: 0 },
      },
      store,
      outbox,
      cursor,
      transport,
    );
    const neg = engine.negotiateSchema(0);
    expect(neg.compatible).toBe(false);
  });
});
