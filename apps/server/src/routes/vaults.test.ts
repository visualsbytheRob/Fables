/**
 * Vault registry route tests (Epic 20, F1901–F1909).
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

interface Vault {
  id: string;
  name: string;
  slug: string;
  template: string;
  active: boolean;
  archived: boolean;
  federated: boolean;
  encryption: string;
  settings: Record<string, unknown>;
}

async function register(payload: object): Promise<{ status: number; vault: Vault }> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/vaults', payload });
  return { status: res.statusCode, vault: (res.json() as { data: Vault }).data };
}

describe('vault registry (F1901/F1903/F1906)', () => {
  it('serves the template gallery', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/vaults/templates' });
    const templates = (res.json() as { data: { templates: { id: string }[] } }).data.templates;
    expect(templates.map((t) => t.id)).toContain('worldbuilding');
  });

  it('first vault registered is active and seeds template settings', async () => {
    const { vault } = await register({ name: 'My Work', template: 'work' });
    expect(vault.slug).toBe('my-work');
    expect(vault.active).toBe(true);
    expect(vault.template).toBe('work');
    expect(vault.settings.dailyDigest).toBe(true);
  });

  it('rejects a duplicate slug', async () => {
    await register({ name: 'Dupe Vault' });
    const dup = await register({ name: 'dupe vault' });
    expect(dup.status).toBe(409);
  });

  it('switches the active vault, keeping exactly one active (F1902)', async () => {
    const a = (await register({ name: 'Alpha Vault' })).vault;
    const b = (await register({ name: 'Beta Vault' })).vault;

    await app.inject({ method: 'POST', url: `/api/v1/vaults/${b.id}/activate` });
    const active = (
      (await app.inject({ method: 'GET', url: '/api/v1/vaults/active' })).json() as {
        data: Vault;
      }
    ).data;
    expect(active.id).toBe(b.id);

    // Alpha is no longer active.
    const fetchedA = (
      (await app.inject({ method: 'GET', url: `/api/v1/vaults/${a.id}` })).json() as {
        data: Vault;
      }
    ).data;
    expect(fetchedA.active).toBe(false);
  });

  it('isolates per-vault settings via PUT and PATCH (F1903)', async () => {
    const { vault } = await register({ name: 'Settings Vault' });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/vaults/${vault.id}/settings`,
      payload: { theme: 'dark' },
    });
    const patched = (
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/vaults/${vault.id}/settings`,
          payload: { fontSize: 16 },
        })
      ).json() as { data: Vault }
    ).data;
    expect(patched.settings).toEqual({ theme: 'dark', fontSize: 16 });
  });

  it('tracks an independent encryption state (F1907)', async () => {
    const { vault } = await register({ name: 'Crypt Vault' });
    const updated = (
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/vaults/${vault.id}/encryption`,
          payload: { state: 'locked' },
        })
      ).json() as { data: Vault }
    ).data;
    expect(updated.encryption).toBe('locked');
  });

  it('archives to cold storage and hides from the default list (F1908)', async () => {
    const { vault } = await register({ name: 'Cold Vault' });
    await app.inject({ method: 'POST', url: `/api/v1/vaults/${vault.id}/archive` });

    const visible = (
      (await app.inject({ method: 'GET', url: '/api/v1/vaults' })).json() as {
        data: { vaults: Vault[] };
      }
    ).data.vaults;
    expect(visible.find((v) => v.id === vault.id)).toBeUndefined();

    const all = (
      (await app.inject({ method: 'GET', url: '/api/v1/vaults?archived=1' })).json() as {
        data: { vaults: Vault[] };
      }
    ).data.vaults;
    expect(all.find((v) => v.id === vault.id)?.archived).toBe(true);
  });

  it('lists federated vaults opted in to cross-vault search (F1904)', async () => {
    const { vault } = await register({ name: 'Shared Vault', federated: true });
    const fed = (
      (await app.inject({ method: 'GET', url: '/api/v1/vaults/federated' })).json() as {
        data: { vaults: Vault[] };
      }
    ).data.vaults;
    expect(fed.find((v) => v.id === vault.id)).toBeDefined();
  });

  it('refuses to remove the active vault', async () => {
    const active = (
      (await app.inject({ method: 'GET', url: '/api/v1/vaults/active' })).json() as {
        data: Vault;
      }
    ).data;
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/vaults/${active.id}` });
    expect(res.statusCode).toBe(422);
  });
});
