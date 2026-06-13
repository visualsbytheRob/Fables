/**
 * Initial hydration: bulk pulls notes/notebooks/entities into IDB (F822).
 * Also handles read-through logic (F823) — UI reads IDB first, network refreshes.
 */

import {
  notesStore,
  notebooksStore,
  entitiesStore,
  storiesStore,
  attachmentsStore,
  markHydrated,
  getLastHydration,
  requestStoragePersistence,
  type IdbNote,
  type IdbNotebook,
  type IdbEntity,
  type IdbStory,
  type IdbAttachment,
} from './idb.js';

const HYDRATION_TTL_MS = 5 * 60 * 1000; // Re-hydrate if data is older than 5 minutes

export async function hydrateIfStale(): Promise<void> {
  const last = await getLastHydration();
  if (last !== null && Date.now() - last < HYDRATION_TTL_MS) return;
  await hydrateAll();
}

/** Bulk pull all data from the server into IDB. */
export async function hydrateAll(): Promise<void> {
  // Request persistent storage to avoid eviction
  await requestStoragePersistence();

  await Promise.allSettled([hydrateNotes(), hydrateNotebooks(), hydrateEntities()]);

  await markHydrated();
}

async function hydrateNotes(): Promise<void> {
  try {
    const res = await fetch('/api/v1/notes?limit=500', {
      headers: { 'content-type': 'application/json' },
    });
    if (!res.ok) return;
    const body = (await res.json()) as { data?: unknown[] };
    const notes = (body.data ?? []) as IdbNote[];
    await notesStore.bulkPut(notes.map((n) => ({ ...n, _syncedAt: Date.now() })));
  } catch {
    // offline — skip
  }
}

async function hydrateNotebooks(): Promise<void> {
  try {
    const res = await fetch('/api/v1/notebooks', {
      headers: { 'content-type': 'application/json' },
    });
    if (!res.ok) return;
    const body = (await res.json()) as { data?: unknown[] };
    const notebooks = (body.data ?? []) as IdbNotebook[];
    await notebooksStore.bulkPut(notebooks.map((nb) => ({ ...nb, _syncedAt: Date.now() })));
  } catch {
    // offline — skip
  }
}

async function hydrateEntities(): Promise<void> {
  try {
    const res = await fetch('/api/v1/entities?limit=500', {
      headers: { 'content-type': 'application/json' },
    });
    if (!res.ok) return;
    const body = (await res.json()) as { data?: unknown[] };
    const entities = (body.data ?? []) as IdbEntity[];
    await entitiesStore.bulkPut(entities.map((e) => ({ ...e, _syncedAt: Date.now() })));
  } catch {
    // offline — skip
  }
}

export async function hydrateStories(stories: IdbStory[]): Promise<void> {
  await storiesStore.bulkPut(stories);
}

export async function hydrateAttachments(attachments: IdbAttachment[]): Promise<void> {
  await attachmentsStore.bulkPut(attachments);
}
