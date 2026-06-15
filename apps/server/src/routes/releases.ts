/**
 * Story versioning routes (Epic 19, F1842–F1845).
 *
 * Builds on the existing release endpoints in routes/stories.ts (create/list).
 *
 *  GET    /stories/:id/releases/:a/diff/:b         — structural diff between two releases
 *  GET    /stories/:id/releases/:a/changelog/:b    — markdown changelog
 *  GET    /stories/:id/releases/:a/compat/:b        — save-compatibility check
 *  POST   /stories/:id/releases/:rel/rollback      — restore a release's source (F1845)
 */

import { notFound } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { StoryId } from '@fables/core';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { storiesRepo } from '../db/repos/stories.js';
import { diffReleases, generateChangelog, saveCompat } from '../stories/release-diff.js';

registerRoute({
  method: 'GET',
  path: '/stories/:id/releases/:a/diff/:b',
  summary: 'Release diff (F1844)',
});
registerRoute({
  method: 'GET',
  path: '/stories/:id/releases/:a/changelog/:b',
  summary: 'Release changelog (F1842)',
});
registerRoute({
  method: 'GET',
  path: '/stories/:id/releases/:a/compat/:b',
  summary: 'Save-compat between releases (F1843)',
});
registerRoute({
  method: 'POST',
  path: '/stories/:id/releases/:rel/rollback',
  summary: 'Rollback to a release (F1845)',
});

export const releaseRoutes: FastifyPluginAsync = async (app) => {
  const stories = storiesRepo(app.db);

  const twoReleases = (id: string, a: string, b: string) => {
    const relA = stories.getRelease(id as StoryId, a);
    const relB = stories.getRelease(id as StoryId, b);
    if (!relA) throw notFound('release', a);
    if (!relB) throw notFound('release', b);
    return { relA, relB };
  };

  app.get('/stories/:id/releases/:a/diff/:b', async (request) => {
    const { id, a, b } = parseWith(
      z.object({ id: z.string().min(1), a: z.string().min(1), b: z.string().min(1) }),
      request.params,
      'params',
    );
    const { relA, relB } = twoReleases(id, a, b);
    return { data: diffReleases(relA.files, relB.files) };
  });

  app.get('/stories/:id/releases/:a/changelog/:b', async (request) => {
    const { id, a, b } = parseWith(
      z.object({ id: z.string().min(1), a: z.string().min(1), b: z.string().min(1) }),
      request.params,
      'params',
    );
    const { relA, relB } = twoReleases(id, a, b);
    return {
      data: {
        changelog: generateChangelog(diffReleases(relA.files, relB.files), relA.name, relB.name),
      },
    };
  });

  app.get('/stories/:id/releases/:a/compat/:b', async (request) => {
    const { id, a, b } = parseWith(
      z.object({ id: z.string().min(1), a: z.string().min(1), b: z.string().min(1) }),
      request.params,
      'params',
    );
    const { relA, relB } = twoReleases(id, a, b);
    return { data: saveCompat(relA.files, relB.files) };
  });

  app.post('/stories/:id/releases/:rel/rollback', async (request) => {
    const { id, rel } = parseWith(
      z.object({ id: z.string().min(1), rel: z.string().min(1) }),
      request.params,
      'params',
    );
    const release = stories.getRelease(id as StoryId, rel);
    if (!release) throw notFound('release', rel);
    const existing = new Set(stories.listFiles(id as StoryId).map((f) => f.path));
    // Update files that exist; create ones the release has but the project lost.
    const toUpdate = new Map<string, string>();
    for (const [path, src] of Object.entries(release.files)) {
      if (existing.has(path)) toUpdate.set(path, src);
      else stories.createFile(id as StoryId, path, src);
    }
    if (toUpdate.size > 0) stories.setFileSources(id as StoryId, toUpdate);
    return { data: { rolledBackTo: release.name, files: Object.keys(release.files).length } };
  });
};
