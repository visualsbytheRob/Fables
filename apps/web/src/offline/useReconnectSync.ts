/**
 * Reconnect burst auto-sync (F856): when the app goes from offline → online,
 * drain the outbox by replaying mutations against the API.
 *
 * Background Sync registration (F857): if supported, registers a sync tag
 * so the SW can trigger this even when the tab is backgrounded.
 *
 * SYNC ENGINE INTEGRATION: this file is the foreground side.
 * The packages/sync engine should provide a `drainOutbox(entries)` function
 * that this hook can call. Until that exists, we do a simple replay here.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useOnlineStatus } from './useOnlineStatus.js';
import { outboxStore } from './idb.js';
import { useToast } from '@fables/ui';

const BACKGROUND_SYNC_TAG = 'fables-outbox';

/** Register Background Sync if the browser supports it (F857). */
async function registerBackgroundSync(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    // @ts-expect-error BackgroundSyncManager is not in TS lib yet
    if (reg.sync) await reg.sync.register(BACKGROUND_SYNC_TAG);
  } catch {
    // Not supported or SW not registered — ignore.
  }
}

export function useReconnectSync(): void {
  const online = useOnlineStatus();
  const prevOnline = useRef(online);
  const { toast } = useToast();
  const draining = useRef(false);

  const drainOutbox = useCallback(async (): Promise<void> => {
    if (draining.current) return;
    draining.current = true;

    const entries = await outboxStore.list('pending');
    if (entries.length === 0) {
      draining.current = false;
      return;
    }

    toast(`Syncing ${entries.length} offline change${entries.length !== 1 ? 's' : ''}…`, 'info');
    let synced = 0;
    let failed = 0;

    for (const entry of entries) {
      await outboxStore.updateStatus(entry.id, 'syncing');
      try {
        const method = entry.op === 'create' ? 'POST' : entry.op === 'patch' ? 'PATCH' : 'DELETE';
        const url = `/api/v1/${entry.resource}${entry.op !== 'create' ? `/${entry.resourceId}` : ''}`;
        const fetchInit: RequestInit = {
          method,
          headers: { 'content-type': 'application/json' },
        };
        if (entry.payload !== null && entry.payload !== undefined) {
          fetchInit.body = JSON.stringify(entry.payload);
        }
        const res = await fetch(url, fetchInit);

        if (res.ok || res.status === 409) {
          // 409 = conflict, server wins — still remove from outbox
          await outboxStore.delete(entry.id);
          synced++;
        } else {
          await outboxStore.updateStatus(entry.id, 'failed', `HTTP ${res.status}`);
          failed++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown';
        await outboxStore.updateStatus(entry.id, 'failed', msg);
        failed++;
      }
    }

    draining.current = false;
    if (failed === 0) {
      toast(`Synced ${synced} change${synced !== 1 ? 's' : ''} successfully.`);
    } else {
      toast(`Synced ${synced}, ${failed} failed. Check connection.`, 'error');
    }
  }, [toast]);

  // Register background sync on mount
  useEffect(() => {
    void registerBackgroundSync();
  }, []);

  // Drain on reconnect
  useEffect(() => {
    const wasOffline = !prevOnline.current;
    prevOnline.current = online;
    if (online && wasOffline) {
      void drainOutbox();
    }
  }, [online, drainOutbox]);

  // Listen for SW background sync trigger
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if ((event.data as { type?: string })?.type === 'BACKGROUND_SYNC_TRIGGER') {
        void drainOutbox();
      }
    };
    navigator.serviceWorker?.addEventListener('message', handler);
    return () => navigator.serviceWorker?.removeEventListener('message', handler);
  }, [drainOutbox]);
}
