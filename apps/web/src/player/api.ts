/**
 * Player-facing API surface (F544/F549/F563): save slots + the autosave ring
 * buffer (server lane F462/F463). Save `state` payloads are the forge-vm
 * serialized save state, opaque to this module.
 */
import type { StorySaveState } from '@fables/forge-vm';
import { api } from '../api/client.js';

export type SaveKind = 'slot' | 'auto';

export interface StorySaveMeta {
  id: string;
  storyId: string;
  kind: SaveKind;
  name: string;
  turn: number;
  /** Knot of the saved flow position — a human "where am I" hint. */
  scene: string;
  createdAt: string;
  updatedAt: string;
}

export type StorySave = StorySaveMeta & { state: StorySaveState };

export const savesApi = {
  list: (storyId: string, kind?: SaveKind) =>
    api.get<StorySaveMeta[]>(`/stories/${storyId}/saves${kind !== undefined ? `?kind=${kind}` : ''}`),
  get: (storyId: string, saveId: string) =>
    api.get<StorySave>(`/stories/${storyId}/saves/${saveId}`),
  /** Named slots overwrite on name collision — that is what slots are for. */
  createSlot: (storyId: string, name: string, state: StorySaveState) =>
    api.post<StorySaveMeta>(`/stories/${storyId}/saves`, { name, state }),
  remove: (storyId: string, saveId: string) =>
    api.delete<{ id: string; deleted: boolean }>(`/stories/${storyId}/saves/${saveId}`),
  /** Reading-position persistence (F549): one PUT per choice. */
  autosave: (storyId: string, state: StorySaveState) =>
    api
      .put<{ save: StorySaveMeta; retained: number }>(`/stories/${storyId}/autosave`, { state })
      .then((r) => r.save),
};
