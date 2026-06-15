/**
 * Secret-notes routes (Epic 13, F1241–F1249).
 *
 *  GET  /secret/status            — absent | locked | unlocked
 *  POST /secret                   — create the secret box from a passphrase
 *  POST /secret/unlock            — unlock with the secret passphrase
 *  POST /secret/lock              — lock (zero the in-memory secret key)
 *  POST /notes/:id/secret         — mark a note secret (encrypt under secret DEK)
 *  DELETE /notes/:id/secret       — reveal a note (decrypt, clear the flag)
 *  GET  /notes/:id/secret         — decrypt a secret note for display (unlocked)
 *  POST /secret/bulk              — bulk convert notes to/from secret
 *
 * The secret key path is independent of the vault passphrase; secret note content
 * is `enc:` ciphertext at rest and is excluded from search/exports/AI/plugins
 * until the secret box is unlocked.
 */

import { notFound, validation } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';

const idParam = z.object({ id: z.string().min(1) });

registerRoute({ method: 'GET', path: '/secret/status', summary: 'Secret-box status (F1241)' });
registerRoute({ method: 'POST', path: '/secret', summary: 'Create the secret box (F1242)' });
registerRoute({ method: 'POST', path: '/secret/unlock', summary: 'Unlock secret notes' });
registerRoute({ method: 'POST', path: '/secret/lock', summary: 'Lock secret notes' });
registerRoute({ method: 'POST', path: '/notes/:id/secret', summary: 'Mark a note secret (F1241)' });
registerRoute({
  method: 'DELETE',
  path: '/notes/:id/secret',
  summary: 'Reveal a secret note (F1245)',
});
registerRoute({ method: 'GET', path: '/notes/:id/secret', summary: 'Decrypt a secret note' });
registerRoute({ method: 'POST', path: '/secret/bulk', summary: 'Bulk convert secret (F1245)' });
registerRoute({ method: 'GET', path: '/secret/search', summary: 'Search secret notes (F1213)' });

const createSchema = z.object({
  passphrase: z.string().min(1),
  strength: z.enum(['interactive', 'moderate', 'sensitive']).optional(),
});

export const secretNotesRoutes: FastifyPluginAsync = async (app) => {
  app.get('/secret/status', async () => ({ data: { status: app.secretNotes.status() } }));

  app.post('/secret', async (request) => {
    const body = parseWith(createSchema, request.body, 'body');
    await app.secretNotes.create(body.passphrase, body.strength ?? 'moderate');
    return { data: { status: app.secretNotes.status() } };
  });

  app.post('/secret/unlock', async (request) => {
    const body = parseWith(z.object({ passphrase: z.string().min(1) }), request.body, 'body');
    await app.secretNotes.unlock(body.passphrase);
    return { data: { status: app.secretNotes.status() } };
  });

  app.post('/secret/lock', async () => {
    app.secretNotes.lock();
    return { data: { status: app.secretNotes.status() } };
  });

  app.post('/notes/:id/secret', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    if (!app.secretNotes.markSecret(id)) throw notFound('note', id);
    return { data: { id, secret: true } };
  });

  app.delete('/notes/:id/secret', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    if (!app.secretNotes.unmarkSecret(id)) throw notFound('note', id);
    return { data: { id, secret: false } };
  });

  app.get('/notes/:id/secret', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const revealed = app.secretNotes.reveal(id);
    if (!revealed) throw notFound('note', id);
    return { data: revealed };
  });

  app.get('/secret/search', async (request) => {
    const q = parseWith(
      z.object({
        q: z.string().default(''),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      }),
      request.query,
      'query',
    );
    return { data: { hits: app.secretNotes.search(q.q, q.limit ?? 20) } };
  });

  app.post('/secret/bulk', async (request) => {
    const body = parseWith(
      z.object({
        noteIds: z.array(z.string().min(1)).min(1).max(10000),
        toSecret: z.boolean(),
      }),
      request.body,
      'body',
    );
    try {
      const changed = app.secretNotes.bulkConvert(body.noteIds, body.toSecret);
      return { data: { changed } };
    } catch (err) {
      if ((err as { code?: string }).code === 'FORBIDDEN') throw err;
      throw validation((err as Error).message);
    }
  });
};
