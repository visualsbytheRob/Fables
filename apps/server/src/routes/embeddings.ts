/**
 * Embeddings routes (F724–F729):
 *   GET  /embeddings/status           — queue depth, coverage %, provider info
 *   POST /embeddings/backfill         — trigger a full backfill (async, returns 202)
 *   POST /embeddings/reembed-all      — model-swap path: delete+re-embed everything
 */

import type { FastifyPluginAsync } from 'fastify';
import { embeddingsRepo } from '../db/repos/embeddings.js';

export const embeddingsRoutes: FastifyPluginAsync = async (app) => {
  /** GET /embeddings/status */
  app.get('/embeddings/status', async () => {
    const repo = embeddingsRepo(app.db);
    const coverage = repo.coverage(app.intel.provider.id);
    const queueStatus = app.intel.queue.status();

    return {
      data: {
        provider: {
          id: app.intel.provider.id,
          dim: app.intel.provider.dim,
          available: app.intel.provider.available(),
        },
        coverage,
        queue: queueStatus,
      },
    };
  });

  /**
   * POST /embeddings/backfill
   * Runs the backfill in the background and returns 202 immediately.
   * Progress can be tracked via GET /embeddings/status.
   */
  app.post('/embeddings/backfill', async (_req, reply) => {
    // Fire-and-forget backfill (single-user app — no concurrency concern)
    void app.intel.queue.backfill();
    reply.status(202);
    return { data: { message: 'backfill started', provider: app.intel.provider.id } };
  });

  /**
   * POST /embeddings/reembed-all
   * Model-swap path (F729): deletes all embeddings for the current provider
   * and triggers a full backfill.
   */
  app.post('/embeddings/reembed-all', async (_req, reply) => {
    const repo = embeddingsRepo(app.db);
    const deleted = repo.deleteAllForProvider(app.intel.provider.id);
    void app.intel.queue.backfill();
    reply.status(202);
    return {
      data: {
        message: 're-embed started',
        provider: app.intel.provider.id,
        deletedChunks: deleted,
      },
    };
  });
};
