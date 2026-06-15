/**
 * Workspace profile route tests (Epic 20, F1971–F1978).
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
});

afterAll(async () => {
  await app.close();
});

async function create(payload: object): Promise<{ id: string }> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/profiles', payload });
  return (res.json() as { data: { id: string } }).data;
}

describe('workspace profiles (F1971/F1977/F1978)', () => {
  it('serves focus-mode presets', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/profiles/presets' });
    const presets = (res.json() as { data: { presets: { id: string }[] } }).data.presets;
    expect(presets.map((p) => p.id)).toContain('reading');
  });

  it('round-trips export and import preserving the state', async () => {
    const { id } = await create({ name: 'Mine', state: { theme: 'dark', fontScale: 1.2 } });
    const exported = (
      (await app.inject({ method: 'GET', url: `/api/v1/profiles/${id}/export` })).json() as {
        data: { name: string; state: Record<string, unknown> };
      }
    ).data;
    const imported = (
      (
        await app.inject({ method: 'POST', url: '/api/v1/profiles/import', payload: exported })
      ).json() as { data: { state: Record<string, unknown> } }
    ).data;
    expect(imported.state).toEqual({ theme: 'dark', fontScale: 1.2 });
  });

  it('keeps one default per device scope (F1978)', async () => {
    const phone1 = await create({ name: 'Phone A', device: 'iphone' });
    const phone2 = await create({ name: 'Phone B', device: 'iphone' });

    await app.inject({ method: 'POST', url: `/api/v1/profiles/${phone1.id}/default` });
    await app.inject({ method: 'POST', url: `/api/v1/profiles/${phone2.id}/default` });

    const def = (
      (
        await app.inject({ method: 'GET', url: '/api/v1/profiles/default?device=iphone' })
      ).json() as {
        data: { profile: { id: string } | null };
      }
    ).data.profile;
    expect(def?.id).toBe(phone2.id);

    // The first profile is no longer the default.
    const first = (
      (await app.inject({ method: 'GET', url: `/api/v1/profiles/${phone1.id}` })).json() as {
        data: { isDefault: boolean };
      }
    ).data;
    expect(first.isDefault).toBe(false);
  });

  it('falls back to the global default when a device has none', async () => {
    const global = await create({ name: 'Global', device: null });
    await app.inject({ method: 'POST', url: `/api/v1/profiles/${global.id}/default` });
    const def = (
      (
        await app.inject({ method: 'GET', url: '/api/v1/profiles/default?device=unknown-device' })
      ).json() as {
        data: { profile: { id: string } | null };
      }
    ).data.profile;
    expect(def?.id).toBe(global.id);
  });
});
