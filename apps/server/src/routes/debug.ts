import { validation } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];
const startedAt = Date.now();

export const debugRoutes: FastifyPluginAsync = async (app) => {
  app.get('/debug/stats', async () => {
    const pageCount = app.db.pragma('page_count', { simple: true }) as number;
    const pageSize = app.db.pragma('page_size', { simple: true }) as number;
    const count = (table: string) =>
      (app.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    const mem = process.memoryUsage();
    return {
      data: {
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        db: {
          sizeBytes: pageCount * pageSize,
          notes: count('notes'),
          notebooks: count('notebooks'),
          stories: count('stories'),
          entities: count('entities'),
          links: count('links'),
        },
        memory: { rssBytes: mem.rss, heapUsedBytes: mem.heapUsed },
        logLevel: app.log.level,
      },
    };
  });

  /** Runtime log level control: POST /debug/log-level { "level": "debug" } */
  app.post('/debug/log-level', async (request) => {
    const body = request.body as { level?: string } | null;
    const level = body?.level;
    if (!level || !LOG_LEVELS.includes(level)) {
      throw validation(`level must be one of: ${LOG_LEVELS.join(', ')}`);
    }
    app.log.level = level;
    return { data: { logLevel: level } };
  });
};
