/**
 * Pure timeline grouping + formatting helpers (F653, F654, F658). Kept free of
 * React/DOM so they're trivially unit-testable. `rebucket` re-groups already
 * fetched rows by a client-side zoom level; `rowHref` resolves the click-through
 * target for a row; `formatDayHeading` renders a bucket key into a heading.
 */
import type { TimelineGroup, TimelineRow, TimelineType } from './api.js';

export type Zoom = 'day' | 'week' | 'month' | 'year';

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * ISO-8601 week number (Mon-first). Returns `{ year, week }` where `year` is the
 * ISO week-numbering year (which can differ from the calendar year near Jan/Dec).
 */
export function isoWeek(date: Date): { year: number; week: number } {
  // Copy so we don't mutate the input, and work in UTC to avoid DST drift.
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon = 0 … Sun = 6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // nearest Thursday
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return { year: isoYear, week };
}

/**
 * Bucket key for a date at the chosen zoom level:
 * - day   -> `YYYY-MM-DD`
 * - week  -> `YYYY-Www` (ISO week)
 * - month -> `YYYY-MM`
 * - year  -> `YYYY`
 */
export function bucketKey(date: Date, zoom: Zoom): string {
  const y = date.getFullYear();
  switch (zoom) {
    case 'day':
      return `${y}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    case 'week': {
      const { year, week } = isoWeek(date);
      return `${year}-W${pad(week)}`;
    }
    case 'month':
      return `${y}-${pad(date.getMonth() + 1)}`;
    case 'year':
      return String(y);
  }
}

/**
 * Re-group already-fetched rows into buckets of the chosen zoom level. The input
 * groups are flattened and re-bucketed by each row's `at` timestamp. Buckets are
 * returned newest-first, and rows within a bucket are sorted newest-first.
 */
export function rebucket(groups: readonly TimelineGroup[], zoom: Zoom): TimelineGroup[] {
  const rows: TimelineRow[] = groups.flatMap((g) => g.events);
  const byKey = new Map<string, TimelineRow[]>();
  for (const row of rows) {
    const date = new Date(row.at);
    const key = Number.isNaN(date.getTime())
      ? row.at.slice(0, 10) // fall back to the date portion of the raw string
      : bucketKey(date, zoom);
    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  }
  const out: TimelineGroup[] = [];
  for (const [dayKey, events] of byKey) {
    events.sort((a, b) => b.at.localeCompare(a.at));
    out.push({ dayKey, events });
  }
  out.sort((a, b) => b.dayKey.localeCompare(a.dayKey));
  return out;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Render a bucket key into a human heading. Handles every zoom-level key shape:
 * - `YYYY-MM-DD` -> "Mon 13 Jun 2026"
 * - `YYYY-Www`   -> "Week 24 · 2026"
 * - `YYYY-MM`    -> "June 2026"
 * - `YYYY`       -> "2026"
 */
export function formatDayHeading(dayKey: string): string {
  const week = /^(\d{4})-W(\d{2})$/.exec(dayKey);
  if (week) return `Week ${Number(week[2])} · ${week[1]}`;

  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (day) {
    const year = Number(day[1]);
    const month = Number(day[2]) - 1;
    const date = Number(day[3]);
    const d = new Date(year, month, date);
    return `${WEEKDAYS[d.getDay()]} ${date} ${MONTHS[month]} ${year}`;
  }

  const month = /^(\d{4})-(\d{2})$/.exec(dayKey);
  if (month) {
    const m = Number(month[2]) - 1;
    return `${MONTHS_LONG[m] ?? month[2]} ${month[1]}`;
  }

  if (/^\d{4}$/.test(dayKey)) return dayKey;

  return dayKey;
}

/**
 * Resolve the click-through destination for a row (F654):
 * - notes        -> `/notes/:refId`
 * - stories      -> `/stories/:refId`
 * - playthroughs -> `/stories/:storyId/play` (storyId from `meta.storyId`, else refId)
 */
export function rowHref(row: TimelineRow): string {
  switch (row.type) {
    case 'notes':
      return `/notes/${row.refId}`;
    case 'stories':
      return `/stories/${row.refId}`;
    case 'playthroughs': {
      const storyId =
        typeof row.meta.storyId === 'string' && row.meta.storyId !== ''
          ? row.meta.storyId
          : row.refId;
      return `/stories/${storyId}/play`;
    }
  }
}

/** Short clock label like "14:05" for a timestamp; falls back to "" if unparseable. */
export function formatClock(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Filter rows down to the active types (F651, client mirror of the server param). */
export function filterByTypes(
  groups: readonly TimelineGroup[],
  active: readonly TimelineType[],
): TimelineGroup[] {
  const set = new Set(active);
  return groups
    .map((g) => ({ dayKey: g.dayKey, events: g.events.filter((e) => set.has(e.type)) }))
    .filter((g) => g.events.length > 0);
}
