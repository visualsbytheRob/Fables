/**
 * Notes UI preferences in localStorage: expanded notebook ids (F142),
 * default capture notebook (F145), list sort/filter (F173), and the
 * recent-notes MRU (F177). All helpers swallow storage failures.
 */
import type { NoteSort } from '../api/client.js';

const read = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};

const write = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // non-fatal: prefs just won't persist
  }
};

/* ===== Expanded notebooks (F142) ===== */

const EXPANDED_KEY = 'fables.notes.expandedNotebooks';

export const loadExpanded = (): Set<string> => new Set(read<string[]>(EXPANDED_KEY, []));

export const saveExpanded = (ids: Set<string>): void => write(EXPANDED_KEY, [...ids]);

/* ===== Default capture notebook (F145) ===== */

const DEFAULT_NOTEBOOK_KEY = 'fables.notes.defaultNotebook';

export const loadDefaultNotebook = (): string | null =>
  read<string | null>(DEFAULT_NOTEBOOK_KEY, null);

export const saveDefaultNotebook = (id: string | null): void => write(DEFAULT_NOTEBOOK_KEY, id);

/* ===== List sort (F173) ===== */

const SORT_KEY = 'fables.notes.sort';

export const loadSort = (): NoteSort => {
  const value = read<string>(SORT_KEY, 'updated');
  return value === 'created' || value === 'title' ? value : 'updated';
};

export const saveSort = (sort: NoteSort): void => write(SORT_KEY, sort);

/* ===== Recent notes MRU (F177) ===== */

const RECENTS_KEY = 'fables.notes.recents';
const MAX_RECENTS = 8;

export const loadRecents = (): string[] => read<string[]>(RECENTS_KEY, []);

/** Pushes `id` to the front of the MRU, deduplicated and capped. */
export function pushRecent(id: string): string[] {
  const next = [id, ...loadRecents().filter((x) => x !== id)].slice(0, MAX_RECENTS);
  write(RECENTS_KEY, next);
  return next;
}

export function removeRecent(id: string): string[] {
  const next = loadRecents().filter((x) => x !== id);
  write(RECENTS_KEY, next);
  return next;
}
