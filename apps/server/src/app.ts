import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import compress from '@fastify/compress';
import cors from '@fastify/cors';
import etag from '@fastify/etag';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { isAppError, type ErrorCode } from '@fables/core';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import { openDb, type Db } from './db/connection.js';
import { instrumentDb } from './db/instrument.js';
import { migrate } from './db/migrate.js';
import { runBootJobs } from './jobs.js';
import { buildLoggerOptions } from './logging.js';
import { configRoutes } from './routes/config.js';
import { routes } from './routes/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    /** Root of on-disk storage (attachments live under `<dataDir>/attachments`). */
    dataDir: string;
  }
}

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
    logger: buildLoggerOptions(config) as { level: string },
    genReqId: () => crypto.randomUUID(),
    disableRequestLogging: config.env === 'test',
    // Above the JSON-body ceiling our own 1 MB note-body guard enforces (F118).
    bodyLimit: 8 * 1024 * 1024,
  });

  const db = instrumentDb(openDb(config.env === 'test' ? ':memory:' : config.dataDir), app.log);
  const { applied } = migrate(db);
  if (applied.length > 0) app.log.info({ applied }, 'database migrations applied');
  app.decorate('db', db);
  app.decorate('dataDir', config.dataDir);
  app.addHook('onClose', () => {
    db.close();
  });

  // Boot maintenance: trash auto-purge (F107), orphan tags (F159), attachment GC (F164).
  // Skipped in tests: the in-memory db must never drive deletions in a real dataDir.
  if (config.env !== 'test') runBootJobs(db, config.dataDir, app.log);

  await app.register(cors, {
    // Single-user app on a tailnet: allow the ts.net origin and localhost dev ports.
    origin: [/^https?:\/\/localhost(:\d+)?$/, /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/],
  });
  await app.register(etag);
  await app.register(compress, { global: true, encodings: ['br', 'gzip'] });
  await app.register(rateLimit, {
    // Generous: this protects against runaway scripts, not adversaries — the
    // tailnet is the actual perimeter.
    max: 600,
    timeWindow: '1 minute',
  });

  // API version negotiation (F086): clients can pin via x-fables-api-version.
  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-fables-api-version', '1');
  });

  app.setErrorHandler((error, request, reply) => {
    if (isAppError(error)) {
      return reply
        .status(HTTP_STATUS[error.code])
        .send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    if ((error as { statusCode?: number }).statusCode === 413) {
      return reply.status(413).send({
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'request body too large', details: null },
      });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply
      .status(500)
      .send({ error: { code: 'INTERNAL', message: 'internal server error', details: null } });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `no route for ${request.method} ${request.url}`,
        details: null,
      },
    });
  });

  // Every resource module registers under the version prefix.
  for (const route of routes) {
    await app.register(route, { prefix: '/api/v1' });
  }
  await app.register(configRoutes(config), { prefix: '/api/v1' });

  // Serve the built web app when it exists (production mode).
  const webDist = path.resolve(fileURLToPath(import.meta.url), '../../../web/dist');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    // SPA fallback for client-side routes — but API misses must stay JSON 404s.
    app.get('/*', (request, reply) => {
      if (request.url.startsWith('/api/')) return reply.callNotFound();
      return reply.sendFile('index.html');
    });
  }

  return app;
}
