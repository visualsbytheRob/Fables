/**
 * Local analytics API routes (F971–F980).
 *
 *  GET  /analytics/stats        — feature usage, slow ops, errors
 *  GET  /analytics/knowledge    — knowledge growth over time
 *  GET  /analytics/stories      — story play/completion metrics
 *  GET  /analytics/settings     — opt-out flag + retention config
 *  PATCH /analytics/settings    — update opt-out / retention
 *  POST  /analytics/purge       — purge old events immediately
 *  POST  /analytics/event       — record a client-side event (no egress)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import {
  getAnalyticsSettings,
  getErrorStats,
  getFeatureUsage,
  getKnowledgeGrowth,
  getSlowOpStats,
  getStoryMetrics,
  purgeOldAnalytics,
  record,
  updateAnalyticsSettings,
} from '../services/analytics.js';

registerRoute({ method: 'GET', path: '/analytics/stats', summary: 'Local usage stats dashboard' });
registerRoute({
  method: 'GET',
  path: '/analytics/knowledge',
  summary: 'Knowledge growth metrics over time',
});
registerRoute({
  method: 'GET',
  path: '/analytics/stories',
  summary: 'Story play and completion metrics',
});
registerRoute({
  method: 'GET',
  path: '/analytics/settings',
  summary: 'Analytics settings (opt-out, retention)',
});
registerRoute({ method: 'PATCH', path: '/analytics/settings', summary: 'Update analytics settings' });
registerRoute({ method: 'POST', path: '/analytics/purge', summary: 'Purge old analytics events' });
registerRoute({ method: 'POST', path: '/analytics/event', summary: 'Record a client-side event' });

const settingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
});

const clientEventSchema = z.object({
  category: z.string().min(1).max(100),
  label: z.string().max(200).default(''),
  value: z.number().default(1),
  meta: z.record(z.string(), z.unknown()).default({}),
});

const statsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/analytics/stats', async (request) => {
    const { days } = parseWith(statsQuerySchema, request.query, 'query');
    const settings = getAnalyticsSettings(app.db);
    return {
      data: {
        settings,
        featureUsage: getFeatureUsage(app.db, days),
        slowOps: getSlowOpStats(app.db, Math.min(days, 7)),
        errors: getErrorStats(app.db, Math.min(days, 7)),
        privacy: 'All data is local-only. No network egress ever.',
      },
    };
  });

  app.get('/analytics/knowledge', async (request) => {
    const { days } = parseWith(statsQuerySchema, request.query, 'query');
    return { data: getKnowledgeGrowth(app.db, days) };
  });

  app.get('/analytics/stories', async () => {
    return { data: getStoryMetrics(app.db) };
  });

  app.get('/analytics/settings', async () => {
    return {
      data: {
        ...getAnalyticsSettings(app.db),
        privacyNote:
          'Fables analytics are 100% local. Data never leaves your machine. ' +
          'Set enabled=false to stop all collection.',
      },
    };
  });

  app.patch('/analytics/settings', async (request) => {
    const patch = parseWith(settingsPatchSchema, request.body, 'body');
    return { data: updateAnalyticsSettings(app.db, patch) };
  });

  app.post('/analytics/purge', async () => {
    const deleted = purgeOldAnalytics(app.db);
    return { data: { deleted } };
  });

  /** Client-side event ingestion — e.g., UI interactions, client-side perf. */
  app.post('/analytics/event', async (request) => {
    const event = parseWith(clientEventSchema, request.body, 'body');
    record(app.db, 'feature_use', event.category, event.label, event.value, event.meta);
    return { data: { recorded: true } };
  });
};
