/**
 * Generative art routes (Epic 19, F1861–F1868).
 *
 *  GET  /art/status            — image backend availability + style presets
 *  GET  /art/styles            — style preset catalogue (F1866)
 *  POST /stories/:id/cover     — generate (or typographic-fallback) a cover (F1863)
 *  POST /entities/:id/portrait — generate an entity portrait (F1864)
 *  GET  /art/assets/:hash      — fetch a generated asset's bytes (F1868)
 *
 * When no ComfyUI backend is configured, cover generation degrades to a clean
 * typographic SVG — a fable always gets a cover.
 */

import { notFound } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { StoryId, EntityId } from '@fables/core';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { storiesRepo } from '../db/repos/stories.js';
import { entitiesRepo } from '../db/repos/entities.js';
import { generatedAssetsRepo } from '../db/repos/generated-assets.js';
import { ArtRuntime } from '../art/runtime.js';
import { ComfyAdapter } from '../art/comfy.js';
import {
  buildCoverPrompt,
  buildPortraitPrompt,
  resolveStyle,
  STYLE_PRESETS,
} from '../art/prompts.js';
import { typographicCover } from '../art/fallback.js';

registerRoute({ method: 'GET', path: '/art/status', summary: 'Image backend status (F1861)' });
registerRoute({ method: 'GET', path: '/art/styles', summary: 'Style presets (F1866)' });
registerRoute({ method: 'POST', path: '/stories/:id/cover', summary: 'Generate a cover (F1863)' });
registerRoute({
  method: 'POST',
  path: '/entities/:id/portrait',
  summary: 'Generate a portrait (F1864)',
});
registerRoute({
  method: 'GET',
  path: '/art/assets/:hash',
  summary: 'Fetch a generated asset (F1868)',
});

export const artRoutes: FastifyPluginAsync = async (app) => {
  const stories = storiesRepo(app.db);
  const entities = entitiesRepo(app.db);
  const assets = generatedAssetsRepo(app.db);
  // Local + cloud ComfyUI adapters; both unavailable until configured.
  const art = new ArtRuntime()
    .register(new ComfyAdapter({ name: 'comfy-local' }))
    .register(new ComfyAdapter({ name: 'comfy-cloud' }));

  app.get('/art/status', async () => {
    const available = await art.isAvailable();
    return { data: { available, styles: Object.keys(STYLE_PRESETS) } };
  });

  app.get('/art/styles', async () => {
    return { data: { presets: STYLE_PRESETS } };
  });

  app.post('/stories/:id/cover', async (request) => {
    const { id } = parseWith(z.object({ id: z.string().min(1) }), request.params, 'params');
    const body = parseWith(
      z.object({ theme: z.string().max(200).optional(), style: z.string().max(50).optional() }),
      request.body,
      'body',
    );
    const story = stories.mustGet(id as StoryId);
    const style = resolveStyle(body.style);
    const prompt = buildCoverPrompt(story.title, story.description, body.theme ?? '', style);

    if (await art.isAvailable()) {
      const result = await art.generate({
        prompt: prompt.prompt,
        negative: prompt.negative,
        width: 600,
        height: 900,
      });
      const asset = assets.store({
        kind: 'cover',
        subjectId: id,
        format: result.format,
        data: result.image,
        adapter: result.provenance.adapter,
        prompt: prompt.prompt,
      });
      return { data: { ...asset, fallback: false } };
    }
    // Typographic fallback (F1863).
    const svg = typographicCover(story.title, story.description, body.theme ?? story.title);
    const asset = assets.store({
      kind: 'cover',
      subjectId: id,
      format: 'svg',
      data: new TextEncoder().encode(svg),
      adapter: 'typographic',
      prompt: prompt.prompt,
    });
    return { data: { ...asset, fallback: true } };
  });

  app.post('/entities/:id/portrait', async (request) => {
    const { id } = parseWith(z.object({ id: z.string().min(1) }), request.params, 'params');
    const body = parseWith(
      z.object({ style: z.string().max(50).optional() }),
      request.body,
      'body',
    );
    const entity = entities.get(id as EntityId);
    if (!entity) throw notFound('entity', id);
    const style = resolveStyle(body.style);
    const prompt = buildPortraitPrompt(
      { name: entity.name, type: entity.type, fields: entity.fields },
      style,
    );
    if (!(await art.isAvailable())) {
      return { data: { available: false, prompt: prompt.prompt } };
    }
    const result = await art.generate({
      prompt: prompt.prompt,
      negative: prompt.negative,
      width: 512,
      height: 512,
    });
    const asset = assets.store({
      kind: 'portrait',
      subjectId: id,
      format: result.format,
      data: result.image,
      adapter: result.provenance.adapter,
      prompt: prompt.prompt,
    });
    return { data: { ...asset, available: true } };
  });

  app.get('/art/assets/:hash', async (request) => {
    const { hash } = parseWith(z.object({ hash: z.string().min(1) }), request.params, 'params');
    const asset = assets.data(hash);
    if (!asset) throw notFound('asset', hash);
    return {
      data: { format: asset.format, base64: Buffer.from(asset.bytes).toString('base64') },
    };
  });
};
