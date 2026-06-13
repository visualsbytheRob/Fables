/**
 * Migrations & Upgrades tests (F961–F970).
 * Covers: version endpoint, migration dry-run, downgrade protection.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { assertSchemaCompatible } from './upgrade.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
});

afterAll(async () => {
  await app.close();
});

describe('version endpoint (F961)', () => {
  it('returns app version and schema version', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/upgrade/version' });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.appVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof data.schemaVersion).toBe('number');
    expect(data.changelog).toBeInstanceOf(Array);
  });
});

describe('migration status (F962)', () => {
  it('reports applied and pending migrations', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/upgrade/migration-status' });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.applied).toBeInstanceOf(Array);
    expect(data.pending).toBeInstanceOf(Array);
    expect(typeof data.upToDate).toBe('boolean');
  });

  it('dry-run shows what would be migrated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/upgrade/migration-dry-run',
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    // All migrations already applied in test DB.
    expect(data.count).toBe(0);
    expect(data.wouldApply).toHaveLength(0);
  });
});

describe('downgrade protection (F965)', () => {
  it('throws when DB schema version exceeds binary capability', () => {
    const db = openDb(':memory:');
    migrate(db);
    // Fake a future migration ID in the applied_migrations table.
    db.prepare(
      "INSERT INTO applied_migrations (id, name, applied_at) VALUES (9999, 'future', ?)",
    ).run(new Date().toISOString());

    expect(() => assertSchemaCompatible(db)).toThrow(
      /schema version 9999 is newer than this binary supports/,
    );
    db.close();
  });

  it('does not throw on a fresh or up-to-date DB', () => {
    const db = openDb(':memory:');
    migrate(db);
    expect(() => assertSchemaCompatible(db)).not.toThrow();
    db.close();
  });
});

describe('update checker stub (F966)', () => {
  it('returns current version and check URL without auto-updating', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/upgrade/check' });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.autoUpdate).toBe(false);
    expect(data.checkUrl).toContain('github.com');
    expect(data.currentVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('recompile-all (F963)', () => {
  it('runs without error even with no stories', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/upgrade/recompile-all' });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(typeof data.total).toBe('number');
    expect(typeof data.recompiled).toBe('number');
    expect(data.errors).toBeInstanceOf(Array);
  });
});
