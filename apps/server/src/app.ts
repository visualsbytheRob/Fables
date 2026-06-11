import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { isAppError, type ErrorCode } from '@fables/core';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import { routes } from './routes/index.js';

const HTTP_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  FORBIDDEN: 403,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export const APP_VERSION = '0.1.0';

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      ...(config.env === 'development'
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
        : {}),
    },
    genReqId: () => crypto.randomUUID(),
    disableRequestLogging: config.env === 'test',
  });

  await app.register(cors, {
    // Single-user app on a tailnet: allow the ts.net origin and localhost dev ports.
    origin: [/^https?:\/\/localhost(:\d+)?$/, /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/],
  });

  app.setErrorHandler((error, request, reply) => {
    if (isAppError(error)) {
      return reply
        .status(HTTP_STATUS[error.code])
        .send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply
      .status(500)
      .send({ error: { code: 'INTERNAL', message: 'internal server error', details: null } });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `no route for ${request.method} ${request.url}`, details: null },
    });
  });

  // Every resource module registers under the version prefix.
  for (const route of routes) {
    await app.register(route, { prefix: '/api/v1' });
  }

  // Serve the built web app when it exists (production mode).
  const webDist = path.resolve(fileURLToPath(import.meta.url), '../../../web/dist');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.get('/*', (_request, reply) => reply.sendFile('index.html'));
  }

  return app;
}
