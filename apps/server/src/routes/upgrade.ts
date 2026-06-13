/**
 * Migrations & Upgrades API (F961–F970).
 *
 *  GET  /upgrade/version        — app version, DB schema version, changelog
 *  GET  /upgrade/migration-status — which migrations are applied / pending
 *  POST /upgrade/migration-dry-run — show pending migrations without applying
 *  POST /upgrade/recompile-all  — re-compile all story projects (F963)
 *  GET  /upgrade/check          — update checker stub (F966)
 */

import type { StoryId } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { registerRoute } from '../api/registry.js';
import { APP_VERSION } from '../app.js';
import type { Db } from '../db/connection.js';
import { migrations } from '../db/migrations/index.js';

registerRoute({
  method: 'GET',
  path: '/upgrade/version',
  summary: 'App version, schema version, and changelog',
});
registerRoute({
  method: 'GET',
  path: '/upgrade/migration-status',
  summary: 'Applied and pending migrations',
});
registerRoute({
  method: 'POST',
  path: '/upgrade/migration-dry-run',
  summary: 'Show what would be migrated without applying',
});
registerRoute({
  method: 'POST',
  path: '/upgrade/recompile-all',
  summary: 'Recompile all story projects (bytecode upgrade)',
});
registerRoute({
  method: 'GET',
  path: '/upgrade/check',
  summary: 'Check for a newer release on GitHub (stub)',
});

/** Hardcoded changelog — updated as features ship. */
const CHANGELOG = [
  { version: '0.1.0', date: '2026-06-13', summary: 'Initial Tier-1 release: 1,000 features.' },
];

/** The minimum DB schema version this binary requires. */
const MIN_SCHEMA_VERSION = 1;

/** The latest migration ID this binary knows about. */
const LATEST_SCHEMA_VERSION = Math.max(...migrations.map((m) => m.id));

export const upgradeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/upgrade/version', async () => {
    const applied = (
      app.db.prepare('SELECT MAX(id) AS v FROM applied_migrations').get() as { v: number | null }
    ).v ?? 0;

    return {
      data: {
        appVersion: APP_VERSION,
        schemaVersion: applied,
        latestSchemaVersion: LATEST_SCHEMA_VERSION,
        changelog: CHANGELOG,
      },
    };
  });

  app.get('/upgrade/migration-status', async () => {
    const appliedIds = new Set(
      (
        app.db.prepare('SELECT id FROM applied_migrations').all() as { id: number }[]
      ).map((r) => r.id),
    );

    const applied = migrations
      .filter((m) => appliedIds.has(m.id))
      .map((m) => ({ id: m.id, name: m.name, status: 'applied' as const }));

    const pending = migrations
      .filter((m) => !appliedIds.has(m.id))
      .map((m) => ({ id: m.id, name: m.name, status: 'pending' as const }));

    return { data: { applied, pending, upToDate: pending.length === 0 } };
  });

  /** Dry-run: shows pending migrations without applying them. */
  app.post('/upgrade/migration-dry-run', async () => {
    const appliedIds = new Set(
      (
        app.db.prepare('SELECT id FROM applied_migrations').all() as { id: number }[]
      ).map((r) => r.id),
    );

    const pending = migrations.filter((m) => !appliedIds.has(m.id)).map((m) => ({
      id: m.id,
      name: m.name,
      sqlPreview: m.sql.trim().slice(0, 200) + (m.sql.trim().length > 200 ? '…' : ''),
    }));

    return {
      data: {
        wouldApply: pending,
        count: pending.length,
        preBackupRecommended: pending.length > 0,
        note: 'To apply, restart the server (migrations run automatically on boot).',
      },
    };
  });

  /** Recompile all story projects (F963 — bytecode version upgrade). */
  app.post('/upgrade/recompile-all', async () => {
    const stories = app.db
      .prepare(`SELECT id, title FROM stories WHERE is_template = 0`)
      .all() as { id: string; title: string }[];

    let recompiled = 0;
    const errors: { storyId: string; title: string; error: string }[] = [];

    for (const story of stories) {
      try {
        const { recompileStory } = await import('../stories/service.js');
        recompileStory(app.db, story.id as StoryId);
        recompiled += 1;
      } catch (err) {
        errors.push({ storyId: story.id, title: story.title, error: (err as Error).message });
      }
    }

    return { data: { total: stories.length, recompiled, errors } };
  });

  /**
   * Update checker (F966) — manual check against GitHub releases.
   * This is a stub: in a real installation the user would poll manually.
   * Auto-update is deliberately NOT implemented.
   */
  app.get('/upgrade/check', async () => {
    return {
      data: {
        currentVersion: APP_VERSION,
        checkUrl: 'https://github.com/robmcd/fables/releases',
        note: 'Fables does not auto-update. Check the URL above manually, then run `pnpm upgrade-fables`.',
        autoUpdate: false,
      },
    };
  });
};

// ── Downgrade protection (F965) ───────────────────────────────────────────────

/**
 * Checks that the database schema version is not newer than what this binary
 * supports. Called during `buildApp()` initialization.
 *
 * Throws with a clear message if the DB was created by a newer version of
 * Fables (e.g. after a rollback without a DB restore).
 */
export function assertSchemaCompatible(db: Db): void {
  const applied = (
    db.prepare('SELECT MAX(id) AS v FROM applied_migrations').get() as { v: number | null }
  ).v ?? 0;

  if (applied > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${applied} is newer than this binary supports (max: ${LATEST_SCHEMA_VERSION}). ` +
        `This binary was built for Fables v${APP_VERSION}. ` +
        `Please upgrade the application or restore an older database backup. ` +
        `See docs/runbooks/rollback.md for instructions.`,
    );
  }

  if (applied < MIN_SCHEMA_VERSION) {
    // This would only happen on a completely fresh/corrupt DB — migrations fix it.
    return;
  }
}
