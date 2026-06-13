// @vitest-environment jsdom
/**
 * Conflict flow e2e test (F850).
 *
 * Simulates:
 *   1. Two divergent edits (local + remote)
 *   2. threeWayMerge detects conflict
 *   3. ConflictStore records it
 *   4. Resolution (pick-mine / pick-theirs / keep-both)
 *   5. Post-resolution: conflict is cleared
 *
 * Uses in-memory fakes (no real IDB).
 * Note: uses relative paths to packages/sync/src since workspace symlink
 * is created by the orchestrator's `pnpm install`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { threeWayMerge } from '../../../../packages/sync/src/conflict.js';
import type { MergeResult } from '../../../../packages/sync/src/conflict.js';
import { MemoryStore, MemoryOutbox } from '../../../../packages/sync/src/store.js';
import { applyOp } from '../../../../packages/sync/src/apply.js';
import { SYNC_SCHEMA_VERSION } from '../../../../packages/sync/src/types.js';

// ── Stub IDB kv for conflictStore ─────────────────────────────────────────────
const fakeKv = new Map<string, unknown>();

vi.mock('./idb.js', () => ({
  kvStore: {
    get: vi.fn((key: string) => Promise.resolve(fakeKv.get(key))),
    set: vi.fn((key: string, value: unknown) => {
      fakeKv.set(key, value);
      return Promise.resolve();
    }),
  },
  outboxStore: {
    list: vi.fn().mockResolvedValue([]),
    enqueue: vi.fn().mockResolvedValue('id'),
    delete: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(0),
  },
  notesStore: { list: vi.fn().mockResolvedValue([]), put: vi.fn(), delete: vi.fn() },
  entitiesStore: { list: vi.fn().mockResolvedValue([]), put: vi.fn() },
  OUTBOX_CHANNEL: 'fables-outbox',
  DB_NAME: 'fables-local',
  DB_VERSION: 3,
}));

import { conflictStore } from './conflictStore.js';

beforeEach(() => {
  fakeKv.clear();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectConflict(base: string, local: string, remote: string): MergeResult {
  return threeWayMerge(base, local, remote);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('threeWayMerge conflict detection', () => {
  it('detects no conflict when only local changes', () => {
    const result = detectConflict('original', 'local edit', 'original');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.merged).toBe('local edit');
  });

  it('detects no conflict when only remote changes', () => {
    const result = detectConflict('original', 'original', 'remote edit');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.merged).toBe('remote edit');
  });

  it('detects no conflict when both sides made same change', () => {
    const result = detectConflict('original', 'same edit', 'same edit');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.merged).toBe('same edit');
  });

  it('detects conflict when both sides diverge on same line', () => {
    const base = 'line 1\nline 2\nline 3';
    const local = 'line 1\nLOCAL EDIT\nline 3';
    const remote = 'line 1\nREMOTE EDIT\nline 3';
    const result = detectConflict(base, local, remote);
    // Both edited line 2 differently → conflict
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflict).toBe(true);
      expect(result.localText).toBe(local);
      expect(result.remoteText).toBe(remote);
      expect(result.baseText).toBe(base);
    }
  });
});

describe('ConflictStore (F844)', () => {
  it('starts with no pending conflicts', async () => {
    const pending = await conflictStore.listPending();
    expect(pending).toEqual([]);
  });

  it('add records a conflict', async () => {
    const c = await conflictStore.add({
      entityId: 'note-1',
      domain: 'note',
      field: 'body',
      localText: 'local version',
      remoteText: 'remote version',
      baseText: 'base',
      localLamport: 5,
      remoteLamport: 7,
    });
    expect(c.id).toBeTruthy();
    expect(c.resolvedAt).toBeNull();
    expect(c.resolution).toBeNull();
    const pending = await conflictStore.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.entityId).toBe('note-1');
  });

  it('listPending returns only unresolved conflicts', async () => {
    const c1 = await conflictStore.add({
      entityId: 'note-1', domain: 'note', field: 'body',
      localText: 'l', remoteText: 'r', baseText: '',
      localLamport: 1, remoteLamport: 2,
    });
    const c2 = await conflictStore.add({
      entityId: 'note-2', domain: 'note', field: 'title',
      localText: 'a', remoteText: 'b', baseText: '',
      localLamport: 3, remoteLamport: 4,
    });

    // Resolve c1
    await conflictStore.resolve(c1.id, 'pick-mine');

    const pending = await conflictStore.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe(c2.id);
  });

  it('resolve pick-mine marks conflict resolved', async () => {
    const c = await conflictStore.add({
      entityId: 'note-1', domain: 'note', field: 'body',
      localText: 'mine', remoteText: 'theirs', baseText: '',
      localLamport: 1, remoteLamport: 2,
    });

    const resolved = await conflictStore.resolve(c.id, 'pick-mine');
    expect(resolved?.resolution).toBe('pick-mine');
    expect(resolved?.resolvedAt).not.toBeNull();
    const pending = await conflictStore.listPending();
    expect(pending).toHaveLength(0);
  });

  it('resolve pick-theirs marks conflict resolved', async () => {
    const c = await conflictStore.add({
      entityId: 'note-1', domain: 'note', field: 'body',
      localText: 'mine', remoteText: 'theirs', baseText: '',
      localLamport: 1, remoteLamport: 2,
    });

    const resolved = await conflictStore.resolve(c.id, 'pick-theirs');
    expect(resolved?.resolution).toBe('pick-theirs');
    expect(resolved?.resolvedAt).not.toBeNull();
  });

  it('resolve keep-both marks conflict resolved', async () => {
    const c = await conflictStore.add({
      entityId: 'note-1', domain: 'note', field: 'body',
      localText: 'mine', remoteText: 'theirs', baseText: '',
      localLamport: 1, remoteLamport: 2,
    });

    const resolved = await conflictStore.resolve(c.id, 'keep-both');
    expect(resolved?.resolution).toBe('keep-both');
  });

  it('countPending returns count of unresolved conflicts', async () => {
    await conflictStore.add({
      entityId: 'n1', domain: 'note', field: 'body',
      localText: 'a', remoteText: 'b', baseText: '',
      localLamport: 1, remoteLamport: 2,
    });
    await conflictStore.add({
      entityId: 'n2', domain: 'note', field: 'title',
      localText: 'x', remoteText: 'y', baseText: '',
      localLamport: 3, remoteLamport: 4,
    });
    expect(await conflictStore.countPending()).toBe(2);
  });

  it('hasConflict returns true for entity with pending conflict', async () => {
    await conflictStore.add({
      entityId: 'entity-abc', domain: 'entity', field: 'name',
      localText: 'Alice', remoteText: 'Alicia', baseText: '',
      localLamport: 1, remoteLamport: 2,
    });
    expect(await conflictStore.hasConflict('entity-abc')).toBe(true);
    expect(await conflictStore.hasConflict('entity-abc', 'name')).toBe(true);
    expect(await conflictStore.hasConflict('entity-abc', 'type')).toBe(false);
    expect(await conflictStore.hasConflict('other-entity')).toBe(false);
  });
});

describe('Full conflict flow e2e (F850)', () => {
  it('divergent edits → conflict detected → resolve → no more pending', async () => {
    // 1. Two devices made divergent edits to the SAME line of the note body
    const base = 'line 1\nshared line to edit\nline 3';
    const localEdit = 'line 1\nLOCAL VERSION of the shared line\nline 3';
    const remoteEdit = 'line 1\nREMOTE VERSION of the shared line\nline 3';

    // 2. threeWayMerge detects a conflict (both edited the same line differently)
    const mergeResult = threeWayMerge(base, localEdit, remoteEdit);
    expect(mergeResult.ok).toBe(false);

    if (mergeResult.ok) {
      throw new Error('Expected a conflict but got clean merge');
    }

    // 3. Record the conflict
    const recorded = await conflictStore.add({
      entityId: 'note-cave',
      domain: 'note',
      field: 'body',
      localText: mergeResult.localText,
      remoteText: mergeResult.remoteText,
      baseText: mergeResult.baseText,
      localLamport: 10,
      remoteLamport: 8,
    });
    expect(recorded.id).toBeTruthy();

    // 4. Conflict inbox shows it
    const pending = await conflictStore.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.field).toBe('body');

    // 5. User picks "pick-mine"
    const resolved = await conflictStore.resolve(recorded.id, 'pick-mine');
    expect(resolved?.resolution).toBe('pick-mine');

    // 6. Inbox is empty
    const afterResolve = await conflictStore.listPending();
    expect(afterResolve).toHaveLength(0);
  });

  it('entity field conflict detected and resolved', async () => {
    // Entity name conflict between two devices
    const c = await conflictStore.add({
      entityId: 'char-001',
      domain: 'entity',
      field: 'name',
      localText: 'Sir Gawain',
      remoteText: 'Sir Gawayne',
      baseText: 'Gawain',
      localLamport: 5,
      remoteLamport: 6,
    });

    expect(await conflictStore.hasConflict('char-001', 'name')).toBe(true);

    await conflictStore.resolve(c.id, 'pick-theirs');

    expect(await conflictStore.hasConflict('char-001', 'name')).toBe(false);
  });
});

describe('Drain + apply cycle (F834/F837)', () => {
  it('engine outbox acknowledges ops after push (simulated)', () => {
    const outbox = new MemoryOutbox();

    const op = {
      id: 'op-1',
      deviceId: 'dev1',
      lamport: 1,
      schemaVersion: SYNC_SCHEMA_VERSION,
      clientCreatedAt: new Date().toISOString(),
      domain: 'note' as const,
      opType: 'update' as const,
      entityId: 'note-1',
      payload: { title: 'Updated' },
    };

    outbox.enqueue(op);
    expect(outbox.pending()).toHaveLength(1);

    // Simulate server acking the op
    outbox.acknowledge(['op-1']);
    expect(outbox.pending()).toHaveLength(0);
  });

  it('engine applies pulled ops to store (simulated)', () => {
    const store = new MemoryStore();

    // Simulate pulling a note-create op from server
    const createOp = {
      id: 'op-create-1',
      deviceId: 'server',
      lamport: 1,
      schemaVersion: SYNC_SCHEMA_VERSION,
      clientCreatedAt: new Date().toISOString(),
      domain: 'note' as const,
      opType: 'create' as const,
      entityId: 'note-new',
      payload: {
        notebookId: 'nb1',
        title: 'Pulled from server',
        body: 'Server content',
      },
    };

    const result = applyOp(createOp, store);
    expect(result.ok).toBe(true);
    expect(store.getNote('note-new')?.title).toBe('Pulled from server');
  });

  it('MemoryOutbox quarantines repeatedly rejected ops', () => {
    const outbox = new MemoryOutbox();
    const op = {
      id: 'bad-op',
      deviceId: 'dev1',
      lamport: 1,
      schemaVersion: SYNC_SCHEMA_VERSION,
      clientCreatedAt: new Date().toISOString(),
      domain: 'note' as const,
      opType: 'update' as const,
      entityId: 'note-1',
      payload: {},
    };

    outbox.enqueue(op);
    outbox.quarantine('bad-op', 'malformed payload');

    expect(outbox.pending()).toHaveLength(0);
    expect(outbox.quarantined()).toHaveLength(1);
    expect(outbox.quarantined()[0]?.reason).toBe('malformed payload');
  });
});
