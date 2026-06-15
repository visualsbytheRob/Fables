/**
 * Learning insights routes (Epic 18, F1751–F1759).
 *
 *  GET /learning/insights/retention   — true retention (F1751)
 *  GET /learning/insights/heatmap     — reviews per day (F1752)
 *  GET /learning/insights/forecast    — workload forecast (F1753)
 *  GET /learning/insights/difficulty  — difficulty distribution (F1754)
 *  GET /learning/insights/leeches     — leeches + remediation (F1755)
 *  GET /learning/insights/coverage    — knowledge coverage map (F1757)
 *  GET /learning/insights/streak      — review streak (F1758)
 *  GET /learning/insights/export      — everything, bundled (F1759)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { learningInsightsRepo } from '../db/repos/learning-insights.js';

const paths = [
  ['retention', 'True retention (F1751)'],
  ['heatmap', 'Review heatmap (F1752)'],
  ['forecast', 'Workload forecast (F1753)'],
  ['difficulty', 'Difficulty distribution (F1754)'],
  ['leeches', 'Leech detection (F1755)'],
  ['coverage', 'Knowledge coverage (F1757)'],
  ['streak', 'Review streak (F1758)'],
  ['export', 'Export all insights (F1759)'],
] as const;
for (const [p, summary] of paths) {
  registerRoute({ method: 'GET', path: `/learning/insights/${p}`, summary });
}

const sinceQuery = z.object({ since: z.string().datetime().optional() });
const nowQuery = z.object({
  now: z.string().datetime().optional(),
  days: z.coerce.number().int().min(1).max(365).optional(),
});

export const learningInsightsRoutes: FastifyPluginAsync = async (app) => {
  const repo = learningInsightsRepo(app.db);
  const nowIso = () => new Date().toISOString();

  app.get('/learning/insights/retention', async (request) => {
    const q = parseWith(sinceQuery, request.query, 'query');
    return { data: repo.trueRetention(q.since) };
  });

  app.get('/learning/insights/heatmap', async (request) => {
    const q = parseWith(sinceQuery, request.query, 'query');
    return { data: { days: repo.heatmap(q.since) } };
  });

  app.get('/learning/insights/forecast', async (request) => {
    const q = parseWith(nowQuery, request.query, 'query');
    return { data: { forecast: repo.forecast(q.now ?? nowIso(), q.days) } };
  });

  app.get('/learning/insights/difficulty', async () => {
    return { data: { distribution: repo.difficultyDistribution() } };
  });

  app.get('/learning/insights/leeches', async (request) => {
    const q = parseWith(
      z.object({ minLapses: z.coerce.number().int().min(1).max(100).optional() }),
      request.query,
      'query',
    );
    return { data: { leeches: repo.leeches(q.minLapses) } };
  });

  app.get('/learning/insights/coverage', async () => {
    return { data: repo.coverage() };
  });

  app.get('/learning/insights/streak', async (request) => {
    const q = parseWith(
      z.object({ now: z.string().datetime().optional() }),
      request.query,
      'query',
    );
    return { data: repo.streak(q.now ?? nowIso()) };
  });

  app.get('/learning/insights/export', async (request) => {
    const q = parseWith(
      z.object({ now: z.string().datetime().optional() }),
      request.query,
      'query',
    );
    return { data: repo.exportAll(q.now ?? nowIso()) };
  });
};
