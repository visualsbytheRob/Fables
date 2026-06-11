export function nowIso(): string {
  return new Date().toISOString();
}

/** Calendar day key in local time, e.g. `2026-06-11` — the daily-note identity. */
export function dayKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseDayKey(key: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) throw new RangeError(`invalid day key: ${key}`);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

const UNITS: [limitSeconds: number, divisor: number, unit: string][] = [
  [60, 1, 'second'],
  [3600, 60, 'minute'],
  [86400, 3600, 'hour'],
  [604800, 86400, 'day'],
  [2629800, 604800, 'week'],
  [31557600, 2629800, 'month'],
  [Infinity, 31557600, 'year'],
];

/** Human-relative formatting: "just now", "5 minutes ago", "in 2 days". */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const deltaSeconds = Math.round((now.getTime() - then) / 1000);
  const past = deltaSeconds >= 0;
  const abs = Math.abs(deltaSeconds);
  if (abs < 10) return 'just now';
  for (const [limit, divisor, unit] of UNITS) {
    if (abs < limit) {
      const n = Math.floor(abs / divisor);
      const label = `${n} ${unit}${n === 1 ? '' : 's'}`;
      return past ? `${label} ago` : `in ${label}`;
    }
  }
  /* unreachable: last limit is Infinity */
  return iso;
}
