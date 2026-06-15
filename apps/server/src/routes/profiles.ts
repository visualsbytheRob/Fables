/**
 * Workspace profile routes (Epic 20, F1971–F1978).
 *
 *  POST   /profiles            — create a profile
 *  GET    /profiles            — list profiles
 *  GET    /profiles/presets    — focus-mode presets (F1972/F1976)
 *  GET    /profiles/default    — the default profile (?device=)
 *  GET    /profiles/:id        — fetch a profile
 *  PUT    /profiles/:id        — update a profile
 *  DELETE /profiles/:id        — delete a profile
 *  POST   /profiles/:id/default — make this the default for its device (F1978)
 *  GET    /profiles/:id/export — export a portable profile (F1977)
 *  POST   /profiles/import     — import a portable profile (F1977)
 *
 * Profiles are named UI states; the web app interprets the opaque state blob
 * (open panes, filters, theme, focus mode, notification rules).
 */

import { notFound } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { profilesRepo } from '../db/repos/profiles.js';
import { PROFILE_PRESETS } from '../profiles/presets.js';

const idParam = z.object({ id: z.string().min(1) });
const stateSchema = z.record(z.string(), z.unknown());

const profileBody = z.object({
  name: z.string().min(1).max(200),
  state: stateSchema.optional(),
  device: z.string().min(1).max(100).nullable().optional(),
});

registerRoute({ method: 'POST', path: '/profiles', summary: 'Create a profile (F1971)' });
registerRoute({ method: 'GET', path: '/profiles', summary: 'List profiles' });
registerRoute({ method: 'GET', path: '/profiles/presets', summary: 'Focus-mode presets (F1976)' });
registerRoute({ method: 'GET', path: '/profiles/default', summary: 'Default profile (F1978)' });
registerRoute({ method: 'GET', path: '/profiles/:id', summary: 'Fetch a profile' });
registerRoute({ method: 'PUT', path: '/profiles/:id', summary: 'Update a profile' });
registerRoute({ method: 'DELETE', path: '/profiles/:id', summary: 'Delete a profile' });
registerRoute({ method: 'POST', path: '/profiles/:id/default', summary: 'Set default (F1978)' });
registerRoute({ method: 'GET', path: '/profiles/:id/export', summary: 'Export a profile (F1977)' });
registerRoute({ method: 'POST', path: '/profiles/import', summary: 'Import a profile (F1977)' });

export const profileRoutes: FastifyPluginAsync = async (app) => {
  const repo = profilesRepo(app.db);

  app.get('/profiles/presets', async () => ({ data: { presets: PROFILE_PRESETS } }));

  app.get('/profiles/default', async (request) => {
    const q = parseWith(
      z.object({ device: z.string().min(1).max(100).optional() }),
      request.query,
      'query',
    );
    return { data: { profile: repo.getDefault(q.device) } };
  });

  app.post('/profiles/import', async (request) => {
    const body = parseWith(
      z.object({ name: z.string().min(1).max(200), state: stateSchema.default({}) }),
      request.body,
      'body',
    );
    return { data: repo.importProfile(body) };
  });

  app.post('/profiles', async (request) => {
    const body = parseWith(profileBody, request.body, 'body');
    return {
      data: repo.create({
        name: body.name,
        ...(body.state !== undefined ? { state: body.state } : {}),
        ...(body.device !== undefined ? { device: body.device } : {}),
      }),
    };
  });

  app.get('/profiles', async () => ({ data: { profiles: repo.list() } }));

  app.get('/profiles/:id', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const profile = repo.get(id);
    if (!profile) throw notFound('profile', id);
    return { data: profile };
  });

  app.put('/profiles/:id', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const body = parseWith(profileBody.partial(), request.body, 'body');
    const profile = repo.update(id, body);
    if (!profile) throw notFound('profile', id);
    return { data: profile };
  });

  app.delete('/profiles/:id', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    if (!repo.remove(id)) throw notFound('profile', id);
    return { data: { removed: true } };
  });

  app.post('/profiles/:id/default', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const profile = repo.setDefault(id);
    if (!profile) throw notFound('profile', id);
    return { data: profile };
  });

  app.get('/profiles/:id/export', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const data = repo.exportProfile(id);
    if (!data) throw notFound('profile', id);
    return { data };
  });
};
