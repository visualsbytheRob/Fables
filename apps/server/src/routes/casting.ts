/**
 * Voice casting routes (Epic 17, F1611–F1620).
 *
 *  POST /casting/analyze            — split text into narration/dialogue lines
 *                                     with attributed speakers (F1612/F1613)
 *  POST /casting/resolve            — resolve lines to voices via a cast sheet,
 *                                     applying fallback rules (F1618)
 *  GET  /stories/:id/cast           — the story's saved cast sheet (manifest, F1619)
 *  PUT  /stories/:id/cast           — save the story's cast sheet (F1616)
 *  GET  /casting/templates          — reusable cast templates (F1617)
 *  POST /casting/templates          — save a cast template (F1617)
 *  PUT  /entities/:id/voice         — assign a voice to an entity (F1611/F1615)
 *  DELETE /entities/:id/voice       — clear an entity's voice
 *
 * Attribution and resolution are pure (audio/casting/*); this just exposes them.
 */

import { notFound, validation } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { separateScript } from '../audio/casting/separate.js';
import { resolveCast, castCoverage, type CastSheet } from '../audio/casting/resolve.js';
import { castingRepo } from '../db/repos/casting.js';

registerRoute({
  method: 'POST',
  path: '/casting/analyze',
  summary: 'Attribute dialogue (F1612/F1613)',
});
registerRoute({
  method: 'POST',
  path: '/casting/resolve',
  summary: 'Resolve lines to voices (F1618)',
});
registerRoute({ method: 'GET', path: '/stories/:id/cast', summary: 'Story cast sheet (F1619)' });
registerRoute({
  method: 'PUT',
  path: '/stories/:id/cast',
  summary: 'Save story cast sheet (F1616)',
});
registerRoute({ method: 'GET', path: '/casting/templates', summary: 'Cast templates (F1617)' });
registerRoute({
  method: 'POST',
  path: '/casting/templates',
  summary: 'Save cast template (F1617)',
});
registerRoute({
  method: 'PUT',
  path: '/entities/:id/voice',
  summary: 'Assign entity voice (F1611)',
});
registerRoute({ method: 'DELETE', path: '/entities/:id/voice', summary: 'Clear entity voice' });

const idParams = z.object({ id: z.string().min(1) });

const voiceSchema = z.object({
  voiceId: z.string().min(1),
  rate: z.number().min(0.25).max(4).optional(),
  pitch: z.number().min(0.25).max(4).optional(),
});

const castSheetSchema = z.object({
  narrator: voiceSchema.nullable().default(null),
  bySpeaker: z.record(z.string(), voiceSchema).default({}),
  defaultCharacter: voiceSchema.nullable().default(null),
});

const analyzeBody = z.object({
  text: z.string().min(1).max(200_000),
  knownSpeakers: z.array(z.string().min(1)).max(500).optional(),
});

const resolveBody = z.object({
  text: z.string().min(1).max(200_000),
  knownSpeakers: z.array(z.string().min(1)).max(500).optional(),
  cast: castSheetSchema,
});

const saveCastBody = z.object({
  name: z.string().max(200).optional(),
  sheet: castSheetSchema,
});

const templateBody = z.object({
  name: z.string().min(1).max(200),
  sheet: castSheetSchema,
});

/** Normalise a zod-parsed cast sheet into the resolver's CastSheet shape. */
function toCastSheet(parsed: z.infer<typeof castSheetSchema>): CastSheet {
  return {
    narrator: parsed.narrator,
    bySpeaker: parsed.bySpeaker,
    defaultCharacter: parsed.defaultCharacter,
  };
}

export const castingRoutes: FastifyPluginAsync = async (app) => {
  const repo = castingRepo(app.db);

  app.post('/casting/analyze', async (request) => {
    const body = parseWith(analyzeBody, request.body, 'body');
    const lines = separateScript(body.text, body.knownSpeakers);
    const speakers = [...new Set(lines.filter((l) => l.speaker).map((l) => l.speaker!))];
    return { data: { lines, speakers } };
  });

  app.post('/casting/resolve', async (request) => {
    const body = parseWith(resolveBody, request.body, 'body');
    const lines = separateScript(body.text, body.knownSpeakers);
    const cast = toCastSheet(body.cast);
    const resolved = resolveCast(lines, cast);
    return { data: { lines: resolved, coverage: castCoverage(lines, cast) } };
  });

  app.get('/stories/:id/cast', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    return { data: repo.castSheets.manifest(id) };
  });

  app.put('/stories/:id/cast', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    const body = parseWith(saveCastBody, request.body, 'body');
    const sheet = toCastSheet(body.sheet);
    const existing = repo.castSheets.forStory(id);
    const rec = existing
      ? repo.castSheets.update(existing.id, {
          sheet,
          ...(body.name !== undefined ? { name: body.name } : {}),
        })
      : repo.castSheets.create({
          storyId: id,
          sheet,
          ...(body.name !== undefined ? { name: body.name } : {}),
        });
    return { data: rec };
  });

  app.get('/casting/templates', async () => {
    return { data: { templates: repo.castSheets.templates() } };
  });

  app.post('/casting/templates', async (request) => {
    const body = parseWith(templateBody, request.body, 'body');
    const rec = repo.castSheets.create({
      storyId: null,
      name: body.name,
      sheet: toCastSheet(body.sheet),
    });
    return { data: rec };
  });

  app.put('/entities/:id/voice', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    const body = parseWith(voiceSchema, request.body, 'body');
    // Guard against assigning to a non-existent entity.
    const exists = app.db.prepare('SELECT 1 FROM entities WHERE id = ?').get(id);
    if (!exists) throw notFound('entity', id);
    const voice = repo.entityVoices.set(id, {
      voiceId: body.voiceId,
      ...(body.rate !== undefined ? { rate: body.rate } : {}),
      ...(body.pitch !== undefined ? { pitch: body.pitch } : {}),
    });
    return { data: voice };
  });

  app.delete('/entities/:id/voice', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    const removed = repo.entityVoices.remove(id);
    if (!removed) throw validation('no voice assigned to that entity');
    return { data: { removed: true } };
  });
};
