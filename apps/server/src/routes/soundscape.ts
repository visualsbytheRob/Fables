/**
 * Soundscape routes (Epic 17, F1631–F1640).
 *
 *  GET  /soundscape/library            — bundled CC0 sound catalogue (F1634)
 *  GET  /soundscape/attribution        — CC0 attribution manifest (F1634)
 *  GET  /soundscape/mix                — per-vault mix levels + settings (F1638)
 *  PUT  /soundscape/mix                — update mix levels / overrides (F1638)
 *  POST /stories/:id/soundscape        — scene bindings + sound triggers from
 *                                        the story's Forge source (F1632/F1637)
 *
 * The Web Audio playback engine, crossfade/ducking, the layer editor, and user
 * sound import are the web layer; this exposes the data those features bind to.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import type { StoryId } from '@fables/core';
import { storiesRepo } from '../db/repos/stories.js';
import { SOUND_LIBRARY, attributionManifest, findSound } from '../audio/soundscape/library.js';
import { audioSettingsRepo } from '../audio/soundscape/settings.js';
import { extractSceneBindings } from '../audio/soundscape/bindings.js';
import { extractSoundTriggers } from '../audio/soundscape/triggers.js';

registerRoute({ method: 'GET', path: '/soundscape/library', summary: 'CC0 sound library (F1634)' });
registerRoute({
  method: 'GET',
  path: '/soundscape/attribution',
  summary: 'CC0 attribution manifest (F1634)',
});
registerRoute({ method: 'GET', path: '/soundscape/mix', summary: 'Audio mix settings (F1638)' });
registerRoute({ method: 'PUT', path: '/soundscape/mix', summary: 'Update audio mix (F1638)' });
registerRoute({
  method: 'POST',
  path: '/stories/:id/soundscape',
  summary: 'Scene bindings + sound triggers (F1632/F1637)',
});

const idParams = z.object({ id: z.string().min(1) });

const mixBody = z.object({
  mix: z
    .object({
      narration: z.number().min(0).max(1),
      ambient: z.number().min(0).max(1),
      effects: z.number().min(0).max(1),
      master: z.number().min(0).max(1),
    })
    .partial()
    .optional(),
  sceneOverrides: z.record(z.string(), z.string()).optional(),
  duckAmount: z.number().min(0).max(1).optional(),
});

export const soundscapeRoutes: FastifyPluginAsync = async (app) => {
  const stories = storiesRepo(app.db);
  const settings = audioSettingsRepo(app.db);

  app.get('/soundscape/library', async () => {
    return { data: { sounds: SOUND_LIBRARY } };
  });

  app.get('/soundscape/attribution', async () => {
    return { data: { attribution: attributionManifest() } };
  });

  app.get('/soundscape/mix', async () => {
    return { data: settings.get() };
  });

  app.put('/soundscape/mix', async (request) => {
    const body = parseWith(mixBody, request.body, 'body');
    return {
      data: settings.update({
        ...(body.mix !== undefined ? { mix: body.mix } : {}),
        ...(body.sceneOverrides !== undefined ? { sceneOverrides: body.sceneOverrides } : {}),
        ...(body.duckAmount !== undefined ? { duckAmount: body.duckAmount } : {}),
      }),
    };
  });

  app.post('/stories/:id/soundscape', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    stories.mustGet(id as StoryId);
    const source = stories
      .listFiles(id as StoryId)
      .map((f) => f.source)
      .join('\n\n');

    const overrides = settings.get().sceneOverrides;
    const bindings = extractSceneBindings(source).map((b) => ({
      ...b,
      // Resolve to a concrete library sound: an override wins, else the scene
      // name if it matches a bundled sound id.
      sound: overrides[b.soundscape] ?? (findSound(b.soundscape) ? b.soundscape : null),
    }));
    const triggers = extractSoundTriggers(source).map((t) => ({
      ...t,
      known: findSound(t.sound) !== undefined,
    }));

    return { data: { bindings, triggers } };
  });
};
