/**
 * Local analytics service (F971–F980).
 *
 * PRIVACY GUARANTEE: All data stays on the user's machine. There is NO network
 * egress. This module never calls fetch(), http, or any external API.
 * See docs/privacy/analytics.md for the full privacy statement.
 *
 * Features:
 *  F971 — Local-only usage stats: feature counters
 *  F972 — Stats dashboard data
 *  F973 — Knowledge growth metrics
 *  F974 — Story metrics
 *  F975 — Performance telemetry (slow ops)
 *  F976 — Error aggregation
 *  F977 — Data retention + purge
 *  F978 — Opt-out toggle
 */

import { createHash } from 'node:crypto';
import type { Db } from '../db/connection.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type EventType = 'feature_use' | 'slow_op' | 'error' | 'perf';

export interface AnalyticsEvent {
  id: string;
  eventType: EventType;
  category: string;
  label: string;
  value: number;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface AnalyticsSettings {
  enabled: boolean;
  retentionDays: number;
  updatedAt: string;
}

// ── ULID-lite for analytics IDs ───────────────────────────────────────────────

function analyticsId(): string {
  return `ae_${createHash('sha256')
    .update(crypto.randomUUID())
    .digest('hex')
    .slice(0, 20)}`;
}

// ── Settings ──────────────────────────────────────────────────────────────────

export function getAnalyticsSettings(db: Db): AnalyticsSettings {
  const row = db.prepare('SELECT * FROM analytics_settings WHERE id = 1').get() as {
    enabled: number;
    retention_days: number;
    updated_at: string;
  } | undefined;
  if (!row) return { enabled: true, retentionDays: 90, updatedAt: new Date().toISOString() };
  return {
    enabled: row.enabled === 1,
    retentionDays: row.retention_days,
    updatedAt: row.updated_at,
  };
}

export function updateAnalyticsSettings(
  db: Db,
  patch: { enabled?: boolean | undefined; retentionDays?: number | undefined },
): AnalyticsSettings {
  const now = new Date().toISOString();
  if (patch.enabled !== undefined) {
    db.prepare(
      'UPDATE analytics_settings SET enabled = ?, updated_at = ? WHERE id = 1',
    ).run(patch.enabled ? 1 : 0, now);
  }
  if (patch.retentionDays !== undefined) {
    db.prepare(
      'UPDATE analytics_settings SET retention_days = ?, updated_at = ? WHERE id = 1',
    ).run(patch.retentionDays, now);
  }
  return getAnalyticsSettings(db);
}

// ── Recording ─────────────────────────────────────────────────────────────────

/**
 * Records an analytics event. No-op if analytics is disabled.
 * Safe to call from anywhere — failures are swallowed to avoid impacting
 * primary functionality.
 */
export function record(
  db: Db,
  eventType: EventType,
  category: string,
  label = '',
  value = 1,
  meta: Record<string, unknown> = {},
): void {
  try {
    const settings = getAnalyticsSettings(db);
    if (!settings.enabled) return;

    db.prepare(
      `INSERT INTO analytics_events (id, event_type, category, label, value, meta)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(analyticsId(), eventType, category, label, value, JSON.stringify(meta));
  } catch {
    // Never crash primary functionality due to analytics failures.
  }
}

/** Shorthand: record a feature-use event. */
export function trackFeature(db: Db, category: string, label = ''): void {
  record(db, 'feature_use', category, label);
}

/** Shorthand: record a slow operation. */
export function trackSlowOp(db: Db, category: string, durationMs: number, meta: Record<string, unknown> = {}): void {
  record(db, 'slow_op', category, 'slow', durationMs, meta);
}

/** Shorthand: record a client or server error. */
export function trackError(db: Db, category: string, message: string): void {
  record(db, 'error', category, message.slice(0, 200));
}

// ── Stats queries ─────────────────────────────────────────────────────────────

export interface FeatureUsageStat {
  category: string;
  label: string;
  totalUses: number;
  lastUsedAt: string;
}

/** Top N most-used feature categories in the last N days. */
export function getFeatureUsage(db: Db, days = 30, limit = 20): FeatureUsageStat[] {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return (
    db
      .prepare(
        `SELECT category, label, COUNT(*) AS total_uses, MAX(created_at) AS last_used_at
         FROM analytics_events
         WHERE event_type = 'feature_use' AND created_at >= ?
         GROUP BY category, label
         ORDER BY total_uses DESC
         LIMIT ?`,
      )
      .all(since, limit) as { category: string; label: string; total_uses: number; last_used_at: string }[]
  ).map((r) => ({
    category: r.category,
    label: r.label,
    totalUses: r.total_uses,
    lastUsedAt: r.last_used_at,
  }));
}

export interface SlowOpStat {
  category: string;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  count: number;
}

/** Slow-op percentiles per category. */
export function getSlowOpStats(db: Db, days = 7): SlowOpStat[] {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = db
    .prepare(
      `SELECT category, value FROM analytics_events
       WHERE event_type = 'slow_op' AND created_at >= ?
       ORDER BY category, value`,
    )
    .all(since) as { category: string; value: number }[];

  const byCategory = new Map<string, number[]>();
  for (const r of rows) {
    if (!byCategory.has(r.category)) byCategory.set(r.category, []);
    byCategory.get(r.category)!.push(r.value);
  }

  const result: SlowOpStat[] = [];
  for (const [category, values] of byCategory) {
    const sorted = values.sort((a, b) => a - b);
    const pct = (p: number) => sorted[Math.ceil((p / 100) * sorted.length) - 1] ?? 0;
    result.push({ category, p50Ms: pct(50), p95Ms: pct(95), p99Ms: pct(99), count: values.length });
  }
  return result;
}

export interface ErrorStat {
  category: string;
  label: string;
  count: number;
  lastAt: string;
}

/** Recent error groups. */
export function getErrorStats(db: Db, days = 7, limit = 20): ErrorStat[] {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return (
    db
      .prepare(
        `SELECT category, label, COUNT(*) AS count, MAX(created_at) AS last_at
         FROM analytics_events
         WHERE event_type = 'error' AND created_at >= ?
         GROUP BY category, label
         ORDER BY count DESC
         LIMIT ?`,
      )
      .all(since, limit) as { category: string; label: string; count: number; last_at: string }[]
  ).map((r) => ({ category: r.category, label: r.label, count: r.count, lastAt: r.last_at }));
}

export interface KnowledgeGrowthPoint {
  day: string;
  noteCount: number;
  wordCount: number;
  linkCount: number;
}

/** Knowledge growth over time (from notes/links tables, not analytics). */
export function getKnowledgeGrowth(db: Db, days = 30): KnowledgeGrowthPoint[] {
  const points: KnowledgeGrowthPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const day = d.toISOString().slice(0, 10);
    const dayEnd = `${day}T23:59:59Z`;

    const noteCount = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM notes WHERE created_at <= ? AND trashed_at IS NULL`)
        .get(dayEnd) as { n: number }
    ).n;

    const wordCountRow = db
      .prepare(
        `SELECT COALESCE(SUM(LENGTH(body) - LENGTH(REPLACE(body,' ','')) + 1), 0) AS w
         FROM notes WHERE created_at <= ? AND trashed_at IS NULL`,
      )
      .get(dayEnd) as { w: number };

    const linkCount = (
      db.prepare(`SELECT COUNT(*) AS n FROM links WHERE created_at <= ?`).get(dayEnd) as { n: number }
    ).n;

    points.push({ day, noteCount, wordCount: wordCountRow.w, linkCount });
  }
  return points;
}

