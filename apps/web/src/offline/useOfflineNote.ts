/**
 * Offline-capable note mutation hook (F851–F852).
 * When online: calls the API directly + updates IDB as a side effect.
 * When offline: writes to IDB optimistically + enqueues to outbox.
 */

import { useCallback } from 'react';
import { useOnlineStatus } from './useOnlineStatus.js';
import { notesStore, outboxStore, type IdbNote } from './idb.js';
import type { NotePatch } from '../api/client.js';

export interface OfflineNoteMutations {
  patchNote: (id: string, patch: NotePatch, currentBody: IdbNote) => Promise<void>;
}

export function useOfflineNote(): OfflineNoteMutations {
  const online = useOnlineStatus();

  const patchNote = useCallback(
    async (id: string, patch: NotePatch, current: IdbNote): Promise<void> => {
      if (online) {
        // Online path: let the existing API mutation handle it;
        // IDB will be updated by the hydration refresh.
        return;
      }

      // Offline path: write to IDB + outbox
      const updated: IdbNote = {
        ...current,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
        ...(patch.notebookId !== undefined ? { notebookId: patch.notebookId } : {}),
        rev: current.rev, // rev stays the same until server confirms
        updatedAt: new Date().toISOString(),
        _syncedAt: Date.now(),
      };

      await notesStore.put(updated);
      await outboxStore.enqueue('notes', 'patch', id, patch);
    },
    [online],
  );

  return { patchNote };
}
