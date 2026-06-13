/** localStorage helper for recent search queries (F715). */

const KEY = 'fables:recent-searches';
const MAX = 12;

export function getRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function addRecentSearch(query: string): void {
  const trimmed = query.trim();
  if (!trimmed) return;
  const prev = getRecentSearches().filter((q) => q !== trimmed);
  const next = [trimmed, ...prev].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore quota errors
  }
}

export function clearRecentSearches(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** Zero-result logging (F720). */
const ZERO_KEY = 'fables:zero-result-queries';

export function logZeroResult(query: string): void {
  try {
    const raw = localStorage.getItem(ZERO_KEY);
    const prev: { q: string; at: string }[] = raw ? JSON.parse(raw) : [];
    const next = [{ q: query, at: new Date().toISOString() }, ...prev].slice(0, 50);
    localStorage.setItem(ZERO_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}
