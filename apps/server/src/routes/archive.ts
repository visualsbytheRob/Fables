/**
 * Story archive routes (Epic 19, F1881/F1885/F1886).
 *
 *  POST /archive/build      — bundle stories' packs into a .fablearchive (F1881)
 *  POST /archive/verify     — verify an archive's fixity (F1886)
 *  POST /archive/checklist  — preservation checklist for a pack (F1884)
 */

import { validation } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { StoryId } from '@fables/core';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { storiesRepo } from '../db/repos/stories.js';
import { castingRepo } from '../db/repos/casting.js';
import { packFable } from '../export/fablepack/pack.js';
import { buildArchive, verifyArchive, preservationChecklist } from '../export/archive/archive.js';

registerRoute({ method: 'POST', path: '/archive/build', summary: 'Build a story archive (F1881)' });
registerRoute({
  method: 'POST',
  path: '/archive/verify',
  summary: 'Verify archive fixity (F1886)',
});
registerRoute({
  method: 'POST',
  path: '/archive/checklist',
  summary: 'Preservation checklist (F1884)',
});

export const archiveRoutes: FastifyPluginAsync = async (app) => {
  const stories = storiesRepo(app.db);
  const casting = castingRepo(app.db);

  app.post('/archive/build', async (request) => {
    const body = parseWith(
      z.object({ storyIds: z.array(z.string().min(1)).min(1).max(1000) }),
      request.body,
      'body',
    );
    const packs = body.storyIds.map((id) => {
      const story = stories.mustGet(id as StoryId);
      const source: Record<string, string> = {};
      for (const f of stories.listFiles(id as StoryId)) source[f.path] = f.source;
      if (Object.keys(source).length === 0) source['main.fable'] = '';
      const bytes = packFable({
        story: { id: story.id, title: story.title, description: story.description },
        source,
        casting: casting.castSheets.manifest(id).sheet,
      });
      return { name: `${story.id}.fablepack`, bytes };
    });
    const archive = buildArchive({ packs, metadata: { count: packs.length } });
    return {
      data: { archive: archive.toString('base64'), bytes: archive.byteLength, packs: packs.length },
    };
  });

  app.post('/archive/verify', async (request) => {
    const body = parseWith(z.object({ archive: z.string().min(1) }), request.body, 'body');
    return { data: verifyArchive(Buffer.from(body.archive, 'base64')) };
  });

  app.post('/archive/checklist', async (request) => {
    const body = parseWith(z.object({ pack: z.string().min(1) }), request.body, 'body');
    try {
      return { data: { checklist: preservationChecklist(Buffer.from(body.pack, 'base64')) } };
    } catch (err) {
      throw validation((err as Error).message);
    }
  });
};
