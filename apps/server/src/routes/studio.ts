/**
 * Recording studio routes (Epic 17, F1651–F1660).
 *
 *  POST   /stories/:id/takes               — upload a human narration take (F1651)
 *  GET    /stories/:id/takes/:lineKey      — list takes for a line (F1653)
 *  PUT    /stories/:id/takes/:lineKey/active{takeId} — pick the best take (F1653)
 *  GET    /takes/:takeId/audio             — fetch a take's audio (base64)
 *  DELETE /takes/:takeId                   — delete a take (F1652)
 *  POST   /stories/:id/recording-plan      — human/TTS/uncast plan + checklist
 *                                            (F1656/F1657)
 *
 * Mic capture, the waveform editor, noise gate/normalize, and the mobile PWA
 * recorder are the web layer; this stores takes content-addressed and resolves
 * the mixed human+TTS plan they drive.
 */

import { notFound, validation } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { StoryId } from '@fables/core';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { storiesRepo } from '../db/repos/stories.js';
import { recordingTakesRepo, type TakeFormat } from '../db/repos/recording-takes.js';
import { buildRecordingPlan, sessionChecklist } from '../audio/studio/plan.js';

registerRoute({
  method: 'POST',
  path: '/stories/:id/takes',
  summary: 'Upload a narration take (F1651)',
});
registerRoute({
  method: 'GET',
  path: '/stories/:id/takes/:lineKey',
  summary: 'List takes for a line (F1653)',
});
registerRoute({
  method: 'PUT',
  path: '/stories/:id/takes/:lineKey/active',
  summary: 'Pick the active take (F1653)',
});
registerRoute({ method: 'GET', path: '/takes/:takeId/audio', summary: 'Fetch take audio' });
registerRoute({ method: 'DELETE', path: '/takes/:takeId', summary: 'Delete a take (F1652)' });
registerRoute({
  method: 'POST',
  path: '/stories/:id/recording-plan',
  summary: 'Mixed human/TTS recording plan (F1656/F1657)',
});

const TAKE_FORMATS = ['opus', 'wav', 'webm', 'mp4'] as const;

const addTakeBody = z.object({
  lineKey: z.string().min(1).max(200),
  format: z.enum(TAKE_FORMATS),
  durationMs: z.number().int().min(0).optional(),
  /** base64-encoded audio bytes. */
  audio: z.string().min(1).max(50_000_000),
});

const planBody = z.object({
  lines: z
    .array(
      z.object({
        lineKey: z.string().min(1),
        text: z.string(),
        cast: z.boolean(),
      }),
    )
    .max(20_000),
});

export const studioRoutes: FastifyPluginAsync = async (app) => {
  const stories = storiesRepo(app.db);
  const takes = recordingTakesRepo(app.db);

  app.post('/stories/:id/takes', async (request) => {
    const { id } = parseWith(z.object({ id: z.string().min(1) }), request.params, 'params');
    const body = parseWith(addTakeBody, request.body, 'body');
    stories.mustGet(id as StoryId);
    const audio = Buffer.from(body.audio, 'base64');
    if (audio.byteLength === 0) throw validation('audio is empty');
    const take = takes.add({
      storyId: id,
      lineKey: body.lineKey,
      audio,
      format: body.format as TakeFormat,
      ...(body.durationMs !== undefined ? { durationMs: body.durationMs } : {}),
    });
    return { data: take };
  });

  app.get('/stories/:id/takes/:lineKey', async (request) => {
    const { id, lineKey } = parseWith(
      z.object({ id: z.string().min(1), lineKey: z.string().min(1) }),
      request.params,
      'params',
    );
    return { data: { takes: takes.list(id, lineKey) } };
  });

  app.put('/stories/:id/takes/:lineKey/active', async (request) => {
    parseWith(
      z.object({ id: z.string().min(1), lineKey: z.string().min(1) }),
      request.params,
      'params',
    );
    const { takeId } = parseWith(z.object({ takeId: z.string().min(1) }), request.body, 'body');
    if (!takes.setActive(takeId)) throw notFound('take', takeId);
    return { data: { active: takeId } };
  });

  app.get('/takes/:takeId/audio', async (request) => {
    const { takeId } = parseWith(z.object({ takeId: z.string().min(1) }), request.params, 'params');
    const audio = takes.audio(takeId);
    if (!audio) throw notFound('take', takeId);
    return { data: { audio: Buffer.from(audio).toString('base64'), bytes: audio.byteLength } };
  });

  app.delete('/takes/:takeId', async (request) => {
    const { takeId } = parseWith(z.object({ takeId: z.string().min(1) }), request.params, 'params');
    if (!takes.remove(takeId)) throw notFound('take', takeId);
    return { data: { removed: true } };
  });

  app.post('/stories/:id/recording-plan', async (request) => {
    const { id } = parseWith(z.object({ id: z.string().min(1) }), request.params, 'params');
    const body = parseWith(planBody, request.body, 'body');
    stories.mustGet(id as StoryId);
    const recorded = takes.recordedLineKeys(id);
    const plan = buildRecordingPlan(body.lines, recorded);
    return { data: { plan, checklist: sessionChecklist(plan) } };
  });
};
