/**
 * Habit + reminder helpers (Epic 18, F1773/F1775/F1776/F1777).
 *
 * Pure logic for the habit features the PWA notification layer drives:
 *   - best-time suggestion from review timestamps (F1773),
 *   - non-nagging reminder copy variants (F1777),
 *   - a weekly learning digest in markdown (F1775),
 *   - quiet-hours check (F1776).
 *
 * No I/O — callers pass in the data.
 */

/** The hour (0–23, UTC) the user most often reviews, with its review count. */
export function bestReviewHour(timestamps: string[]): { hour: number; count: number } | null {
  if (timestamps.length === 0) return null;
  const byHour = new Array<number>(24).fill(0);
  for (const ts of timestamps) {
    const h = new Date(ts).getUTCHours();
    if (h >= 0 && h < 24) byHour[h]!++;
  }
  let best = 0;
  for (let h = 1; h < 24; h++) if (byHour[h]! > byHour[best]!) best = h;
  return { hour: best, count: byHour[best]! };
}

/** Non-nagging reminder copy variants (F1777) — encouraging, never guilt-trippy. */
export const REMINDER_VARIANTS: readonly string[] = [
  'A few cards are ready when you are.',
  'Your memories are waiting — a quick visit keeps them fresh.',
  'Five minutes now saves an hour of re-learning later.',
  'Ready for a short review? No pressure.',
  'Your future self will thank you for a quick pass.',
  'A small review today keeps the streak alive.',
];

/**
 * Pick a reminder line for the current state. When nothing is due, returns null
 * (don't notify). The streak gets a gentle nod when it's going.
 */
export function pickReminder(
  dueCount: number,
  streak: number,
  seed = Date.now(),
): { text: string; dueCount: number } | null {
  if (dueCount <= 0) return null;
  const variants = streak >= 2 ? REMINDER_VARIANTS : REMINDER_VARIANTS.slice(0, -1);
  const text = variants[Math.abs(seed) % variants.length]!;
  return { text, dueCount };
}

export interface DigestStats {
  reviews: number;
  retention: number;
  streak: number;
  newCards: number;
  dueTomorrow: number;
}

/** A friendly weekly learning digest in markdown (F1775). */
export function weeklyDigest(stats: DigestStats, weekEnding: string): string {
  const pct = Math.round(stats.retention * 100);
  const lines = [
    `# Weekly learning digest — week ending ${weekEnding.slice(0, 10)}`,
    '',
    `You reviewed **${stats.reviews}** card${stats.reviews === 1 ? '' : 's'} this week`,
    `with a true retention of **${pct}%**.`,
    '',
    stats.streak > 0
      ? `Your review streak is **${stats.streak} day${stats.streak === 1 ? '' : 's'}** — nicely done.`
      : 'No streak yet this week — a single short session starts one.',
    '',
    `- New cards learned: ${stats.newCards}`,
    `- Due tomorrow: ${stats.dueTomorrow}`,
    '',
    '_Generated locally by Fables. Nothing here left your device._',
  ];
  return lines.join('\n');
}

/**
 * Whether `now` falls within the quiet-hours window (F1776). Hours are UTC 0–23.
 * Supports windows that wrap past midnight (e.g. 22 → 7).
 */
export function inQuietHours(now: string, quietStart: number, quietEnd: number): boolean {
  if (quietStart === quietEnd) return false;
  const h = new Date(now).getUTCHours();
  return quietStart < quietEnd ? h >= quietStart && h < quietEnd : h >= quietStart || h < quietEnd;
}
