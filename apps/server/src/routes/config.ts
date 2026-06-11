import type { FastifyPluginAsync } from 'fastify';
import { APP_VERSION } from '../app.js';
import type { AppConfig } from '../config.js';

/** Exposes the effective, non-sensitive configuration for debugging and the web client. */
export function configRoutes(config: AppConfig): FastifyPluginAsync {
  return async (app) => {
    app.get('/config', async () => ({
      data: {
        version: APP_VERSION,
        env: config.env,
        port: config.port,
        host: config.host,
        dataDir: config.dataDir,
        logLevel: config.logLevel,
      },
    }));
  };
}
