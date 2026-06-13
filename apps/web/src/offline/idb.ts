/**
 * Hand-rolled IndexedDB wrapper (F821–F830).
 * No external deps — wraps the native IDB API with promise-based helpers.
 *
 * Schema (version 3):
 *  - notes        : Note records keyed by id
 *  - notebooks    : Notebook records keyed by id
 *  - entities     : Entity records keyed by id
 *  - stories      : Story metadata keyed by id
 *  - outbox       : Pending offline mutations (SYNC ENGINE INTEGRATION POINT)
 *  - attachments  : Attachment metadata + pin-for-offline flag
 *  - kv           : General key-value store (hydration cursors, prefs, etc.)
 *
 * Sync integration point (F828):
 *   The sync engine (packages/sync) should import OutboxEntry and call:
 *     await idb.outbox.list()        — fetch all pending entries
 *     await idb.outbox.delete(id)    — remove after server confirms
 *     (or use the OutboxBroadcast channel to be notified of new entries)
 *   It must set entry.status = 'syncing' before processing to prevent double-send.
 */

export const DB_NAME = 'fables-local';
export const DB_VERSION = 3;

// ──────────────────────────────── TYPES ──────────────────────────────────────

export interface IdbNote {
  id: string;
  notebookId: string;
  title: string;
  body: string;
  pinned: boolean;
  trashedAt: string | null;
  createdAt: string;
  updatedAt: string;
  rev: number;
  tags?: Array<{ id: string; name: string; color: string | null; createdAt: string }>;
  _syncedAt: number; // epoch ms of last IDB write
}

export interface IdbNotebook {
  id: string;
  parentId: string | null;
  name: string;
  icon: string | null;
  color: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  _syncedAt: number;
}

export interface IdbEntity {
  id: string;
  type: string;
  name: string;
  aliases: string[];
  fields: Record<string, unknown>;
  noteId: string | null;
  createdAt: string;
  updatedAt: string;
  _syncedAt: number;
}

export interface IdbStory {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  _syncedAt: number;
}

/** ---- OUTBOX: the sync engine integration point ---- */
export type OutboxOp = 'create' | 'patch' | 'delete';
export type OutboxResource = 'notes' | 'notebooks' | 'entities' | 'stories';
export type OutboxStatus = 'pending' | 'syncing' | 'failed';

export interface OutboxEntry {
  id: string; // uuid, generated client-side
  resource: OutboxResource;
  op: OutboxOp;
  resourceId: string; // the entity's id (temp id for creates)
  payload: unknown; // the API request body
  createdAt: number; // epoch ms
  attemptCount: number;
  status: OutboxStatus;
  lastError: string | null;
  /** Clock-skew tolerance: local timestamp at the time of the mutation. */
  clientTimestamp: number;
}

export interface IdbAttachment {
  id: string;
  noteId: string | null;
  filename: string;
  mime: string;
  size: number;
  hash: string;
  createdAt: string;
  pinnedOffline: boolean; // F829: user requested offline pin
  _syncedAt: number;
}

export interface IdbKvEntry {
  key: string;
  value: unknown;
  updatedAt: number;
}

// ──────────────────────────────── OPEN / MIGRATE ─────────────────────────────

let _db: IDBDatabase | null = null;
let _openPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  if (_openPromise) return _openPromise;

  _openPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const oldVersion = event.oldVersion;
      migrate(db, oldVersion);
    };

    req.onsuccess = (event) => {
      _db = (event.target as IDBOpenDBRequest).result;
      _db.onversionchange = () => {
        _db?.close();
        _db = null;
        _openPromise = null;
      };
      resolve(_db);
    };

    req.onerror = () => {
      _openPromise = null;
      reject(req.error);
    };
  });

  return _openPromise;
}

function migrate(db: IDBDatabase, oldVersion: number): void {
  // Version 1: core stores
  if (oldVersion < 1) {
    const notes = db.createObjectStore('notes', { keyPath: 'id' });
    notes.createIndex('notebookId', 'notebookId');
    notes.createIndex('updatedAt', 'updatedAt');
    notes.createIndex('_syncedAt', '_syncedAt');

    db.createObjectStore('notebooks', { keyPath: 'id' });
    db.createObjectStore('entities', { keyPath: 'id' });
    db.createObjectStore('stories', { keyPath: 'id' });

    const outbox = db.createObjectStore('outbox', { keyPath: 'id' });
    outbox.createIndex('status', 'status');
    outbox.createIndex('createdAt', 'createdAt');

    db.createObjectStore('kv', { keyPath: 'key' });
  }

  // Version 2: attachments store
  if (oldVersion < 2) {
    const att = db.createObjectStore('attachments', { keyPath: 'id' });
    att.createIndex('noteId', 'noteId');
    att.createIndex('pinnedOffline', 'pinnedOffline');
  }

  // Version 3: add tags index on notes
  if (oldVersion < 3) {
    // notes store already exists; just make sure indexes are current
    // (ObjectStore can't be recreated, so we add new indexes only)
    try {
      const notes = (db as unknown as { transaction: (s: string, m: string) => IDBTransaction })
        .transaction('notes', 'readonly')
        .objectStore('notes');
      if (!notes.indexNames.contains('trashedAt')) {
        notes.createIndex?.('trashedAt', 'trashedAt');
      }
    } catch {
      // index already exists — ignore
    }
  }
}

