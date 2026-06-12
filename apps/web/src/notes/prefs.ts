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

/* ===== Backlinks panel (F218) ===== */

const BACKLINKS_KEY = 'fables.notes.backlinksPanel';

export interface BacklinksPanelState {
  open: boolean;
  /** Per-section collapse: linked / mentions / graph. */
  collapsed: Record<string, boolean>;
}

export const loadBacklinksPanel = (): BacklinksPanelState =>
  read<BacklinksPanelState>(BACKLINKS_KEY, { open: false, collapsed: {} });

export const saveBacklinksPanel = (state: BacklinksPanelState): void => write(BACKLINKS_KEY, state);

/* ===== Daily note template sections (F254) ===== */

const DAILY_SECTIONS_KEY = 'fables.daily.sections';

export const defaultDailySections = ['Tasks', 'Notes', 'Journal'];

export const loadDailySections = (): string[] => {
  const value = read<string[]>(DAILY_SECTIONS_KEY, defaultDailySections);
  return Array.isArray(value) && value.every((s) => typeof s === 'string')
    ? value
    : defaultDailySections;
};

export const saveDailySections = (sections: string[]): void => write(DAILY_SECTIONS_KEY, sections);

/* ===== Default template per notebook (F269) ===== */

const DEFAULT_TEMPLATES_KEY = 'fables.templates.defaults';

/** notebookId → template note id. */
export const loadDefaultTemplates = (): Record<string, string> =>
  read<Record<string, string>>(DEFAULT_TEMPLATES_KEY, {});

export const saveDefaultTemplate = (notebookId: string, templateId: string | null): void => {
  const map = loadDefaultTemplates();
  if (templateId === null) delete map[notebookId];
  else map[notebookId] = templateId;
  write(DEFAULT_TEMPLATES_KEY, map);
};