export interface StoryMetrics {
  storyId: string;
  title: string;
  playCount: number;
  completionCount: number;
}

/** Story play/completion metrics. */
export function getStoryMetrics(db: Db, limit = 20): StoryMetrics[] {
  // story_saves tracks named save slots; count slots per story as a proxy for plays.
  return (
    db
      .prepare(
        `SELECT s.id, s.title,
                COUNT(ss.id) AS play_count,
                0 AS completion_count
         FROM stories s
         LEFT JOIN story_saves ss ON ss.story_id = s.id
         GROUP BY s.id
         ORDER BY play_count DESC
         LIMIT ?`,
      )
      .all(limit) as { id: string; title: string; play_count: number; completion_count: number }[]
  ).map((r) => ({
    storyId: r.id,
    title: r.title,
    playCount: r.play_count,
    completionCount: r.completion_count,
  }));
}

// ── Retention / purge (F977) ──────────────────────────────────────────────────

/** Deletes analytics events older than the configured retention period. */
export function purgeOldAnalytics(db: Db): number {
  const settings = getAnalyticsSettings(db);
  const cutoff = new Date(
    Date.now() - settings.retentionDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const result = db
    .prepare('DELETE FROM analytics_events WHERE created_at < ?')
    .run(cutoff);
  return result.changes;
}

// ── No-network-egress guard (F971) ────────────────────────────────────────────
// This comment is a marker for the CI grep that verifies no `fetch` / `http` calls
// exist in this file. The test in analytics.test.ts scans this file statically.
// ANALYTICS_NO_NETWORK_EGRESS
