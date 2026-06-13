/**
 * F971–F979 — Local-only usage analytics.
 *
 * Everything here is stored in localStorage; no network egress ever occurs.
 * An opt-out flag disables all recording. Analytics are purely local: feature
 * counters, hourly activity buckets, slow-op logs, client-side error records.
 *
 * Privacy guarantee: this module NEVER calls fetch/XMLHttpRequest/sendBeacon.
 * All data lives exclusively in window.localStorage under the 'fables.analytics.*' prefix.
 */

// ──────────────────────────────────────────────
// Storage helpers
// ──────────────────────────────────────────────

const PREFIX = 'fables.analytics';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`${PREFIX}.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(`${PREFIX}.${key}`, JSON.stringify(value));
  } catch {
    // Quota exceeded or private mode — fail silently.
  }
}

// ──────────────────────────────────────────────
// Opt-out (F978)
// ──────────────────────────────────────────────

const OPT_OUT_KEY = 'optOut';

export function isOptedOut(): boolean {
  return read<boolean>(OPT_OUT_KEY, false);
}

export function setOptOut(value: boolean): void {
  write(OPT_OUT_KEY, value);
  if (value) purgeAll();
}

// ──────────────────────────────────────────────
// Feature counters (F971)
// ──────────────────────────────────────────────

export type FeatureId = string;

export interface FeatureCounter {
  id: FeatureId;
  count: number;
  lastUsedAt: string; // ISO
}

const COUNTERS_KEY = 'counters';

export function loadCounters(): Record<FeatureId, FeatureCounter> {
  return read<Record<FeatureId, FeatureCounter>>(COUNTERS_KEY, {});
}

/**
 * Record one use of a named feature.
 * No-ops when the user has opted out.
 */
export function recordFeatureUse(id: FeatureId): void {
  if (isOptedOut()) return;
  const counters = loadCounters();
  const existing = counters[id] ?? { id, count: 0, lastUsedAt: '' };
  counters[id] = { id, count: existing.count + 1, lastUsedAt: new Date().toISOString() };
  write(COUNTERS_KEY, counters);
}

/** Top N feature IDs by use count, descending. */
export function topFeatures(n = 10): FeatureCounter[] {
  return Object.values(loadCounters())
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

// ──────────────────────────────────────────────
// Hourly activity (F972)
// ──────────────────────────────────────────────

const HOURLY_KEY = 'hourly';
const MAX_HOURLY_DAYS = 90; // ~2160 buckets

export interface HourlyBucket {
  /** YYYY-MM-DDTHH key (UTC hour). */
  hour: string;
  count: number;
}

export function loadHourlyActivity(): HourlyBucket[] {
  return read<HourlyBucket[]>(HOURLY_KEY, []);
}

export function recordActivity(): void {
  if (isOptedOut()) return;
  const hour = new Date().toISOString().slice(0, 13); // "2026-06-13T09"
  const buckets = loadHourlyActivity();
  const existing = buckets.find((b) => b.hour === hour);
  if (existing) {
    existing.count += 1;
  } else {
    buckets.push({ hour, count: 1 });
  }
  // Prune old buckets
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_HOURLY_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 13);
  const pruned = buckets.filter((b) => b.hour >= cutoffStr);
  write(HOURLY_KEY, pruned);
}

/** Returns a map of hour-of-day (0–23) → total events across the stored window. */
export function activityByHour(): Record<number, number> {
  const result: Record<number, number> = {};
  for (const b of loadHourlyActivity()) {
    const h = parseInt(b.hour.slice(11, 13), 10);
    result[h] = (result[h] ?? 0) + b.count;
  }
  return result;
}

// ──────────────────────────────────────────────
// Slow-op log / performance percentiles (F975)
// ──────────────────────────────────────────────

export interface SlowOp {
  op: string;
  durationMs: number;
  recordedAt: string;
}

const SLOW_OPS_KEY = 'slowOps';
const MAX_SLOW_OPS = 200;
const SLOW_THRESHOLD_MS = 500;

export function recordSlowOp(op: string, durationMs: number): void {
  if (isOptedOut()) return;
  if (durationMs < SLOW_THRESHOLD_MS) return;
  const ops = read<SlowOp[]>(SLOW_OPS_KEY, []);
  ops.push({ op, durationMs, recordedAt: new Date().toISOString() });
  // Keep newest
  if (ops.length > MAX_SLOW_OPS) ops.splice(0, ops.length - MAX_SLOW_OPS);
  write(SLOW_OPS_KEY, ops);
}

export function loadSlowOps(): SlowOp[] {
  return read<SlowOp[]>(SLOW_OPS_KEY, []);
}

/** p50/p90/p99 percentiles for a named op over the stored window. */
export function opPercentiles(op: string): { p50: number; p90: number; p99: number } | null {
  const ops = loadSlowOps()
    .filter((o) => o.op === op)
    .map((o) => o.durationMs)
    .sort((a, b) => a - b);
  if (ops.length === 0) return null;
  const p = (pct: number) => ops[Math.floor((ops.length - 1) * pct)] ?? ops[ops.length - 1]!;
  return { p50: p(0.5), p90: p(0.9), p99: p(0.99) };
}

// ──────────────────────────────────────────────
// Client error aggregation (F976)
// ──────────────────────────────────────────────

export interface ClientError {
  message: string;
  stack: string | null;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

const ERRORS_KEY = 'errors';
const MAX_ERROR_GROUPS = 50;

export function recordClientError(message: string, stack?: string): void {
  if (isOptedOut()) return;
  const errors = read<ClientError[]>(ERRORS_KEY, []);
  const existing = errors.find((e) => e.message === message);
  if (existing) {
    existing.count += 1;
    existing.lastSeenAt = new Date().toISOString();
  } else {
    errors.push({
      message,
      stack: stack ?? null,
      count: 1,
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
  }
  if (errors.length > MAX_ERROR_GROUPS) errors.splice(0, errors.length - MAX_ERROR_GROUPS);
  write(ERRORS_KEY, errors);
}

export function loadClientErrors(): ClientError[] {
  return read<ClientError[]>(ERRORS_KEY, []);
}

// ──────────────────────────────────────────────
// Data retention + purge (F977)
// ──────────────────────────────────────────────

/** Purge all stored analytics data (called on opt-out or explicit clear). */
export function purgeAll(): void {
  write(COUNTERS_KEY, {});
  write(HOURLY_KEY, []);
  write(SLOW_OPS_KEY, []);
  write(ERRORS_KEY, []);
}

/** Purge records older than `days` days (leaves recent data intact). */
export function purgeOlderThan(days: number): void {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffIso = cutoff.toISOString();

  // Hourly activity
  const hourly = loadHourlyActivity().filter((b) => b.hour >= cutoffIso.slice(0, 13));
  write(HOURLY_KEY, hourly);

  // Slow ops
  const ops = loadSlowOps().filter((o) => o.recordedAt >= cutoffIso);
  write(SLOW_OPS_KEY, ops);

  // Errors: only last-seen cutoff
  const errors = loadClientErrors().filter((e) => e.lastSeenAt >= cutoffIso);
  write(ERRORS_KEY, errors);
}
