/**
 * Sync context: holds the shared SyncEngine, store, and outbox instances.
 *
 * Initialized lazily on first access; safe to call from any hook.
 * Singleton pattern — the engine is shared across all components.
 *
 * `pnpm install` creates the workspace symlink these remain valid.
 */

import { SyncEngine, DEFAULT_ENGINE_CONFIG } from '@fables/sync';
import type { SyncHealth } from '@fables/sync';
import { HttpSyncTransport } from './syncTransport.js';
import {
  IdbCursorStorage,
  IdbOutbox,
  IdbLocalStore,
  getOrCreateDeviceId,
} from './syncAdapters.js';

export interface SyncContext {
  engine: SyncEngine;
  store: IdbLocalStore;
  outbox: IdbOutbox;
  cursor: IdbCursorStorage;
  deviceId: string;
}

let _ctx: SyncContext | null = null;
let _initPromise: Promise<SyncContext> | null = null;

/** Get (or create) the singleton sync context. */
export async function getSyncContext(): Promise<SyncContext> {
  if (_ctx) return _ctx;
  if (_initPromise) return _initPromise;

  _initPromise = (async (): Promise<SyncContext> => {
    const deviceId = await getOrCreateDeviceId();

    const cursor = new IdbCursorStorage();
    await cursor.init();

    const outbox = new IdbOutbox();
    await outbox.hydrate();

    const store = new IdbLocalStore();
    await store.hydrate();

    const transport = new HttpSyncTransport(deviceId);

    const engine = new SyncEngine(
      { ...DEFAULT_ENGINE_CONFIG, deviceId },
      store,
      outbox,
      cursor,
      transport,
    );

    _ctx = { engine, store, outbox, cursor, deviceId };
    return _ctx;
  })();

  return _initPromise;
}

/** Reset singleton (for tests). */
export function resetSyncContext(): void {
  _ctx = null;
  _initPromise = null;
}

/** Get current sync health without initializing (safe to call before init). */
export function getSyncHealthSnapshot(): SyncHealth | null {
  if (!_ctx) return null;
  return _ctx.engine.syncHealth;
}
