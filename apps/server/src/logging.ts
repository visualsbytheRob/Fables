import path from 'node:path';
import { isAppError } from '@fables/core';
import type { AppConfig } from './config.js';

export interface SerializedError {
  type: string;
  message: string;
  code?: string;
  stack?: string;
  cause?: SerializedError;
}

/** Captures AppError codes and walks the full cause chain (depth-limited). */
export function serializeError(err: unknown, depth = 0): SerializedError {
  if (depth > 5) return { type: 'TruncatedCause', message: 'cause chain too deep' };
  if (!(err instanceof Error)) {
    return { type: 'NonError', message: String(err) };
  }
  const out: SerializedError = { type: err.name, message: err.message };
  if (isAppError(err)) out.code = err.code;
  if (err.stack !== undefined) out.stack = err.stack;
  if (err.cause !== undefined) out.cause = serializeError(err.cause, depth + 1);
  return out;
}

/**
 * DEBUG namespace matching, e.g. `DEBUG=forge:*,sync` enables debug logging
 * for child loggers with subsystem `forge:lexer`, `forge:vm`, `sync`, …
 */
export function debugMatcher(debugEnv: string | undefined): (subsystem: string) => boolean {
  if (!debugEnv) return () => false;
  const patterns = debugEnv
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return (subsystem: string) =>
    patterns.some((p) => {
      if (p === '*') return true;
      if (p.endsWith(':*')) return subsystem.startsWith(p.slice(0, -1));
      return subsystem === p;
    });
}

/** Fastify/pino logger options: pretty console in dev, daily-rolled files always. */
export function buildLoggerOptions(config: AppConfig): object | boolean {
  if (config.env === 'test') return { level: config.logLevel };

  const targets: object[] = [
    {
      target: 'pino-roll',
      options: {
        file: path.join(config.dataDir, 'logs', 'fables'),
        frequency: 'daily',
        extension: '.log',
        mkdir: true,
        limit: { count: 14 },
      },
    },
  ];
  if (config.env === 'development') {
    targets.push({ target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } });
  } else {
    targets.push({ target: 'pino/file', options: { destination: 1 } });
  }

  return {
    level: config.logLevel,
    serializers: { err: serializeError },
    transport: { targets },
  };
}
