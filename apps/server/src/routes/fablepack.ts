/**
 * .fablepack distribution routes (Epic 19, F1801–F1808).
 *
 *  POST /stories/:id/pack   — pack a story into a .fablepack (base64)
 *  POST /packs/validate     — validate a pack's hash tree + optional signature
 *  POST /packs/unpack       — read a pack's manifest + source back
 */

import { validation } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { StoryId } from '@fables/core';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { storiesRepo } from '../db/repos/stories.js';
import { castingRepo } from '../db/repos/casting.js';
import { packFable, unpackFable, validatePack, type Capability } from '../export/fablepack/pack.js';

registerRoute({
  method: 'POST',
  path: '/stories/:id/pack',
  summary: 'Pack a story (.fablepack) (F1801)',
});
registerRoute({ method: 'POST', path: '/packs/validate', summary: 'Validate a pack (F1808)' });
registerRoute({ method: 'POST', path: '/packs/unpack', summary: 'Read a pack manifest (F1803)' });

const CAPS = ['audio', 'ai', 'knowledge', 'images', 'soundscape'] as const;

const packBody = z.object({
  release: z.string().max(200).optional(),
  capabilities: z.array(z.enum(CAPS)).optional(),
  contentWarnings: z.array(z.string().max(200)).max(50).optional(),
  signingKey: z.string().min(1).max(500).optional(),
});

export const fablepackRoutes: FastifyPluginAsync = async (app) => {
  const stories = storiesRepo(app.db);
  const casting = castingRepo(app.db);

  app.post('/stories/:id/pack', async (request) => {
    const { id } = parseWith(z.object({ id: z.string().min(1) }), request.params, 'params');
    const body = parseWith(packBody, request.body, 'body');
    const story = stories.mustGet(id as StoryId);
    const source: Record<string, string> = {};
    for (const f of stories.listFiles(id as StoryId)) source[f.path] = f.source;
    if (Object.keys(source).length === 0) source['main.fable'] = '';

    const buf = packFable({
      story: { id: story.id, title: story.title, description: story.description },
      ...(body.release !== undefined ? { release: body.release } : {}),
      source,
      casting: casting.castSheets.manifest(id).sheet,
      ...(body.capabilities !== undefined
        ? { capabilities: body.capabilities as Capability[] }
        : {}),
      ...(body.contentWarnings !== undefined ? { contentWarnings: body.contentWarnings } : {}),
      ...(body.signingKey !== undefined ? { signingKey: body.signingKey } : {}),
    });
    return { data: { pack: buf.toString('base64'), bytes: buf.byteLength } };
  });

  app.post('/packs/validate', async (request) => {
    const body = parseWith(
      z.object({ pack: z.string().min(1), signingKey: z.string().min(1).max(500).optional() }),
      request.body,
      'body',
    );
    const buf = Buffer.from(body.pack, 'base64');
    return { data: validatePack(buf, body.signingKey) };
  });

  app.post('/packs/unpack', async (request) => {
    const body = parseWith(z.object({ pack: z.string().min(1) }), request.body, 'body');
    try {
      const out = unpackFable(Buffer.from(body.pack, 'base64'));
      return { data: { manifest: out.manifest, source: out.source, casting: out.casting } };
    } catch (err) {
      throw validation((err as Error).message);
    }
  });
};
