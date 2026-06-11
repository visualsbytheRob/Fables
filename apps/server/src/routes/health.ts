import type { FastifyPluginAsync } from 'fastify';
import { APP_VERSION } from '../app.js';

const startedAt = Date.now();

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => {
    let dbStatus = 'ok';
    try {
      app.db.prepare('SELECT 1').get();
    } catch {
      dbStatus = 'error';
    }
    return {
      data: {
        status: dbStatus === 'ok' ? 'ok' : 'degraded',
        version: APP_VERSION,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        db: dbStatus,
      },
    };
  });
};
