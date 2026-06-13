/**
 * Player-side persistence (F549/F553/F563/F568/F575/F577/F578): reader
 * preferences, per-story endings, bookmarks, reading stats, finished
 * playthrough transcripts and library metadata, all in localStorage.
 *
 * Library metadata (author/tags/content notes/archived) lives here because
 * the server's story `settings` schema is currently {cover, theme, seedMode,
 * seed}; the client mirrors what it can into the server and keeps the rest
 * local. (Flagged for the server lane — see day-6 devlog.)
 */

function loadJson<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / private mode — prefs are best-effort */
  }
}

/* ── reader preferences (F542/F551/F553/F597) ──────────────────────────── */

export const PLAYER_THEMES = ['serif', 'parchment', 'terminal', 'dark'] as const;
export type PlayerTheme = (typeof PLAYER_THEMES)[number];

export const THEME_LABELS: Readonly<Record<PlayerTheme, string>> = {
  serif: 'Serif book',
  parchment: 'Parchment',
  terminal: 'Terminal',
  dark: 'Midnight',
};

export type Pacing = 'instant' | 'fast' | 'medium' | 'slow';

/** Delay between paragraph reveals, per pacing setting (F542). */
export const PACING_MS: Readonly<Record<Pacing, number>> = {
  instant: 0,
  fast: 120,
  medium: 280,
  slow: 520,
};

export interface ReaderPrefs {
  theme: PlayerTheme;
  /** Body size in px (F553). */
  textSize: number;
  lineHeight: number;
  pacing: Pacing;
  /** Web Speech voice URI; null picks the platform default (F597). */
  ttsVoice: string | null;
  ttsRate: number;
  /** Show undiscovered-endings counts on the end screen (F568). */
  endingHints: boolean;
}

export const DEFAULT_PREFS: ReaderPrefs = {
  theme: 'serif',
  textSize: 18,
  lineHeight: 1.6,
  pacing: 'medium',
  ttsVoice: null,
  ttsRate: 1,
  endingHints: false,
};

const PREFS_KEY = 'fables.player.prefs';

export function loadPrefs(): ReaderPrefs {
  const stored = loadJson<Partial<ReaderPrefs>>(PREFS_KEY, {});
  const theme = (PLAYER_THEMES as readonly string[]).includes(stored.theme ?? '')
    ? (stored.theme as PlayerTheme)
    : DEFAULT_PREFS.theme;
  return { ...DEFAULT_PREFS, ...stored, theme };
}

export function savePrefs(prefs: ReaderPrefs): void {
  saveJson(PREFS_KEY, prefs);
}

/* ── endings collection (F568) ─────────────────────────────────────────── */

export interface EndingRecord {
  readonly id: string;
  readonly label: string;
  readonly firstReachedAt: string;
  readonly timesReached: number;
}

const endingsKey = (storyId: string) => `fables.player.endings.${storyId}`;

export function loadEndings(storyId: string): EndingRecord[] {
  return loadJson<EndingRecord[]>(endingsKey(storyId), []);
}

export function recordEnding(storyId: string, id: string, label: string): EndingRecord[] {
  const endings = loadEndings(storyId);
  const existing = endings.find((e) => e.id === id);
  const next =
    existing !== undefined
      ? endings.map((e) => (e.id === id ? { ...e, timesReached: e.timesReached + 1 } : e))
      : [
          ...endings,
          { id, label, firstReachedAt: new Date().toISOString(), timesReached: 1 },
        ];
  saveJson(endingsKey(storyId), next);
  return next;
}

/* ── bookmarks (F563/F564) ─────────────────────────────────────────────── */

export interface Bookmark {
  readonly id: string;
  /** Server save-slot id holding the full state for jump-to. */
  readonly saveId: string;
  readonly note: string;
  readonly turn: number;
  readonly scene: string;
  readonly createdAt: string;
}

const bookmarksKey = (storyId: string) => `fables.player.bookmarks.${storyId}`;

export function loadBookmarks(storyId: string): Bookmark[] {
  return loadJson<Bookmark[]>(bookmarksKey(storyId), []);
}

