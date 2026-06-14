/**
 * Compliance API routes (F1282, F1286, F1287, F1288).
 *
 *  GET  /compliance/inventory        — machine-readable data inventory export (F1282)
 *  GET  /compliance/legal-hold       — get current legal hold status (F1286)
 *  POST /compliance/legal-hold       — enable or disable legal hold (F1286)
 *  POST /notes/:id/redact            — redact a note's content + revision history (F1287)
 *  GET  /compliance/export           — inventory JSON export with redaction markers (F1288)
 */

import { notFound } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { buildInventory } from '../compliance/inventory.js';
import { legalHoldRepo } from '../compliance/legal-hold.js';
import { redactNote } from '../compliance/redaction.js';
import type { NoteId } from '@fables/core';

// ── Route registration ────────────────────────────────────────────────────────

registerRoute({
  method: 'GET',
  path: '/compliance/inventory',
  summary: 'Machine-readable data inventory (counts, vault status, legal hold)',
});
registerRoute({
  method: 'GET',
  path: '/compliance/legal-hold',
  summary: 'Get current legal hold status',
});
registerRoute({
  method: 'POST',
  path: '/compliance/legal-hold',
  summary: 'Enable or disable legal hold',
});
registerRoute({
  method: 'POST',
  path: '/notes/:id/redact',
  summary: 'Redact a note content and its entire revision history',
});
registerRoute({
  method: 'GET',
  path: '/compliance/export',
  summary: 'Download full compliance data inventory as JSON',
});

// ── Schemas ───────────────────────────────────────────────────────────────────

const legalHoldBodySchema = z.object({
  active: z.boolean(),
});

const redactBodySchema = z.object({
  fields: z.array(z.enum(['title', 'body'])).optional(),
  reason: z.string().optional(),
});

// ── Routes ────────────────────────────────────────────────────────────────────

export const complianceRoutes: FastifyPluginAsync = async (app) => {
  // ── GET /compliance/inventory ─────────────────────────────────────────────

  app.get('/compliance/inventory', async () => {
    const inventory = buildInventory(app.db);
    return { data: inventory };
  });

  // ── GET /compliance/legal-hold ────────────────────────────────────────────

  app.get('/compliance/legal-hold', async () => {
    const status = legalHoldRepo(app.db).get();
    return { data: status };
  });

  // ── POST /compliance/legal-hold ───────────────────────────────────────────

  app.post('/compliance/legal-hold', async (request) => {
    const { active } = parseWith(legalHoldBodySchema, request.body, 'body');
    const status = legalHoldRepo(app.db).set(active);
    return { data: status };
  });

  // ── POST /notes/:id/redact (F1287) ────────────────────────────────────────

  app.post('/notes/:id/redact', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = parseWith(redactBodySchema, request.body, 'body');

    // Verify note exists before redacting
    const noteExists =
      (app.db.prepare('SELECT 1 FROM notes WHERE id = ?').get(id) as unknown) !== undefined;
    if (!noteExists) throw notFound(`note ${id}`);

    const result = redactNote(app.db, id as NoteId, {
      ...(body.fields !== undefined ? { fields: body.fields } : {}),
      ...(body.reason !== undefined ? { reason: body.reason } : {}),
    });
    return reply.status(200).send({ data: result });
  });

  // ── GET /compliance/export (F1288) ────────────────────────────────────────
  // Returns a JSON download of the full inventory, suitable for compliance
  // archival. Any redacted notes are flagged in the inventory counts.

  app.get('/compliance/export', async (_request, reply) => {
    const inventory = buildInventory(app.db);
    const stamp = inventory.generatedAt.replace(/[:.]/g, '-');
    const filename = `fables-compliance-export-${stamp}.json`;
    const json = JSON.stringify(inventory, null, 2);
    return reply
      .header('content-type', 'application/json')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .header('content-length', Buffer.byteLength(json, 'utf8'))
      .send(json);
  });
};
