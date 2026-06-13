/**
 * useConflicts() — React hook to subscribe to pending sync conflicts (F844/F845).
 *
 * Loads conflicts from the IDB-backed conflictStore and refreshes periodically.
 * Components can use this to show badges, notifications, or the review panel.
 */

import { useState, useEffect, useCallback } from 'react';
import { conflictStore } from './conflictStore.js';
import type { SyncConflict } from './conflictStore.js';

export function useConflicts(): {
  pending: SyncConflict[];
  count: number;
  refresh: () => void;
} {
  const [pending, setPending] = useState<SyncConflict[]>([]);

  const refresh = useCallback(() => {
    void conflictStore.listPending().then((c) => setPending(c));
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 10_000);
    return () => clearInterval(timer);
  }, [refresh]);

  return { pending, count: pending.length, refresh };
}

/**
 * Check whether a specific entity has a pending sync conflict.
 * Returns the conflicting fields (empty array = no conflict).
 */
export function useEntityConflicts(entityId: string): {
  hasConflict: boolean;
  conflictFields: string[];
  conflicts: SyncConflict[];
} {
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);

  useEffect(() => {
    const load = async () => {
      const pending = await conflictStore.listPending();
      setConflicts(pending.filter((c) => c.entityId === entityId));
    };
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [entityId]);

  return {
    hasConflict: conflicts.length > 0,
    conflictFields: conflicts.map((c) => c.field),
    conflicts,
  };
}
