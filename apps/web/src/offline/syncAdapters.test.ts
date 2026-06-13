// @vitest-environment jsdom
/**
 * IDB ↔ SyncEngine adapter tests (F834/F837).
 *
 * Tests the adapter logic with in-memory fakes (no real IDB).
 * Note: uses relative paths to packages/sync/src since the workspace
 * symlink is created by the orchestrator's `pnpm install`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SYNC_SCHEMA_VERSION } from '../../../../packages/sync/src/types.js';
import type { SyncOp } from '../../../../packages/sync/src/types.js';
import type { NoteRow, EntityRow } from '../../../../packages/sync/src/store.js';

// ── Stub IDB stores before importing adapters ────────────────────────────────
vi.mock('./idb.js', () => ({
  outboxStore: {
    list: vi.fn().mockResolvedValue([]),
    put: vi.fn().mockResolvedValue(undefined),
    enqueue: vi.fn().mockResolvedValue('mock-id'),
    delete: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(0),
  },
  notesStore: {
    list: vi.fn().mockResolvedValue([]),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  },
  entitiesStore: {
    list: vi.fn().mockResolvedValue([]),
    put: vi.fn().mockResolvedValue(undefined),
  },
  kvStore: {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
  },
  OUTBOX_CHANNEL: 'fables-outbox',
  DB_NAME: 'fables-local',
  DB_VERSION: 3,
}));

import { IdbCursorStorage, IdbOutbox, IdbLocalStore, getOrCreateDeviceId } from './syncAdapters.js';

function makeOp(id: string, entityId = 'note-1'): SyncOp {
  return {
    id,
    deviceId: 'dev1',
    lamport: 1,
    schemaVersion: SYNC_SCHEMA_VERSION,
    clientCreatedAt: new Date().toISOString(),
    domain: 'note',
    opType: 'update',
    entityId,
    payload: { title: 'test' },
  } as SyncOp;
}

function makeNote(id = 'note-1'): NoteRow {
  return {
    id,
    notebookId: 'nb1',
    title: 'Test Note',
    body: 'body',
    pinned: false,
    trashedAt: null,
    updatedAt: new Date().toISOString(),
    rev: 1,
  };
}

function makeEntity(id = 'ent-1'): EntityRow {
  return {
    id,
    type: 'character',
    name: 'Alice',
    fields: { age: 30 },
    body: '',
    deletedAt: null,
    updatedAt: new Date().toISOString(),
  };
}

// ── IdbCursorStorage ──────────────────────────────────────────────────────────

describe('IdbCursorStorage', () => {
  it('starts at 0 before init', () => {
    const cursor = new IdbCursorStorage();
    expect(cursor.load()).toBe(0);
  });

  it('save/load round-trips in memory', () => {
    const cursor = new IdbCursorStorage();
    cursor.save(42);
    expect(cursor.load()).toBe(42);
  });

  it('save updates across multiple calls', () => {
    const cursor = new IdbCursorStorage();
    cursor.save(10);
    cursor.save(20);
    cursor.save(99);
    expect(cursor.load()).toBe(99);
  });

  it('init hydrates from kv store', async () => {
    const { kvStore } = await import('./idb.js');
    vi.mocked(kvStore.get).mockResolvedValueOnce(77);
    const cursor = new IdbCursorStorage();
    await cursor.init();
    expect(cursor.load()).toBe(77);
  });
});

// ── IdbOutbox ─────────────────────────────────────────────────────────────────

describe('IdbOutbox', () => {
  let outbox: IdbOutbox;

  beforeEach(() => {
    outbox = new IdbOutbox();
  });

  it('starts with empty pending list', () => {
    expect(outbox.pending()).toEqual([]);
  });

  it('enqueue adds to pending', () => {
    outbox.enqueue(makeOp('op1'));
    expect(outbox.pending()).toHaveLength(1);
  });

  it('pending returns only non-quarantined ops', () => {
    outbox.enqueue(makeOp('op1'));
    outbox.enqueue(makeOp('op2'));
    outbox.quarantine('op1', 'too many rejections');
    expect(outbox.pending()).toHaveLength(1);
    expect(outbox.pending()[0]?.id).toBe('op2');
  });

  it('acknowledge removes ops from pending', () => {
    outbox.enqueue(makeOp('op1'));
    outbox.enqueue(makeOp('op2'));
    outbox.acknowledge(['op1']);
    expect(outbox.pending()).toHaveLength(1);
    expect(outbox.pending()[0]?.id).toBe('op2');
  });

  it('acknowledge with all ids empties the outbox', () => {
    outbox.enqueue(makeOp('op1'));
    outbox.enqueue(makeOp('op2'));
    outbox.acknowledge(['op1', 'op2']);
    expect(outbox.pending()).toEqual([]);
  });

  it('quarantined returns moved ops with reasons', () => {
    outbox.enqueue(makeOp('op1'));
    outbox.quarantine('op1', 'bad payload');
    const q = outbox.quarantined();
    expect(q).toHaveLength(1);
    expect(q[0]?.op.id).toBe('op1');
    expect(q[0]?.reason).toBe('bad payload');
  });

  it('quarantined op is no longer in pending', () => {
    outbox.enqueue(makeOp('op1'));
    outbox.quarantine('op1', 'bad');
    expect(outbox.pending()).toEqual([]);
  });

  it('enqueueing an already-quarantined id is a no-op', () => {
    outbox.enqueue(makeOp('op1'));
    outbox.quarantine('op1', 'bad');
    // Re-enqueue same op — should be blocked
    outbox.enqueue(makeOp('op1'));
    expect(outbox.pending()).toEqual([]);
  });
});

// ── IdbLocalStore ─────────────────────────────────────────────────────────────

describe('IdbLocalStore', () => {
  let store: IdbLocalStore;

  beforeEach(() => {
    store = new IdbLocalStore();
  });

  describe('notes', () => {
    it('getNote returns null for unknown id', () => {
      expect(store.getNote('unknown')).toBeNull();
    });

    it('upsertNote + getNote round-trips', () => {
      const note = makeNote();
      store.upsertNote(note);
      expect(store.getNote(note.id)).toEqual(note);
    });

    it('upsertNote overwrites existing', () => {
      const note = makeNote();
      store.upsertNote(note);
      store.upsertNote({ ...note, title: 'Updated' });
      expect(store.getNote(note.id)?.title).toBe('Updated');
    });

    it('deleteNote (soft) sets trashedAt', () => {
      const note = makeNote();
      store.upsertNote(note);
      store.deleteNote(note.id, false);
      expect(store.getNote(note.id)?.trashedAt).not.toBeNull();
    });

    it('deleteNote (hard) removes the record', () => {
      const note = makeNote();
      store.upsertNote(note);
      store.deleteNote(note.id, true);
      expect(store.getNote(note.id)).toBeNull();
    });

    it('allNoteIds returns ids of all notes', () => {
      store.upsertNote(makeNote('n1'));
      store.upsertNote(makeNote('n2'));
      expect(store.allNoteIds()).toContain('n1');
      expect(store.allNoteIds()).toContain('n2');
    });
  });

  describe('entities', () => {
    it('getEntity returns null for unknown id', () => {
      expect(store.getEntity('unknown')).toBeNull();
    });

    it('upsertEntity + getEntity round-trips', () => {
      const ent = makeEntity();
      store.upsertEntity(ent);
      expect(store.getEntity(ent.id)).toEqual(ent);
    });

    it('deleteEntity marks deletedAt', () => {
      const ent = makeEntity();
      store.upsertEntity(ent);
      store.deleteEntity(ent.id);
      expect(store.getEntity(ent.id)?.deletedAt).not.toBeNull();
    });

    it('allEntityIds returns ids of all entities', () => {
      store.upsertEntity(makeEntity('e1'));
      store.upsertEntity(makeEntity('e2'));
      expect(store.allEntityIds()).toContain('e1');
      expect(store.allEntityIds()).toContain('e2');
    });
  });

  describe('save slots', () => {
    it('getSaveSlot returns null for unknown id', () => {
      expect(store.getSaveSlot('unknown')).toBeNull();
    });

    it('upsertSaveSlot + getSaveSlot round-trips', () => {
      const slot = {
        id: 's1',
        storyId: 'story1',
        slotName: 'autosave',
        state: { scene: 'forest' },
        deviceLabel: null,
        deletedAt: null,
        updatedAt: new Date().toISOString(),
      };
      store.upsertSaveSlot(slot);
      expect(store.getSaveSlot('s1')).toEqual(slot);
    });

    it('deleteSaveSlot marks deletedAt', () => {
      const slot = {
        id: 's1',
        storyId: 'story1',
        slotName: 'auto',
        state: {},
        deviceLabel: null,
        deletedAt: null,
        updatedAt: new Date().toISOString(),
      };
      store.upsertSaveSlot(slot);
      store.deleteSaveSlot('s1');
      expect(store.getSaveSlot('s1')?.deletedAt).not.toBeNull();
    });
  });
});

// ── Device ID generation ──────────────────────────────────────────────────────

describe('getOrCreateDeviceId', () => {
  it('returns existing device id from kv', async () => {
    const { kvStore } = await import('./idb.js');
    vi.mocked(kvStore.get).mockResolvedValueOnce('existing-device-id');
    const id = await getOrCreateDeviceId();
    expect(id).toBe('existing-device-id');
  });

  it('generates and stores a new device id if none exists', async () => {
    const { kvStore } = await import('./idb.js');
    vi.mocked(kvStore.get).mockResolvedValueOnce(undefined);
    vi.mocked(kvStore.set).mockResolvedValueOnce(undefined);

    const id = await getOrCreateDeviceId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
    expect(kvStore.set).toHaveBeenCalledWith(
      'sync:deviceId',
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
  });
});
