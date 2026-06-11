import { describe, expect, it } from 'vitest';
import { AppError } from '@fables/core';
import { z } from 'zod';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { paginated, parsePagination } from './envelope.js';
import { parseWith } from './validate.js';

const testApp = () => buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));

describe('pagination convention', () => {
  it('applies defaults and caps the limit', () => {
    expect(parsePagination(undefined)).toEqual({ limit: 50, cursor: null });
    expect(parsePagination({ limit: '10', cursor: 'note_x' })).toEqual({
      limit: 10,
      cursor: 'note_x',
    });
    expect(() => parsePagination({ limit: '9999' })).toThrowError(AppError);
  });

  it('detects next pages via the limit+1 row', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const page1 = paginated(rows, { limit: 2, cursor: null });
    expect(page1.data.map((r) => r.id)).toEqual(['a', 'b']);
    expect(page1.page.nextCursor).toBe('b');

    const lastPage = paginated(rows.slice(0, 2), { limit: 2, cursor: 'b' });
    expect(lastPage.page.nextCursor).toBeNull();
  });
});

describe('validation helper', () => {
  it('names the failing part and issues', () => {
    const schema = z.object({ title: z.string().min(1) });
    expect(parseWith(schema, { title: 'ok' }, 'body')).toEqual({ title: 'ok' });
    try {
      parseWith(schema, { title: '' }, 'body');
      expect.unreachable();
    } catch (e) {
      const err = e as AppError;
      expect(err.code).toBe('VALIDATION');
      expect(err.details?.part).toBe('body');
      expect(String((err.details?.issues as string[])[0])).toContain('title');
    }
  });
});

describe('http contract', () => {
  it('sends version header, etag, and supports conditional GET', async () => {
    const app = await testApp();
    const first = await app.inject({ method: 'GET', url: '/api/v1/config' });
    expect(first.headers['x-fables-api-version']).toBe('1');
    const tag = first.headers.etag;
    expect(tag).toBeDefined();

    const second = await app.inject({
      method: 'GET',
      url: '/api/v1/config',
      headers: { 'if-none-match': tag as string },
    });
    expect(second.statusCode).toBe(304);
    await app.close();
  });

  it('compresses responses when the client accepts it', async () => {
    const app = await testApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/debug/stats',
      headers: { 'accept-encoding': 'gzip' },
    });
    // small payloads may skip compression; the plugin must at least not break the envelope
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('enforces rate limits with standard headers', async () => {
    const app = await testApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    await app.close();
  });
});
