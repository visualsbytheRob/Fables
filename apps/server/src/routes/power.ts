/**
 * Power-tools routes (Epic 20, F1981–F1985).
 *
 *  GET /power/stats       — vault statistics deep-dive (F1981)
 *  GET /power/duplicates  — duplicate + near-duplicate note finder (F1982)
 *  GET /power/broken      — broken links, missing attachments, empty notes (F1983)
 *  POST /power/lint       — vault linter with fix-its (F1984)
 *  GET /power/storage     — storage analyzer (F1985)
 *
 * Read-only analyses over the live vault; the heavy logic lives in the pure
 * `power/analyze.ts` module, these handlers just load data and hand it over.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import {
  vaultBroken,
  vaultDuplicates,
  vaultLint,
  vaultStatistics,
  vaultStorage,
} from '../services/power.js';

registerRoute({ method: 'GET', path: '/power/stats', summary: 'Vault statistics (F1981)' });
registerRoute({ method: 'GET', path: '/power/duplicates', summary: 'Duplicate finder (F1982)' });
registerRoute({
  method: 'GET',
  path: '/power/broken',
  summary: 'Broken-everything finder (F1983)',
});
registerRoute({ method: 'POST', path: '/power/lint', summary: 'Vault linter (F1984)' });
registerRoute({ method: 'GET', path: '/power/storage', summary: 'Storage analyzer (F1985)' });

export const powerRoutes: FastifyPluginAsync = async (app) => {
  app.get('/power/stats', async (request) => {
    const q = parseWith(
      z.object({ top: z.coerce.number().int().min(1).max(100).optional() }),
      request.query,
      'query',
    );
    return { data: vaultStatistics(app.db, app.dataDir, q.top) };
  });

  app.get('/power/duplicates', async (request) => {
    const q = parseWith(
      z.object({ threshold: z.coerce.number().min(0).max(1).optional() }),
      request.query,
      'query',
    );
    return {
      data: {
        groups: vaultDuplicates(
          app.db,
          q.threshold !== undefined ? { threshold: q.threshold } : undefined,
        ),
      },
    };
  });

  app.get('/power/broken', async () => {
    return { data: vaultBroken(app.db, app.dataDir) };
  });

  app.post('/power/lint', async (request) => {
    const body = parseWith(
      z.object({
        disabled: z.array(z.string()).max(50).optional(),
        maxWords: z.number().int().min(1).optional(),
        titlePattern: z.string().max(500).optional(),
      }),
      request.body ?? {},
      'body',
    );
    return {
      data: {
        findings: vaultLint(app.db, {
          ...(body.disabled !== undefined ? { disabled: body.disabled } : {}),
          ...(body.maxWords !== undefined ? { maxWords: body.maxWords } : {}),
          ...(body.titlePattern !== undefined ? { titlePattern: body.titlePattern } : {}),
        }),
      },
    };
  });

  app.get('/power/storage', async (request) => {
    const q = parseWith(
      z.object({ top: z.coerce.number().int().min(1).max(100).optional() }),
      request.query,
      'query',
    );
    return { data: vaultStorage(app.db, app.dataDir, q.top) };
  });
};
