/**
 * Narration renderer routes (Epic 17, F1621–F1630).
 *
 *  POST /stories/:id/narration/scene      — build a voiced audio scene + timeline
 *                                           from a path of knot names (F1621/F1626)
 *  POST /stories/:id/narration/prerender  — bake the path to one WAV file (F1624)
 *
 * The scene uses the story's saved cast sheet (Epic 17 casting). Pre-render needs
 * a live speech engine; when none is available it returns `{ available: false }`
 * so the player can fall back to live Web Speech narration (F1623).
 */

import { validation } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { storiesRepo } from '../db/repos/stories.js';
import { castingRepo } from '../db/repos/casting.js';
import { buildScene } from '../audio/narration/scene.js';
import { buildTimeline } from '../audio/narration/timeline.js';
import { prerenderScene, realtimeRatio } from '../audio/narration/prerender.js';
import type { StoryId } from '@fables/core';

registerRoute({
  method: 'POST',
  path: '/stories/:id/narration/scene',
  summary: 'Build a voiced audio scene + timeline (F1621/F1626)',
});
registerRoute({
  method: 'POST',
  path: '/stories/:id/narration/prerender',
  summary: 'Bake a story path to one audio file (F1624)',
});

const idParams = z.object({ id: z.string().min(1) });

const sceneBody = z.object({
  /** Ordered knot names to narrate. */
  path: z.array(z.string().min(1)).min(1).max(2000),
  wpm: z.number().int().min(60).max(400).optional(),
  knownSpeakers: z.array(z.string().min(1)).max(500).optional(),
});

export const narrationRoutes: FastifyPluginAsync = async (app) => {
  const stories = storiesRepo(app.db);
  const casting = castingRepo(app.db);

  /** Forge source for a story: all scene files joined (mustGet enforces 404). */
  const storySource = (id: StoryId): string => {
    stories.mustGet(id);
    return stories
      .listFiles(id)
      .map((f) => f.source)
      .join('\n\n');
  };

  app.post('/stories/:id/narration/scene', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    const body = parseWith(sceneBody, request.body, 'body');
    const source = storySource(id as StoryId);
    const cast = casting.castSheets.manifest(id).sheet;
    const scene = buildScene(source, body.path, cast, {
      ...(body.wpm !== undefined ? { wpm: body.wpm } : {}),
      ...(body.knownSpeakers !== undefined ? { knownSpeakers: body.knownSpeakers } : {}),
    });
    return { data: { scene, timeline: buildTimeline(scene) } };
  });

  app.post('/stories/:id/narration/prerender', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    const body = parseWith(sceneBody, request.body, 'body');
    const source = storySource(id as StoryId);

    if (!(await app.tts.isAvailable())) {
      throw validation('no speech engine is available', { available: false });
    }

    const cast = casting.castSheets.manifest(id).sheet;
    const scene = buildScene(source, body.path, cast, {
      ...(body.wpm !== undefined ? { wpm: body.wpm } : {}),
      ...(body.knownSpeakers !== undefined ? { knownSpeakers: body.knownSpeakers } : {}),
    });

    const result = await prerenderScene(scene, (req) => app.tts.synthesize(req));

    return {
      data: {
        format: result.format,
        sampleRate: result.sampleRate,
        durationMs: result.durationMs,
        realtimeRatio: realtimeRatio(result),
        offsets: result.offsets,
        items: scene.items.length,
        audio: Buffer.from(result.audio).toString('base64'),
      },
    };
  });
};
