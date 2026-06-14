/**
 * Story co-writer routes (F1341–F1346) — creative AI assists for the author
 * workspace. Each takes author-supplied text (the current scene, an outline, a
 * style sample, established facts) and returns suggestions; nothing is written
 * back to the story, so every contribution is reviewed and applied by the author
 * as a normal, undoable edit (F1339-style discipline). Optional style guidance
 * (from F1344 capture) tunes the generative endpoints.
 *
 * All degrade gracefully to `{ available: false }` when no backend is present.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import {
  analyzeBranchGap,
  captureStyle,
  checkConsistency,
  draftScene,
  expandChoices,
  suggestBeats,
  type StyleGuidance,
} from '../ai/story-cowriter.js';

registerRoute({ method: 'POST', path: '/ai/story/beats', summary: 'Suggest next beats (F1341)' });
registerRoute({ method: 'POST', path: '/ai/story/choices', summary: 'Draft choices (F1342)' });
registerRoute({ method: 'POST', path: '/ai/story/scene', summary: 'Draft scene prose (F1343)' });
registerRoute({ method: 'POST', path: '/ai/story/style', summary: 'Capture author style (F1344)' });
registerRoute({
  method: 'POST',
  path: '/ai/story/consistency',
  summary: 'Check scene consistency vs facts (F1345)',
});
registerRoute({
  method: 'POST',
  path: '/ai/story/gap',
  summary: 'Analyse a thin branch (F1346)',
});

const styleSchema = z.object({ tone: z.string().min(1), traits: z.array(z.string()).max(8) });

const sceneInput = z.object({
  scene: z.string().min(1).max(20_000),
  style: styleSchema.optional(),
});

const draftInput = z.object({
  outline: z.string().min(1).max(20_000),
  style: styleSchema.optional(),
});

const styleInput = z.object({ sample: z.string().min(1).max(20_000) });

const consistencyInput = z.object({
  scene: z.string().min(1).max(20_000),
  facts: z.array(z.string().min(1)).max(100),
});

const gapInput = z.object({ branch: z.string().min(1).max(20_000) });

/** Narrow the validated style into the StyleGuidance the co-writer expects. */
function asStyle(s: z.infer<typeof styleSchema> | undefined): StyleGuidance | undefined {
  return s ? { tone: s.tone, traits: s.traits } : undefined;
}

export const aiStoryRoutes: FastifyPluginAsync = async (app) => {
  app.post('/ai/story/beats', async (request) => {
    const { scene, style } = parseWith(sceneInput, request.body, 'body');
    return { data: await suggestBeats(app.ai, scene, asStyle(style)) };
  });

  app.post('/ai/story/choices', async (request) => {
    const { scene, style } = parseWith(sceneInput, request.body, 'body');
    return { data: await expandChoices(app.ai, scene, asStyle(style)) };
  });

  app.post('/ai/story/scene', async (request) => {
    const { outline, style } = parseWith(draftInput, request.body, 'body');
    return { data: await draftScene(app.ai, outline, asStyle(style)) };
  });

  app.post('/ai/story/style', async (request) => {
    const { sample } = parseWith(styleInput, request.body, 'body');
    return { data: await captureStyle(app.ai, sample) };
  });

  app.post('/ai/story/consistency', async (request) => {
    const { scene, facts } = parseWith(consistencyInput, request.body, 'body');
    return { data: await checkConsistency(app.ai, scene, facts) };
  });

  app.post('/ai/story/gap', async (request) => {
    const { branch } = parseWith(gapInput, request.body, 'body');
    return { data: await analyzeBranchGap(app.ai, branch) };
  });
};
