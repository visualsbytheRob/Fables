/**
 * Story portability routes (F582–F584, F588).
 *
 *  GET  /stories/:id/export.bin   — compiled `.fable.bin` download (F582)
 *  GET  /stories/:id/export.html  — self-contained single-file HTML (F583)
 *  GET  /stories/:id/qr           — QR code (SVG) for the story's tailnet URL (F588)
 *  POST /stories/import/bin       — validate an uploaded `.fable.bin` (F584)
 *
 * Export compiles the story's entry source through the pure forge-export core;
 * the `.fable.bin` round-trips to the identical program (verified by fingerprint
 * in tests, F589). Importing a compiled `.bin` validates it — bytecode is not
 * decompiled to editable source, so import is the integrity-check path; ZIP
 * source bundles import through the existing fablepack route.
 */

import { notFound, validation, type StoryId } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { storiesRepo } from '../db/repos/stories.js';
import { storySavesRepo } from '../db/repos/story-saves.js';
import { packFableBin, validateFableBin } from '../forge-export/pack.js';
import { exportStoryHtml } from '../forge-export/html.js';
import { qrToSvg } from '../forge-export/qr.js';
import { MINIMAL_PLAYER_JS } from '../forge-export/player.js';
import { toSaveSlot } from '../stories/save-slots.js';
import { compileStory, deserializeProgram } from '@fables/forge-vm';

const idParam = z.object({ id: z.string().min(1) });

registerRoute({
  method: 'GET',
  path: '/stories/:id/export.bin',
  summary: 'Export .fable.bin (F582)',
});
registerRoute({
  method: 'GET',
  path: '/stories/:id/export.html',
  summary: 'Self-contained HTML (F583)',
});
registerRoute({ method: 'GET', path: '/stories/:id/qr', summary: 'Story QR code (F588)' });
registerRoute({
  method: 'POST',
  path: '/stories/import/bin',
  summary: 'Validate a .fable.bin (F584)',
});
registerRoute({
  method: 'GET',
  path: '/stories/:id/save-slots',
  summary: 'Save-slot metadata (F467)',
});

export const storyExportRoutes: FastifyPluginAsync = async (app) => {
  const stories = () => storiesRepo(app.db);

  const entrySource = (id: string): { title: string; source: string } => {
    const story = stories().get(id as StoryId);
    if (!story) throw notFound('story', id);
    const file = stories().getFileByPath(story.id, story.entryFile);
    if (file === null) throw notFound('story entry file', story.entryFile);
    return { title: story.title, source: file.source };
  };

  app.get('/stories/:id/export.bin', async (request, reply) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const { title, source } = entrySource(id);
    let bytes: Uint8Array;
    try {
      bytes = packFableBin(source, { title });
    } catch (err) {
      throw validation(`story does not compile: ${(err as Error).message}`);
    }
    return reply
      .header('content-type', 'application/octet-stream')
      .header('content-disposition', `attachment; filename="${safeName(title)}.fable.bin"`)
      .send(Buffer.from(bytes));
  });

  app.get('/stories/:id/export.html', async (request, reply) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const { title, source } = entrySource(id);
    let html: string;
    try {
      html = exportStoryHtml(source, { title }, { playerRuntimeJs: MINIMAL_PLAYER_JS });
    } catch (err) {
      throw validation(`story does not compile: ${(err as Error).message}`);
    }
    return reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('content-disposition', `attachment; filename="${safeName(title)}.html"`)
      .send(html);
  });

  app.get('/stories/:id/qr', async (request, reply) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const q = parseWith(
      z.object({ baseUrl: z.string().url().max(500).default('http://fables.local') }),
      request.query,
      'query',
    );
    const story = stories().get(id as StoryId);
    if (!story) throw notFound('story', id);
    const url = `${q.baseUrl.replace(/\/+$/, '')}/stories/${id}/play`;
    return reply
      .header('content-type', 'image/svg+xml; charset=utf-8')
      .send(qrToSvg(url, { ecc: 'M' }));
  });

  app.get('/stories/:id/save-slots', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const { source } = entrySource(id);
    // Count the story's knots from its compiled program for a real progress %.
    let totalKnots = 0;
    try {
      const program = deserializeProgram(compileStory(source));
      totalKnots = program.containers.filter((c) => c.kind === 'knot').length;
    } catch {
      totalKnots = 0; // uncompilable → progress reported as null
    }
    const saves = storySavesRepo(app.db).listFull(id as StoryId);
    const slots = saves.map((s) =>
      toSaveSlot(
        {
          id: s.id,
          name: s.name,
          kind: s.kind,
          turn: s.turn,
          scene: s.scene,
          state: s.state,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        },
        totalKnots,
      ),
    );
    return { data: { slots, totalKnots } };
  });

  app.post('/stories/import/bin', async (request) => {
    const body = parseWith(z.object({ data: z.string().min(1) }), request.body, 'body');
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(Buffer.from(body.data, 'base64'));
    } catch {
      throw validation('data is not valid base64');
    }
    const result = validateFableBin(bytes);
    return { data: result };
  });
};

function safeName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'story';
}
