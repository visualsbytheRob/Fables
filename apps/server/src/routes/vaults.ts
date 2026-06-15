/**
 * Vault registry routes (Epic 20, F1901–F1908).
 *
 *  GET    /vaults                 — list vaults (?archived=1 to include cold storage)
 *  POST   /vaults                 — register a named vault (from a template)
 *  GET    /vaults/templates       — the starter-template gallery (F1906)
 *  GET    /vaults/active          — the currently active vault
 *  GET    /vaults/federated       — vaults opted in to cross-vault search (F1904)
 *  GET    /vaults/:id             — fetch a vault
 *  PUT    /vaults/:id             — rename / move / toggle federation
 *  DELETE /vaults/:id             — remove from the registry
 *  POST   /vaults/:id/activate    — make this the active vault (F1902)
 *  PUT    /vaults/:id/settings    — replace isolated settings (F1903)
 *  PATCH  /vaults/:id/settings    — merge into isolated settings (F1903)
 *  POST   /vaults/:id/encryption  — set tracked encryption state (F1907)
 *  POST   /vaults/:id/archive     — move to cold storage (F1908)
 *  POST   /vaults/:id/unarchive   — restore from cold storage
 *
 * This owns the registry of named vaults and which one is active. Switching the
 * live DB connection to a vault's data dir at runtime is the boot concern; the
 * cross-vault move/copy of notes (F1905) requires multi-DB orchestration and is
 * tracked separately.
 */

import path from 'node:path';
import { notFound } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { vaultsRepo } from '../db/repos/vaults.js';
import { VAULT_TEMPLATES } from '../vaults/templates.js';

const idParam = z.object({ id: z.string().min(1) });

const createSchema = z.object({
  name: z.string().min(1).max(200),
  template: z.string().min(1).max(50).optional(),
  dataDir: z.string().min(1).max(1000).optional(),
  federated: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

registerRoute({ method: 'GET', path: '/vaults', summary: 'List vaults' });
registerRoute({ method: 'POST', path: '/vaults', summary: 'Register a vault (F1901)' });
registerRoute({ method: 'GET', path: '/vaults/templates', summary: 'Vault templates (F1906)' });
registerRoute({ method: 'GET', path: '/vaults/active', summary: 'Active vault' });
registerRoute({ method: 'GET', path: '/vaults/federated', summary: 'Federated vaults (F1904)' });
registerRoute({ method: 'GET', path: '/vaults/:id', summary: 'Fetch a vault' });
registerRoute({ method: 'PUT', path: '/vaults/:id', summary: 'Update a vault' });
registerRoute({ method: 'DELETE', path: '/vaults/:id', summary: 'Remove a vault' });
registerRoute({
  method: 'POST',
  path: '/vaults/:id/activate',
  summary: 'Activate a vault (F1902)',
});
registerRoute({ method: 'PUT', path: '/vaults/:id/settings', summary: 'Set settings (F1903)' });
registerRoute({ method: 'PATCH', path: '/vaults/:id/settings', summary: 'Merge settings (F1903)' });
registerRoute({
  method: 'POST',
  path: '/vaults/:id/encryption',
  summary: 'Encryption state (F1907)',
});
registerRoute({ method: 'POST', path: '/vaults/:id/archive', summary: 'Archive a vault (F1908)' });
registerRoute({ method: 'POST', path: '/vaults/:id/unarchive', summary: 'Unarchive a vault' });

export const vaultsRoutes: FastifyPluginAsync = async (app) => {
  const repo = vaultsRepo(app.db);

  app.get('/vaults/templates', async () => {
    return { data: { templates: VAULT_TEMPLATES } };
  });

  app.get('/vaults', async (request) => {
    const q = parseWith(
      z.object({ archived: z.coerce.boolean().optional() }),
      request.query,
      'query',
    );
    return { data: { vaults: repo.list({ includeArchived: q.archived ?? false }) } };
  });

  app.post('/vaults', async (request) => {
    const body = parseWith(createSchema, request.body, 'body');
    // Default each vault to its own dir under <dataDir>/vaults/<slug>.
    const dataDir =
      body.dataDir ??
      path.join(app.dataDir, 'vaults', body.name.toLowerCase().replace(/\s+/g, '-'));
    const vault = repo.register({
      name: body.name,
      dataDir,
      ...(body.template !== undefined ? { template: body.template } : {}),
      ...(body.federated !== undefined ? { federated: body.federated } : {}),
      ...(body.settings !== undefined ? { settings: body.settings } : {}),
    });
    return { data: vault };
  });

  app.get('/vaults/active', async () => {
    const vault = repo.getActive();
    if (!vault) throw notFound('active vault', 'active');
    return { data: vault };
  });

  app.get('/vaults/federated', async () => {
    return { data: { vaults: repo.federated() } };
  });

  app.get('/vaults/:id', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const vault = repo.get(id);
    if (!vault) throw notFound('vault', id);
    return { data: vault };
  });

  app.put('/vaults/:id', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const body = parseWith(
      z.object({
        name: z.string().min(1).max(200).optional(),
        dataDir: z.string().min(1).max(1000).optional(),
        federated: z.boolean().optional(),
      }),
      request.body,
      'body',
    );
    const vault = repo.update(id, body);
    if (!vault) throw notFound('vault', id);
    return { data: vault };
  });

  app.delete('/vaults/:id', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    if (!repo.get(id)) throw notFound('vault', id);
    repo.remove(id);
    return { data: { removed: true } };
  });

  app.post('/vaults/:id/activate', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const vault = repo.setActive(id);
    if (!vault) throw notFound('vault', id);
    return { data: vault };
  });

  app.put('/vaults/:id/settings', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const body = parseWith(z.record(z.string(), z.unknown()), request.body, 'body');
    const vault = repo.setSettings(id, body);
    if (!vault) throw notFound('vault', id);
    return { data: vault };
  });

  app.patch('/vaults/:id/settings', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const body = parseWith(z.record(z.string(), z.unknown()), request.body, 'body');
    const vault = repo.patchSettings(id, body);
    if (!vault) throw notFound('vault', id);
    return { data: vault };
  });

  app.post('/vaults/:id/encryption', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const body = parseWith(
      z.object({ state: z.enum(['none', 'locked', 'unlocked']) }),
      request.body,
      'body',
    );
    const vault = repo.setEncryption(id, body.state);
    if (!vault) throw notFound('vault', id);
    return { data: vault };
  });

  app.post('/vaults/:id/archive', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    if (!repo.get(id)) throw notFound('vault', id);
    return { data: repo.archive(id) };
  });

  app.post('/vaults/:id/unarchive', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    if (!repo.get(id)) throw notFound('vault', id);
    return { data: repo.unarchive(id) };
  });
};
