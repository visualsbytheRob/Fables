/**
 * Anki interop routes (Epic 18, F1781/F1785).
 *
 *  POST /import/anki   — import an .apkg (base64) → cards with translated schedule
 *  POST /export/anki   — export cards (all, or a filter) to an .apkg (base64)
 *
 * The .apkg format and SM-2→FSRS scheduling translation live in import/anki/*.
 */

import { validation } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { cardsRepo } from '../db/repos/cards.js';
import { importApkg } from '../import/anki/import-anki.js';
import { exportApkg } from '../import/anki/apkg.js';

registerRoute({ method: 'POST', path: '/import/anki', summary: 'Import an .apkg (F1781)' });
registerRoute({ method: 'POST', path: '/export/anki', summary: 'Export cards to .apkg (F1785)' });

export const ankiRoutes: FastifyPluginAsync = async (app) => {
  const cards = cardsRepo(app.db);

  app.post('/import/anki', async (request) => {
    const body = parseWith(
      z.object({ apkg: z.string().min(1).max(200_000_000) }),
      request.body,
      'body',
    );
    const bytes = Buffer.from(body.apkg, 'base64');
    if (bytes.byteLength === 0) throw validation('empty .apkg');
    try {
      return { data: importApkg(app.db, bytes) };
    } catch (err) {
      throw validation((err as Error).message);
    }
  });

  app.post('/export/anki', async (request) => {
    const body = parseWith(
      z.object({
        kind: z.string().max(50).optional(),
        state: z
          .enum(['new', 'learning', 'review', 'relearning', 'suspended', 'buried'])
          .optional(),
        limit: z.number().int().min(1).max(100_000).optional(),
      }),
      request.body,
      'body',
    );
    const selected = cards.browse({
      ...(body.kind !== undefined ? { kind: body.kind } : {}),
      ...(body.state !== undefined ? { state: body.state } : {}),
      limit: body.limit ?? 100_000,
    });
    const apkg = exportApkg(
      selected.map((c) => ({ prompt: c.prompt, answer: c.answer, stability: c.stability })),
    );
    return {
      data: { apkg: apkg.toString('base64'), cardCount: selected.length, bytes: apkg.byteLength },
    };
  });
};
