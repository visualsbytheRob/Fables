/**
 * Anki interop route tests (Epic 18, F1781/F1785).
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  for (const p of ['anki-a', 'anki-b']) {
    await app.inject({ method: 'POST', url: '/api/v1/cards', payload: { prompt: p, answer: 'x' } });
  }
});

afterAll(async () => {
  await app.close();
});

describe('Anki export → import round-trip (F1785/F1781)', () => {
  it('exports cards to .apkg and imports them back', async () => {
    const exp = await app.inject({ method: 'POST', url: '/api/v1/export/anki', payload: {} });
    expect(exp.statusCode).toBe(200);
    const out = (exp.json() as { data: { apkg: string; cardCount: number } }).data;
    expect(out.cardCount).toBeGreaterThanOrEqual(2);

    const imp = await app.inject({
      method: 'POST',
      url: '/api/v1/import/anki',
      payload: { apkg: out.apkg },
    });
    expect(imp.statusCode).toBe(200);
    expect((imp.json() as { data: { imported: number } }).data.imported).toBe(out.cardCount);
  });

  it('rejects a non-apkg payload cleanly (no 500)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/import/anki',
      payload: { apkg: Buffer.from('garbage').toString('base64') },
    });
    expect(res.statusCode).toBe(422);
  });
});
