/**
 * Scripting console routes (Epic 20, F1942–F1948).
 *
 *  POST   /scripts            — save a script
 *  GET    /scripts            — list scripts
 *  GET    /scripts/gallery    — example script gallery (F1948)
 *  GET    /scripts/scopes     — the known capability scopes (F1947)
 *  GET    /scripts/:id        — fetch a script
 *  PUT    /scripts/:id        — update a script
 *  DELETE /scripts/:id        — delete a script
 *  POST   /scripts/check      — static scope check of arbitrary source (F1946)
 *  GET    /scripts/:id/check  — static scope check of a stored script
 *
 * Live sandboxed execution runs through the plugin worker runtime; this owns the
 * script library, capability scoping and the static dry-run analysis.
 */

import { notFound } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { scriptsRepo } from '../db/repos/scripts.js';
import { checkScopes, KNOWN_SCOPES } from '../scripting/analyze.js';
import { SCRIPT_GALLERY } from '../scripting/gallery.js';

const idParam = z.object({ id: z.string().min(1) });

const scriptBody = z.object({
  name: z.string().min(1).max(200),
  source: z.string().min(1).max(50000),
  description: z.string().max(2000).optional(),
  scopes: z.array(z.string().min(1).max(50)).max(20).optional(),
  cron: z.string().min(1).max(200).nullable().optional(),
  enabled: z.boolean().optional(),
});

registerRoute({ method: 'POST', path: '/scripts', summary: 'Save a script (F1942)' });
registerRoute({ method: 'GET', path: '/scripts', summary: 'List scripts' });
registerRoute({ method: 'GET', path: '/scripts/gallery', summary: 'Example gallery (F1948)' });
registerRoute({ method: 'GET', path: '/scripts/scopes', summary: 'Known scopes (F1947)' });
registerRoute({ method: 'GET', path: '/scripts/:id', summary: 'Fetch a script' });
registerRoute({ method: 'PUT', path: '/scripts/:id', summary: 'Update a script' });
registerRoute({ method: 'DELETE', path: '/scripts/:id', summary: 'Delete a script' });
registerRoute({ method: 'POST', path: '/scripts/check', summary: 'Scope check source (F1946)' });
registerRoute({ method: 'GET', path: '/scripts/:id/check', summary: 'Scope check a script' });

export const scriptRoutes: FastifyPluginAsync = async (app) => {
  const repo = scriptsRepo(app.db);

  app.get('/scripts/gallery', async () => ({ data: { scripts: SCRIPT_GALLERY } }));
  app.get('/scripts/scopes', async () => ({ data: { scopes: KNOWN_SCOPES } }));

  app.post('/scripts/check', async (request) => {
    const body = parseWith(
      z.object({ source: z.string().max(50000), scopes: z.array(z.string()).max(20).default([]) }),
      request.body,
      'body',
    );
    return { data: checkScopes(body.source, body.scopes) };
  });

  app.post('/scripts', async (request) => {
    const body = parseWith(scriptBody, request.body, 'body');
    return {
      data: repo.create({
        name: body.name,
        source: body.source,
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.scopes !== undefined ? { scopes: body.scopes } : {}),
        ...(body.cron !== undefined ? { cron: body.cron } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      }),
    };
  });

  app.get('/scripts', async () => ({ data: { scripts: repo.list() } }));

  app.get('/scripts/:id', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const script = repo.get(id);
    if (!script) throw notFound('script', id);
    return { data: script };
  });

  app.put('/scripts/:id', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const body = parseWith(scriptBody.partial(), request.body, 'body');
    const script = repo.update(id, body);
    if (!script) throw notFound('script', id);
    return { data: script };
  });

  app.delete('/scripts/:id', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    if (!repo.remove(id)) throw notFound('script', id);
    return { data: { removed: true } };
  });

  app.get('/scripts/:id/check', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const result = repo.check(id);
    if (!result) throw notFound('script', id);
    return { data: result };
  });
};
