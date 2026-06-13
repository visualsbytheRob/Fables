/**
 * Local analytics tests (F971–F980).
 * Verifies: feature counters, knowledge growth, story metrics, opt-out,
 * retention purge, and the no-network-egress guarantee.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import {
  getAnalyticsSettings,
  getFeatureUsage,
  purgeOldAnalytics,
  record,
  trackFeature,
  updateAnalyticsSettings,
} from '../services/analytics.js';

// ── F971: No network egress guard ─────────────────────────────────────────────

describe('no-network-egress guarantee (F971)', () => {
  it('analytics.ts contains no fetch/http calls', () => {
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, '../services/analytics.ts'),
      'utf8',
    );
    // Strip single-line and multi-line comments before checking.
    const stripped = src
      .replace(/\/\/.*$/gm, '')          // single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, ''); // multi-line comments

    // Must not contain any network I/O patterns in actual code.
    expect(stripped).not.toMatch(/\bfetch\s*\(/);
    expect(stripped).not.toMatch(/require\(['"]https?\b/);
    expect(stripped).not.toMatch(/import.*from\s+['"]node:https?['"]/);
    expect(stripped).not.toMatch(/import.*from\s+['"]https?['"]/);
    // Must contain the no-egress marker (in the original source).
    expect(src).toContain('ANALYTICS_NO_NETWORK_EGRESS');
  });
});

// ── Integration tests ─────────────────────────────────────────────────────────

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
});

afterAll(async () => {
  await app.close();
});

describe('analytics API (F971–F980)', () => {
  it('GET /analytics/stats returns usage data', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/analytics/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.featureUsage).toBeInstanceOf(Array);
    expect(body.data.privacy).toContain('local');
  });

  it('GET /analytics/knowledge returns growth points', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/analytics/knowledge?days=7' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(7);
    expect(body.data[0]).toMatchObject({ day: expect.any(String), noteCount: expect.any(Number) });
  });

  it('GET /analytics/stories returns metrics', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/analytics/stories' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeInstanceOf(Array);
  });

  it('GET /analytics/settings includes privacy note', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/analytics/settings' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.privacyNote).toContain('local');
  });

  it('PATCH /analytics/settings updates enabled flag', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/analytics/settings',
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.enabled).toBe(false);

    // Re-enable.
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/analytics/settings',
      payload: { enabled: true },
    });
  });

  it('POST /analytics/event records a client event', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/analytics/event',
      payload: { category: 'editor', label: 'save', value: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.recorded).toBe(true);
  });

  it('POST /analytics/purge deletes old records', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/analytics/purge' });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().data.deleted).toBe('number');
  });
});

// ── Unit tests ────────────────────────────────────────────────────────────────

describe('analytics service unit tests', () => {
  function freshDb() {
    const db = openDb(':memory:');
    migrate(db);
    return db;
  }

  it('records and retrieves feature usage', () => {
    const db = freshDb();
    trackFeature(db, 'notes', 'create');
    trackFeature(db, 'notes', 'create');
    trackFeature(db, 'search', 'keyword');

    const usage = getFeatureUsage(db, 30);
    const notesUsage = usage.find((u) => u.category === 'notes' && u.label === 'create');
    expect(notesUsage?.totalUses).toBe(2);
  });

  it('opt-out prevents recording', () => {
    const db = freshDb();
    updateAnalyticsSettings(db, { enabled: false });
    record(db, 'feature_use', 'test', 'hidden');
    const usage = getFeatureUsage(db, 30);
    expect(usage.find((u) => u.category === 'test')).toBeUndefined();
  });

  it('purge removes old events', () => {
    const db = freshDb();
    // Manually insert an old event.
    db.prepare(
      `INSERT INTO analytics_events (id, event_type, category, label, value, meta, created_at)
       VALUES ('ae_old', 'feature_use', 'old', '', 1, '{}', ?)`,
    ).run(new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString());

    const settings = getAnalyticsSettings(db);
    expect(settings.retentionDays).toBe(90);

    const deleted = purgeOldAnalytics(db);
    expect(deleted).toBe(1);
  });

  it('getAnalyticsSettings returns defaults', () => {
    const db = freshDb();
    const s = getAnalyticsSettings(db);
    expect(s.enabled).toBe(true);
    expect(s.retentionDays).toBe(90);
  });
});
