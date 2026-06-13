/**
 * useSync() — main sync controller hook (F834/F837/F855/F863).
 *
 * Provides:
 *   - Automatic sync on reconnect (complements simple REST drain in useReconnectSync)
 *   - Periodic sync every 60 seconds when online
 *   - Conflict detection via threeWayMerge + conflict store writes
 *   - Exposed SyncHealth state for OfflineIndicator and settings panel
 *
 * `pnpm install` creates the workspace symlink these remain valid.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOnlineStatus } from './useOnlineStatus.js';
import { getSyncContext } from './syncContext.js';
import { conflictStore } from './conflictStore.js';
import { threeWayMerge } from '@fables/sync';
import type { SyncHealth } from '@fables/sync';
import { useToast } from '@fables/ui';

export interface UseSyncResult {
  health: SyncHealth | null;
  pendingCount: number;
  conflictCount: number;
  isSyncing: boolean;
  lastError: string | null;
  triggerSync: () => void;
}

const SYNC_INTERVAL_MS = 60_000; // periodic sync every 60s
const BACKGROUND_SYNC_TAG = 'fables-outbox';

const DEFAULT_HEALTH: SyncHealth = {
  lastSyncAt: null,
  pendingOps: 0,
  appliedOps: 0,
  quarantinedOps: 0,
  lastError: null,
  lastErrorAt: null,
  consecutiveFailures: 0,
};

export function useSync(): UseSyncResult {
  const online = useOnlineStatus();
  const prevOnline = useRef(online);
  const { toast } = useToast();
  const isSyncing = useRef(false);

  const [health, setHealth] = useState<SyncHealth | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  /** Refresh pending count and conflict count from IDB. */
  const refreshCounts = useCallback(async (): Promise<void> => {
    try {
      const [{ outboxStore }, conflicts] = await Promise.all([
        import('./idb.js'),
        conflictStore.countPending().catch(() => 0),
      ]);
      const pending = await outboxStore.count().catch(() => 0);
      setPendingCount(pending);
      setConflictCount(conflicts);
    } catch {
      // IDB not available — ignore
    }
  }, []);

  /** Run one full sync cycle. */
  const runSync = useCallback(async (): Promise<void> => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    setSyncing(true);

    try {
      let ctx: Awaited<ReturnType<typeof getSyncContext>>;
      try {
        ctx = await getSyncContext();
      } catch {
        // IDB not available (e.g. test env) — skip sync silently
        isSyncing.current = false;
        setSyncing(false);
        return;
      }
      const { pushed, pulled, errors } = await ctx.engine.sync();

      const newHealth = ctx.engine.syncHealth;
      setHealth(newHealth);

      if (errors.length > 0) {
        const msg = errors[0] ?? 'unknown sync error';
        setLastError(msg);
        // Only toast for hard failures to avoid noise
        if (errors.some((e) => e.includes('push failed') || e.includes('pull failed'))) {
          toast(`Sync error: ${msg}`, 'error');
        }
      } else {
        setLastError(null);
        if (pushed > 0 || pulled > 0) {
          toast(`Synced: ${pushed} sent, ${pulled} received`, 'info');
        }
      }

      // Post-sync: detect conflicts in applied ops
      await detectAndRecordConflicts(ctx, pulled);

      await refreshCounts();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastError(msg);
      toast(`Sync failed: ${msg}`, 'error');
    } finally {
      isSyncing.current = false;
      setSyncing(false);
    }
  }, [toast, refreshCounts]);

  /** Register background sync on mount. */
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    void (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        // @ts-expect-error BackgroundSyncManager not in TS lib
        if (reg.sync) await reg.sync.register(BACKGROUND_SYNC_TAG);
      } catch {
        // not supported — ignore
      }
    })();
  }, []);

  // Listen for SW background sync trigger
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if ((event.data as { type?: string })?.type === 'BACKGROUND_SYNC_TRIGGER') {
        void runSync();
      }
    };
    navigator.serviceWorker?.addEventListener('message', handler);
    return () => navigator.serviceWorker?.removeEventListener('message', handler);
  }, [runSync]);

  /** Sync on reconnect. */
  useEffect(() => {
    const wasOffline = !prevOnline.current;
    prevOnline.current = online;
    if (online && wasOffline) {
      void runSync();
    }
  }, [online, runSync]);

  /** Periodic sync when online. */
  useEffect(() => {
    if (!online) return;
    const timer = setInterval(() => void runSync(), SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [online, runSync]);

  /** Refresh counts on mount and periodically. */
  useEffect(() => {
    void refreshCounts();
    const timer = setInterval(() => void refreshCounts(), 5000);
    return () => clearInterval(timer);
  }, [refreshCounts]);

  return {
    health: health ?? DEFAULT_HEALTH,
    pendingCount,
    conflictCount,
    isSyncing: syncing,
    lastError,
    triggerSync: () => void runSync(),
  };
}

/**
 * After pulling ops, detect body conflicts via threeWayMerge and record them.
 * Heuristic: any entity where the store's body differs from a pending outbox op
 * for the same entity triggers a 3-way merge check.
 */
async function detectAndRecordConflicts(
  ctx: Awaited<ReturnType<typeof getSyncContext>>,
  pulled: number,
): Promise<void> {
  if (pulled === 0) return;

  const outboxPending = ctx.outbox.pending();
  if (outboxPending.length === 0) return;

  const outboxEntityIds = new Set(outboxPending.map((op) => op.entityId));

  for (const entityId of outboxEntityIds) {
    const localNote = ctx.store.getNote(entityId);
    if (!localNote) continue;

    // Find any pending outbox op that edits this note's body
    const localOp = outboxPending.find(
      (op) => op.entityId === entityId && op.domain === 'note' && op.opType === 'update',
    );
    if (!localOp) continue;

    const localPayload = localOp.payload as { body?: string };
    if (localPayload.body === undefined) continue;

    const currentBody = localNote.body;
    const localBody = localPayload.body;
    const baseBody = ''; // No true ancestor available; empty as approximation

    if (currentBody !== localBody && currentBody !== baseBody) {
      const mergeResult = threeWayMerge(baseBody, localBody, currentBody);
      if (!mergeResult.ok) {
        // Check we haven't already recorded this conflict
        const alreadyExists = await conflictStore.hasConflict(entityId, 'body');
        if (!alreadyExists) {
          await conflictStore.add({
            entityId,
            domain: 'note',
            field: 'body',
            localText: mergeResult.localText,
            remoteText: mergeResult.remoteText,
            baseText: mergeResult.baseText,
            localLamport: localOp.lamport,
            remoteLamport: 0,
          });
        }
      }
    }
  }
}