/** Drop the entire DB (wipe/repair tool, F830). */
export async function wipeDb(): Promise<void> {
  if (_db) {
    _db.close();
    _db = null;
    _openPromise = null;
  }
  await new Promise<void>((res, rej) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}

// ──────────────────────────────── HELPERS ────────────────────────────────────

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function getStore(name: string, mode: IDBTransactionMode = 'readonly') {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

// ──────────────────────────────── NOTES ──────────────────────────────────────

export const notesStore = {
  get: async (id: string): Promise<IdbNote | undefined> => {
    const store = await getStore('notes');
    return idbReq<IdbNote>(store.get(id));
  },

  list: async (notebookId?: string): Promise<IdbNote[]> => {
    const store = await getStore('notes');
    if (notebookId) {
      const idx = store.index('notebookId');
      return idbReq<IdbNote[]>(idx.getAll(notebookId));
    }
    return idbReq<IdbNote[]>(store.getAll());
  },

  put: async (note: IdbNote): Promise<void> => {
    const store = await getStore('notes', 'readwrite');
    await idbReq(store.put({ ...note, _syncedAt: Date.now() }));
  },

  bulkPut: async (notes: IdbNote[]): Promise<void> => {
    const store = await getStore('notes', 'readwrite');
    await Promise.all(notes.map((n) => idbReq(store.put({ ...n, _syncedAt: Date.now() }))));
  },

  delete: async (id: string): Promise<void> => {
    const store = await getStore('notes', 'readwrite');
    await idbReq(store.delete(id));
  },

  clear: async (): Promise<void> => {
    const store = await getStore('notes', 'readwrite');
    await idbReq(store.clear());
  },
};

// ──────────────────────────────── NOTEBOOKS ──────────────────────────────────

export const notebooksStore = {
  get: async (id: string): Promise<IdbNotebook | undefined> => {
    const store = await getStore('notebooks');
    return idbReq<IdbNotebook>(store.get(id));
  },

  list: async (): Promise<IdbNotebook[]> => {
    const store = await getStore('notebooks');
    return idbReq<IdbNotebook[]>(store.getAll());
  },

  put: async (nb: IdbNotebook): Promise<void> => {
    const store = await getStore('notebooks', 'readwrite');
    await idbReq(store.put({ ...nb, _syncedAt: Date.now() }));
  },

  bulkPut: async (nbs: IdbNotebook[]): Promise<void> => {
    const store = await getStore('notebooks', 'readwrite');
    await Promise.all(nbs.map((nb) => idbReq(store.put({ ...nb, _syncedAt: Date.now() }))));
  },

  clear: async (): Promise<void> => {
    const store = await getStore('notebooks', 'readwrite');
    await idbReq(store.clear());
  },
};

// ──────────────────────────────── ENTITIES ───────────────────────────────────

export const entitiesStore = {
  get: async (id: string): Promise<IdbEntity | undefined> => {
    const store = await getStore('entities');
    return idbReq<IdbEntity>(store.get(id));
  },

  list: async (): Promise<IdbEntity[]> => {
    const store = await getStore('entities');
    return idbReq<IdbEntity[]>(store.getAll());
  },

  put: async (e: IdbEntity): Promise<void> => {
    const store = await getStore('entities', 'readwrite');
    await idbReq(store.put({ ...e, _syncedAt: Date.now() }));
  },

  bulkPut: async (es: IdbEntity[]): Promise<void> => {
    const store = await getStore('entities', 'readwrite');
    await Promise.all(es.map((e) => idbReq(store.put({ ...e, _syncedAt: Date.now() }))));
  },

  clear: async (): Promise<void> => {
    const store = await getStore('entities', 'readwrite');
    await idbReq(store.clear());
  },
};

// ──────────────────────────────── STORIES ────────────────────────────────────

export const storiesStore = {
  list: async (): Promise<IdbStory[]> => {
    const store = await getStore('stories');
    return idbReq<IdbStory[]>(store.getAll());
  },

  put: async (s: IdbStory): Promise<void> => {
    const store = await getStore('stories', 'readwrite');
    await idbReq(store.put({ ...s, _syncedAt: Date.now() }));
  },

  bulkPut: async (ss: IdbStory[]): Promise<void> => {
    const store = await getStore('stories', 'readwrite');
    await Promise.all(ss.map((s) => idbReq(store.put({ ...s, _syncedAt: Date.now() }))));
  },
};

// ──────────────────────────────── OUTBOX ─────────────────────────────────────

/** Broadcast channel for sync engine notification. */
export const OUTBOX_CHANNEL = 'fables-outbox';

export const outboxStore = {
  list: async (status?: OutboxStatus): Promise<OutboxEntry[]> => {
    const store = await getStore('outbox');
    if (status) {
      const idx = store.index('status');
      return idbReq<OutboxEntry[]>(idx.getAll(status));
    }
    return idbReq<OutboxEntry[]>(store.getAll());
  },

  put: async (entry: OutboxEntry): Promise<void> => {
    const store = await getStore('outbox', 'readwrite');
    await idbReq(store.put(entry));
    // Notify sync engine
    try {
      new BroadcastChannel(OUTBOX_CHANNEL).postMessage({ type: 'NEW_ENTRY', id: entry.id });
    } catch {
      /* BroadcastChannel not available in all envs */
    }
  },

  /**
   * Add a new mutation to the outbox.
   * Returns the generated entry id.
   */
  enqueue: async (
    resource: OutboxResource,
    op: OutboxOp,
    resourceId: string,
    payload: unknown,
  ): Promise<string> => {
    const id = crypto.randomUUID();
    await outboxStore.put({
      id,
      resource,
      op,
      resourceId,
      payload,
      createdAt: Date.now(),
      attemptCount: 0,
      status: 'pending',
      lastError: null,
      clientTimestamp: Date.now(),
    });
    return id;
  },

  updateStatus: async (id: string, status: OutboxStatus, error?: string): Promise<void> => {
    const store = await getStore('outbox', 'readwrite');
    const entry = await idbReq<OutboxEntry>(store.get(id));
    if (!entry) return;
    await idbReq(
      store.put({
        ...entry,
        status,
        lastError: error ?? null,
        attemptCount: entry.attemptCount + 1,
      }),
    );
  },

  delete: async (id: string): Promise<void> => {
    const store = await getStore('outbox', 'readwrite');
    await idbReq(store.delete(id));
  },

  count: async (): Promise<number> => {
    const store = await getStore('outbox');
    return idbReq<number>(store.count());
  },

  clear: async (): Promise<void> => {
    const store = await getStore('outbox', 'readwrite');
    await idbReq(store.clear());
  },
};

// ──────────────────────────────── ATTACHMENTS ────────────────────────────────

export const attachmentsStore = {
  list: async (): Promise<IdbAttachment[]> => {
    const store = await getStore('attachments');
    return idbReq<IdbAttachment[]>(store.getAll());
  },

  get: async (id: string): Promise<IdbAttachment | undefined> => {
    const store = await getStore('attachments');
    return idbReq<IdbAttachment>(store.get(id));
  },

  put: async (att: IdbAttachment): Promise<void> => {
    const store = await getStore('attachments', 'readwrite');
    await idbReq(store.put({ ...att, _syncedAt: Date.now() }));
  },

  pin: async (id: string, pinned: boolean): Promise<void> => {
    const store = await getStore('attachments', 'readwrite');
    const att = await idbReq<IdbAttachment>(store.get(id));
    if (!att) return;
    await idbReq(store.put({ ...att, pinnedOffline: pinned }));
  },

  bulkPut: async (atts: IdbAttachment[]): Promise<void> => {
    const store = await getStore('attachments', 'readwrite');
    await Promise.all(atts.map((a) => idbReq(store.put({ ...a, _syncedAt: Date.now() }))));
  },
};

// ──────────────────────────────── KV ─────────────────────────────────────────

export const kvStore = {
  get: async <T>(key: string): Promise<T | undefined> => {
    const store = await getStore('kv');
    const entry = await idbReq<IdbKvEntry | undefined>(store.get(key));
    return entry?.value as T | undefined;
  },

  set: async (key: string, value: unknown): Promise<void> => {
    const store = await getStore('kv', 'readwrite');
    await idbReq(store.put({ key, value, updatedAt: Date.now() }));
  },

  delete: async (key: string): Promise<void> => {
    const store = await getStore('kv', 'readwrite');
    await idbReq(store.delete(key));
  },
};

// ──────────────────────────────── STORAGE QUOTA ──────────────────────────────

export interface StorageQuota {
  usage: number;
  quota: number;
  percentUsed: number;
  isPersistent: boolean;
}

export async function checkStorageQuota(): Promise<StorageQuota | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  const isPersistent = await (navigator.storage.persisted?.() ?? Promise.resolve(false));
  return {
    usage,
    quota,
    percentUsed: quota > 0 ? (usage / quota) * 100 : 0,
    isPersistent,
  };
}

export async function requestStoragePersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

// ──────────────────────────────── HYDRATION ──────────────────────────────────

/** KV keys used for hydration state. */
export const KV_HYDRATED_AT = 'hydration:completedAt';
export const KV_HYDRATION_CURSOR = 'hydration:cursor';

export async function markHydrated(): Promise<void> {
  await kvStore.set(KV_HYDRATED_AT, Date.now());
}

export async function getLastHydration(): Promise<number | null> {
  const ts = await kvStore.get<number>(KV_HYDRATED_AT);
  return ts ?? null;
}
