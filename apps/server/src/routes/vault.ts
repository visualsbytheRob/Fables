/**
 * Encrypted vault routes (F1211–F1223).
 *
 *  GET  /vault/status      — absent | locked | unlocked
 *  POST /vault             — create a vault from a passphrase
 *  POST /vault/unlock      — unlock with a passphrase
 *  POST /vault/lock        — lock (zero the in-memory key)
 *  POST /vault/passphrase  — change passphrase (re-wrap, no re-encryption)
 *
 * All routes require the normal FABLES_TOKEN (owner-only). The passphrase is
 * never stored or logged; it is used transiently to derive the master key.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';

registerRoute({ method: 'GET', path: '/vault/status', summary: 'Vault status' });
registerRoute({ method: 'POST', path: '/vault', summary: 'Create a vault from a passphrase' });
registerRoute({ method: 'POST', path: '/vault/unlock', summary: 'Unlock the vault' });
registerRoute({ method: 'POST', path: '/vault/lock', summary: 'Lock the vault' });
registerRoute({
  method: 'POST',
  path: '/vault/passphrase',
  summary: 'Change the vault passphrase',
});

const createSchema = z.object({
  passphrase: z.string().min(1),
  strength: z.enum(['interactive', 'moderate', 'sensitive']).optional(),
});
const unlockSchema = z.object({ passphrase: z.string().min(1) });
const changeSchema = z.object({ current: z.string().min(1), next: z.string().min(1) });

export const vaultRoutes: FastifyPluginAsync = async (app) => {
  app.get('/vault/status', async () => {
    return { data: { status: app.vault.status() } };
  });

  app.post('/vault', async (request) => {
    const body = parseWith(createSchema, request.body, 'body');
    await app.vault.create(body.passphrase, body.strength ?? 'moderate');
    return { data: { status: app.vault.status() } };
  });

  app.post('/vault/unlock', async (request) => {
    const body = parseWith(unlockSchema, request.body, 'body');
    await app.vault.unlock(body.passphrase);
    return { data: { status: app.vault.status() } };
  });

  app.post('/vault/lock', async () => {
    app.vault.lock();
    return { data: { status: app.vault.status() } };
  });

  app.post('/vault/passphrase', async (request) => {
    const body = parseWith(changeSchema, request.body, 'body');
    await app.vault.changePassphrase(body.current, body.next);
    return { data: { status: app.vault.status() } };
  });
};
