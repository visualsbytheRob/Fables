/**
 * Story interop import routes (Epic 19, F1821/F1822/F1828/F1831/F1833/F1839).
 *
 *  POST /import/ink     — convert Ink source → Forge (+ unsupported report);
 *                         optionally create a story from it
 *  POST /import/twine   — convert Twee 3 source → Forge (+ report)
 *
 * The converters (import/ink, import/twine) guarantee compilable Forge output,
 * dropping and reporting constructs that don't map.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { storiesRepo } from '../db/repos/stories.js';
import { inkToForge } from '../import/ink/ink.js';
import { tweeToForge } from '../import/twine/twee.js';

registerRoute({ method: 'POST', path: '/import/ink', summary: 'Import Ink → Forge (F1821/F1828)' });
registerRoute({
  method: 'POST',
  path: '/import/twine',
  summary: 'Import Twee → Forge (F1831/F1839)',
});
registerRoute({
  method: 'GET',
  path: '/interop/conformance',
  summary: 'Interop conformance status (F1892)',
});

const body = z.object({
  source: z.string().min(1).max(5_000_000),
  /** When set, a new story is created from the converted Forge. */
  title: z.string().min(1).max(200).optional(),
});

export const interopRoutes: FastifyPluginAsync = async (app) => {
  const stories = storiesRepo(app.db);

  /** Create a story from converted Forge and return its id, if a title was given. */
  const maybeCreate = (title: string | undefined, forge: string): string | null => {
    if (title === undefined) return null;
    const story = stories.create({ title });
    stories.createFile(story.id, 'main.fable', forge);
    return story.id;
  };

  app.post('/import/ink', async (request) => {
    const b = parseWith(body, request.body, 'body');
    const { forge, unsupported } = inkToForge(b.source);
    const storyId = maybeCreate(b.title, forge);
    return { data: { forge, unsupported, storyId } };
  });

  app.post('/import/twine', async (request) => {
    const b = parseWith(body, request.body, 'body');
    const { forge, start, passages, unsupported } = tweeToForge(b.source);
    const storyId = maybeCreate(b.title, forge);
    return { data: { forge, start, passages, unsupported, storyId } };
  });

  // Interop conformance dashboard data (F1892): which formats we read/write.
  app.get('/interop/conformance', async () => {
    return {
      data: {
        formats: {
          ink: { import: true, export: false, note: 'common subset → compilable Forge' },
          twine: { import: true, export: false, note: 'Twee 3 → compilable Forge' },
          anki: { import: true, export: true, note: '.apkg notes/cards + scheduling' },
          fablepack: { import: true, export: true, note: 'native deterministic pack' },
          fablearchive: { import: true, export: true, note: 'fixity-verified archive' },
          standalone: { import: false, export: 'web', note: 'single-file HTML player (web build)' },
        },
      },
    };
  });
};
