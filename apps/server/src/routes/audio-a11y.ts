/**
 * Audio accessibility routes (Epic 17, F1682/F1684).
 *
 *  POST /stories/:id/transcript   — transcript or WebVTT captions for a path
 *                                   (F1684), plus a numbered spoken choice menu
 *                                   per choice point (F1682).
 *
 * Audio-first navigation, dyslexia-friendly presets, and the visualizations are
 * the web layer; voice normalization / mono / balance live in the audio settings
 * (PUT /soundscape/mix). This produces the accessible text artifacts.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { StoryId } from '@fables/core';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { storiesRepo } from '../db/repos/stories.js';
import { castingRepo } from '../db/repos/casting.js';
import { buildScene } from '../audio/narration/scene.js';
import { buildTranscript, buildVtt, numberedChoiceMenu } from '../audio/a11y/transcript.js';

registerRoute({
  method: 'POST',
  path: '/stories/:id/transcript',
  summary: 'Transcript / WebVTT captions + spoken choice menus (F1682/F1684)',
});

const idParams = z.object({ id: z.string().min(1) });

const body = z.object({
  path: z.array(z.string().min(1)).min(1).max(2000),
  format: z.enum(['text', 'vtt']).optional(),
  wpm: z.number().int().min(60).max(400).optional(),
});

export const audioA11yRoutes: FastifyPluginAsync = async (app) => {
  const stories = storiesRepo(app.db);
  const casting = castingRepo(app.db);

  app.post('/stories/:id/transcript', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    const input = parseWith(body, request.body, 'body');
    stories.mustGet(id as StoryId);
    const source = stories
      .listFiles(id as StoryId)
      .map((f) => f.source)
      .join('\n\n');
    const cast = casting.castSheets.manifest(id).sheet;
    const scene = buildScene(source, input.path, cast, {
      ...(input.wpm !== undefined ? { wpm: input.wpm } : {}),
    });

    const format = input.format ?? 'text';
    const transcript = format === 'vtt' ? buildVtt(scene) : buildTranscript(scene);
    // Spoken numbered menus for each choice point (F1682).
    const menus = scene.items
      .filter((i) => i.kind === 'choice' && i.choices && i.choices.length > 0)
      .map((i) => numberedChoiceMenu(i.choices!));

    return { data: { format, transcript, choiceMenus: menus } };
  });
};
