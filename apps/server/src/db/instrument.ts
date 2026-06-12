import type { FastifyBaseLogger } from 'fastify';
import type { Db } from './connection.js';

const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS ?? 20);

/** Wraps statement execution with timing; warns on anything slower than the threshold. */
export function instrumentDb(db: Db, log: FastifyBaseLogger, thresholdMs = SLOW_QUERY_MS): Db {
  const originalPrepare = db.prepare.bind(db);
  type AnyStatement = Record<string, unknown>;

  (db as unknown as AnyStatement).prepare = (sql: string) => {
    const stmt = originalPrepare(sql) as unknown as AnyStatement;
    for (const method of ['run', 'get', 'all'] as const) {
      const original = (stmt[method] as (...args: unknown[]) => unknown).bind(stmt);
      stmt[method] = (...args: unknown[]) => {
        const start = performance.now();
        const result = original(...args);
        const ms = performance.now() - start;
        if (ms > thresholdMs) {
          log.warn(
            { sql: sql.replace(/\s+/g, ' ').trim().slice(0, 200), ms: Math.round(ms * 10) / 10 },
            'slow query',
          );
        }
        return result;
      };
    }
    return stmt;
  };
  return db;
}
