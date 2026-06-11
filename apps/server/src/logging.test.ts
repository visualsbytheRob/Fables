import { describe, expect, it } from 'vitest';
import { notFound } from '@fables/core';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { debugMatcher, serializeError } from './logging.js';

async function testApp(): Promise<FastifyInstance> {
  return buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
}

describe('serializeError', () => {
  it('captures AppError codes and walks cause chains', () => {
    const inner = notFound('Note', 'note_x');
    const outer = new Error('request failed', { cause: inner });
    const s = serializeError(outer);
    expect(s.type).toBe('Error');
    expect(s.cause?.code).toBe('NOT_FOUND');
    expect(s.cause?.message).toBe('Note not found');
  });

  it('handles non-errors and truncates absurd chains', () => {
    expect(serializeError('oops')).toEqual({ type: 'NonError', message: 'oops' });
    let err: Error = new Error('bottom');
    for (let i = 0; i < 10; i += 1) err = new Error(`layer ${i}`, { cause: err });
    let s = serializeError(err);
    let depth = 0;
    while (s.cause) {
      s = s.cause;
      depth += 1;
    }
    expect(depth).toBeLessThanOrEqual(6);
    expect(s.type).toBe('TruncatedCause');
  });
});

describe('debugMatcher', () => {
  it('matches exact, wildcard, and prefix namespaces', () => {
    const m = debugMatcher('forge:*,sync');
    expect(m('forge:lexer')).toBe(true);
    expect(m('forge:vm')).toBe(true);
    expect(m('sync')).toBe(true);
    expect(m('notes')).toBe(false);
    expect(debugMatcher('*')('anything')).toBe(true);
    expect(debugMatcher(undefined)('anything')).toBe(false);
  });
});

describe('debug routes', () => {
  it('reports stats including db sizes and counts', async () => {
    const app = await testApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/debug/stats' });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.db.sizeBytes).toBeGreaterThan(0);
    expect(data.db.notes).toBe(0);
    expect(data.memory.rssBytes).toBeGreaterThan(0);
    await app.close();
  });

  it('changes log level at runtime and rejects junk levels', async () => {
    const app = await testApp();
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/debug/log-level',
      payload: { level: 'warn' },
    });
    expect(ok.statusCode).toBe(200);
    expect(app.log.level).toBe('warn');

    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/debug/log-level',
      payload: { level: 'shouting' },
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.code).toBe('VALIDATION');
    await app.close();
  });
});