export function addBookmark(storyId: string, bookmark: Bookmark): Bookmark[] {
  const next = [bookmark, ...loadBookmarks(storyId)];
  saveJson(bookmarksKey(storyId), next);
  return next;
}

export function removeBookmark(storyId: string, id: string): Bookmark[] {
  const next = loadBookmarks(storyId).filter((b) => b.id !== id);
  saveJson(bookmarksKey(storyId), next);
  return next;
}

/* ── reading stats (F577) ──────────────────────────────────────────────── */

export interface ReadingStats {
  secondsRead: number;
  choicesMade: number;
  runsStarted: number;
  runsFinished: number;
  lastPlayedAt: string | null;
}

export const EMPTY_STATS: ReadingStats = {
  secondsRead: 0,
  choicesMade: 0,
  runsStarted: 0,
  runsFinished: 0,
  lastPlayedAt: null,
};

const statsKey = (storyId: string) => `fables.player.stats.${storyId}`;

export function loadStats(storyId: string): ReadingStats {
  return { ...EMPTY_STATS, ...loadJson<Partial<ReadingStats>>(statsKey(storyId), {}) };
}

export function bumpStats(storyId: string, delta: Partial<ReadingStats>): ReadingStats {
  const current = loadStats(storyId);
  const next: ReadingStats = {
    secondsRead: current.secondsRead + (delta.secondsRead ?? 0),
    choicesMade: current.choicesMade + (delta.choicesMade ?? 0),
    runsStarted: current.runsStarted + (delta.runsStarted ?? 0),
    runsFinished: current.runsFinished + (delta.runsFinished ?? 0),
    lastPlayedAt: new Date().toISOString(),
  };
  saveJson(statsKey(storyId), next);
  return next;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/* ── continue-reading rail (F575) ──────────────────────────────────────── */

export interface RecentPlay {
  readonly storyId: string;
  readonly title: string;
  readonly scene: string;
  readonly turn: number;
  readonly at: string;
}

const RECENTS_KEY = 'fables.player.recents';
const RECENTS_MAX = 8;

export function loadRecents(): RecentPlay[] {
  return loadJson<RecentPlay[]>(RECENTS_KEY, []);
}

export function recordRecent(play: RecentPlay): void {
  const next = [play, ...loadRecents().filter((r) => r.storyId !== play.storyId)].slice(
    0,
    RECENTS_MAX,
  );
  saveJson(RECENTS_KEY, next);
}

export function clearRecent(storyId: string): void {
  saveJson(
    RECENTS_KEY,
    loadRecents().filter((r) => r.storyId !== storyId),
  );
}

/* ── finished playthrough transcripts (F569) ───────────────────────────── */

export interface Playthrough {
  readonly id: string;
  readonly endedAt: string;
  readonly ending: string;
  readonly transcript: string;
}

const playthroughsKey = (storyId: string) => `fables.player.playthroughs.${storyId}`;
const PLAYTHROUGHS_MAX = 6;

export function loadPlaythroughs(storyId: string): Playthrough[] {
  return loadJson<Playthrough[]>(playthroughsKey(storyId), []);
}

export function recordPlaythrough(storyId: string, play: Omit<Playthrough, 'id'>): Playthrough[] {
  const saved: Playthrough = {
    ...play,
    id: `pt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  };
  const next = [saved, ...loadPlaythroughs(storyId)].slice(0, PLAYTHROUGHS_MAX);
  saveJson(playthroughsKey(storyId), next);
  return next;
}

/* ── library metadata (F573/F578) ──────────────────────────────────────── */

export interface LibraryMeta {
  author: string;
  tags: string[];
  contentNotes: string;
  archived: boolean;
}

export const EMPTY_META: LibraryMeta = { author: '', tags: [], contentNotes: '', archived: false };

const metaKey = (storyId: string) => `fables.library.meta.${storyId}`;

export function loadLibraryMeta(storyId: string): LibraryMeta {
  return { ...EMPTY_META, ...loadJson<Partial<LibraryMeta>>(metaKey(storyId), {}) };
}

export function saveLibraryMeta(storyId: string, meta: LibraryMeta): void {
  saveJson(metaKey(storyId), meta);
}
