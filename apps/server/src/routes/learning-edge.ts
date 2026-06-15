/**
 * Scheduler edge-case + settings routes (Epic 18, F1761–F1768).
 *
 *  GET  /learning/settings     — vacation/caps/relearning/priority settings
 *  PUT  /learning/settings     — update them
 *  GET  /review/session        — a polished session: vacation-aware, sibling-
 *                                spaced, catch-up-capped, priority-ordered
 *                                (F1761/F1764/F1765/F1766)
 *  GET  /cards/duplicates      — cards sharing a prompt (F1762)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { cardsRepo, type Card } from '../db/repos/cards.js';
import { learningSettingsRepo, type LearningSettings } from '../db/repos/learning-settings.js';
import { spaceSiblings, applyCatchUp, findDuplicates } from '../learning/edge.js';

registerRoute({ method: 'GET', path: '/learning/settings', summary: 'Learning settings' });
registerRoute({
  method: 'PUT',
  path: '/learning/settings',
  summary: 'Update learning settings (F1764)',
});
registerRoute({
  method: 'GET',
  path: '/review/session',
  summary: 'Polished review session (F1761/F1765)',
});
registerRoute({ method: 'GET', path: '/cards/duplicates', summary: 'Duplicate cards (F1762)' });

const settingsBody = z
  .object({
    vacationUntil: z.string().datetime().nullable(),
    dailyNewCap: z.number().int().min(0).max(10_000),
    dailyReviewCap: z.number().int().min(0).max(100_000),
    relearningSteps: z.array(z.number().int().min(1).max(100_000)).max(20),
    maxIntervalDays: z
      .number()
      .int()
      .min(1)
      .max(365 * 100),
    requestRetention: z.number().min(0.7).max(0.99),
    priorityOverrides: z.record(z.string(), z.number()),
  })
  .partial();

export const learningEdgeRoutes: FastifyPluginAsync = async (app) => {
  const cards = cardsRepo(app.db);
  const settings = learningSettingsRepo(app.db);

  app.get('/learning/settings', async () => {
    return { data: settings.get() };
  });

  app.put('/learning/settings', async (request) => {
    const patch = parseWith(settingsBody, request.body, 'body');
    // Drop undefined keys so we never clobber defaults.
    const clean: Partial<LearningSettings> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) (clean as Record<string, unknown>)[k] = v;
    }
    return { data: settings.update(clean) };
  });

  app.get('/cards/duplicates', async () => {
    const all = cards.browse({ limit: 100_000 });
    return { data: { duplicates: findDuplicates(all) } };
  });

  app.get('/review/session', async (request) => {
    const q = parseWith(
      z.object({ now: z.string().datetime().optional() }),
      request.query,
      'query',
    );
    const now = q.now ?? new Date().toISOString();
    const cfg = settings.get();

    if (settings.onVacation(now)) {
      return { data: { vacation: true, cards: [], deferred: 0 } };
    }

    // Pull the raw due queue, capped by the daily settings.
    const raw = cards.dueQueue({ now, limit: cfg.dailyReviewCap, newLimit: cfg.dailyNewCap });
    // Catch-up cap, then sibling-space, then apply priority overrides (stable).
    const { session, deferred } = applyCatchUp(raw, {
      dueCap: cfg.dailyReviewCap,
      newCap: cfg.dailyNewCap,
    });
    const spaced = spaceSiblings(session);
    const prioritised = stableSortByPriority(spaced, cfg.priorityOverrides);

    return { data: { vacation: false, cards: prioritised, deferred: deferred.length } };
  });
};

/** Stable sort: cards with a higher priority override come first; ties keep order. */
function stableSortByPriority(cards: Card[], overrides: Record<string, number>): Card[] {
  return cards
    .map((c, i) => ({ c, i, p: overrides[c.id] ?? 0 }))
    .sort((a, b) => b.p - a.p || a.i - b.i)
    .map((x) => x.c);
}
