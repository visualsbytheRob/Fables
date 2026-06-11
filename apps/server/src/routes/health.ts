import type { FastifyPluginAsync } from 'fastify';
import { APP_VERSION } from '../app.js';

const startedAt = Date.now();

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => ({
    data: {
      status: 'ok',
      version: APP_VERSION,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      // db status lands with F031; reported as not-connected until then
      db: 'not-connected',
    },
  }));
};
