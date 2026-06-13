/**
 * Lore visit tracking (F627): which `[[lore]]` notes the reader has opened in a
 * given story. Used to dim already-read lore links and to drive a small "lore
 * discovered" stat. Storage-injectable so it unit-tests without a DOM.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const defaultStorage = (): StorageLike | null =>
  typeof localStorage === 'undefined' ? null : localStorage;

const key = (storyId: string): string => `fables.lorevisits.${storyId}`;

export function loadLoreVisits(
  storyId: string,
  store: StorageLike | null = defaultStorage(),
): Set<string> {
  if (store === null) return new Set();
  try {
    const raw = store.getItem(key(storyId));
    if (raw === null) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? new Set(parsed.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

/** Mark a lore note title visited; returns the updated set. */
export function markLoreVisited(
  storyId: string,
  title: string,
  store: StorageLike | null = defaultStorage(),
): Set<string> {
  const visits = loadLoreVisits(storyId, store);
  visits.add(title);
  try {
    store?.setItem(key(storyId), JSON.stringify([...visits]));
  } catch {
    /* best-effort */
  }
  return visits;
}
