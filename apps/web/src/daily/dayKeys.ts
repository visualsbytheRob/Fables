/**
 * Daily-note day-key logic (F251–F259): pure, local-timezone date math over
 * `YYYY-MM-DD` keys so the journal flows are trivially testable.
 */

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number): string => String(n).padStart(2, '0');

/** Local-timezone day key for a date. */
export const dayKey = (date: Date = new Date()): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const isDayKey = (value: string): boolean => {
  const m = DAY_KEY_RE.exec(value);
  if (!m) return false;
  const d = parseDayKey(value);
  return d !== null;
};

/** Parses a key to a local Date at midnight; null for invalid dates. */
export function parseDayKey(key: string): Date | null {
  const m = DAY_KEY_RE.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

export function addDays(key: string, days: number): string {
  const date = parseDayKey(key);
  if (!date) return key;
  date.setDate(date.getDate() + days);
  return dayKey(date);
}

/** Monday-first calendar week containing `key` (F258). */
export function weekKeys(key: string): string[] {
  const date = parseDayKey(key);
  if (!date) return [];
  const dow = (date.getDay() + 6) % 7; // Monday = 0
  const monday = addDays(key, -dow);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/**
 * Month grid for a calendar widget (F253): Monday-first weeks; cells outside
 * the month are null. `month` is `YYYY-MM`.
 */
export function monthMatrix(month: string): (string | null)[][] {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return [];
  const year = Number(m[1]);
  const mon = Number(m[2]) - 1;
  const first = new Date(year, mon, 1);
  const daysInMonth = new Date(year, mon + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // Monday-first offset
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${m[1]}-${m[2]}-${pad(i + 1)}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export const monthOf = (key: string): string => key.slice(0, 7);

export function addMonths(month: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  const year = Math.floor(total / 12);
  return `${year}-${pad((total % 12) + 1)}`;
}

/**
 * Consecutive journaling days ending at `today` — or at yesterday, so the
 * streak isn't broken before today's entry is written (F255).
 */
export function streak(daysWithNotes: ReadonlySet<string>, today: string): number {
  let start = today;
  if (!daysWithNotes.has(start)) start = addDays(today, -1);
  let count = 0;
  let cursor = start;
  while (daysWithNotes.has(cursor)) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

/** Past years' keys sharing `key`'s month + day, newest first (F259). */
export function onThisDayKeys(key: string, yearsBack = 10): string[] {
  const date = parseDayKey(key);
  if (!date) return [];
  const out: string[] = [];
  for (let i = 1; i <= yearsBack; i += 1) {
    const candidate = `${date.getFullYear() - i}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    if (parseDayKey(candidate) !== null) out.push(candidate);
  }
  return out;
}

/** Daily-note body from configurable sections (F254/F257). */
export function dailyBody(key: string, sections: string[]): string {
  const heads = sections
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map((s) => `## ${s}\n`);
  return `# ${key}\n\n${heads.join('\n')}`;
}

/** Human label like "June 2026" for a `YYYY-MM` month. */
export function monthLabel(month: string): string {
  const date = parseDayKey(`${month}-01`);
  if (!date) return month;
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** Short weekday/day label for week view rows. */
export function dayLabel(key: string): string {
  const date = parseDayKey(key);
  if (!date) return key;
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
