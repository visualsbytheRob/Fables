/**
 * Share link endpoints (F1141–F1150).
 *
 * POST   /shares                 — Create a scoped share link
 * GET    /shares                 — List all shares (who has access to what)
 * GET    /shares/:id             — Get one share (with audit log)
 * DELETE /shares/:id             — Revoke a share
 * GET    /shares/:id/audit       — Audit log for a share
 * GET    /shared-with-me         — Shares accessible via token (guest view)
 * POST   /shares/validate        — Validate a token + register guest identity
 * POST   /shares/:id/guests      — Register/update guest identity for a share
 *
 * Permission enforcement model:
 *   - Owner routes (POST, GET /shares, DELETE) require the normal FABLES_TOKEN
 *     bearer auth (enforced by the global preHandler hook in security.ts).
 *   - Share-token routes accept either the full FABLES_TOKEN OR a valid,
 *     active share token in x-fables-share-token header.
 *   - The collab WebSocket endpoint checks share tokens via enforceShareAccess().
 */

import { notFound } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../db/connection.js';
import { sharesRepo, type DocType, type AccessLevel } from '../db/repos/shares.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractShareToken(request: {
  headers: Record<string, string | string[] | undefined>;
}): string | null {
  const v = request.headers['x-fables-share-token'];
  if (typeof v === 'string') return v.trim();
  return null;
}

// ── Routes ────────────────────────────────────────────────────────────────────

export const sharesRoutes: FastifyPluginAsync = async (app) => {
  const repo = () => sharesRepo(app.db);

  // ── POST /shares — create a share link ─────────────────────────────────────

  app.post('/shares', async (request, reply) => {
    const body = request.body as {
      docId?: unknown;
      docType?: unknown;
      accessLevel?: unknown;
      label?: unknown;
      expiresAt?: unknown;
      createdBy?: unknown;
    };

    if (typeof body.docId !== 'string' || !body.docId.trim()) {
      return reply.status(422).send({
        error: { code: 'VALIDATION', message: 'docId is required', details: null },
      });
    }
    const validDocTypes = ['note', 'notebook', 'story'] as const;
    const docType: DocType = validDocTypes.includes(body.docType as DocType)
      ? (body.docType as DocType)
      : 'note';
    const validLevels = ['read', 'edit'] as const;
    const accessLevel: AccessLevel = validLevels.includes(body.accessLevel as AccessLevel)
      ? (body.accessLevel as AccessLevel)
      : 'read';

    const share = repo().create({
      docId: body.docId,
      docType,
      accessLevel,
      label: typeof body.label === 'string' ? body.label : '',
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
      createdBy: typeof body.createdBy === 'string' ? body.createdBy : 'owner',
    });

    repo().audit(share.id, 'accessed', null, { action: 'created' });

    return reply.status(201).send({ data: share });
  });

  // ── GET /shares — list all shares ──────────────────────────────────────────

  app.get('/shares', async (_request) => {
    const shares = repo().listAll();
    return { data: shares };
  });

  // ── GET /shares/:id — get one share ────────────────────────────────────────

  app.get('/shares/:id', async (request) => {
    const { id } = request.params as { id: string };
    const share = repo().getById(id);
    if (!share) throw notFound(`share ${id}`);

    const guests = repo().listGuests(id);
    return { data: { ...share, guests } };
  });

  // ── DELETE /shares/:id — revoke ────────────────────────────────────────────

  app.delete('/shares/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const share = repo().getById(id);
    if (!share) throw notFound(`share ${id}`);

    repo().audit(id, 'revoked', null, { revokedBy: 'owner' });
    const revoked = repo().revoke(id);
    if (!revoked) {
      return reply.status(409).send({
        error: { code: 'CONFLICT', message: 'share already revoked', details: null },
      });
    }
    return reply.status(204).send();
  });

  // ── GET /shares/:id/audit — audit log ─────────────────────────────────────

  app.get('/shares/:id/audit', async (request) => {
    const { id } = request.params as { id: string };
    const share = repo().getById(id);
    if (!share) throw notFound(`share ${id}`);

    const entries = repo().listAudit(id);
    return { data: { shareId: id, entries } };
  });

  // ── POST /shares/validate — validate token + register guest ───────────────
  // Called by a guest linking in via a share URL.
  // Accepts x-fables-share-token (skips the global bearer-token requirement).

  app.post('/shares/validate', { config: { skipTokenAuth: true } }, async (request, reply) => {
    const token = extractShareToken(request);
    if (!token) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'x-fables-share-token header required',
          details: null,
        },
      });
    }

    const share = repo().validate(token);
    if (!share) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'share token invalid, expired, or revoked',
          details: null,
        },
      });
    }

    const guestBody = request.body as { name?: unknown; color?: unknown; guestId?: unknown } | null;
    const guestName = typeof guestBody?.name === 'string' ? guestBody.name : 'Guest';
    const guestColor = typeof guestBody?.color === 'string' ? guestBody.color : '#6366f1';
    const existingId = typeof guestBody?.guestId === 'string' ? guestBody.guestId : undefined;

    const guest = repo().upsertGuest({
      shareId: share.id,
      name: guestName,
      color: guestColor,
      ...(existingId !== undefined ? { existingId } : {}),
    });

    repo().audit(share.id, 'joined', guest.id, { name: guestName });

    return { data: { share, guest } };
  });

  // ── POST /shares/:id/guests — update guest identity ───────────────────────

  app.post('/shares/:id/guests', { config: { skipTokenAuth: true } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const token = extractShareToken(request);

    // Validate token belongs to this share
    const share = token ? repo().validate(token) : null;
    if (!share || share.id !== id) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'invalid or mismatched share token', details: null },
      });
    }

    const body = request.body as { name?: unknown; color?: unknown; guestId?: unknown } | null;
    const existingGuestId = typeof body?.guestId === 'string' ? body.guestId : undefined;
    const guest = repo().upsertGuest({
      shareId: id,
      name: typeof body?.name === 'string' ? body.name : 'Guest',
      color: typeof body?.color === 'string' ? body.color : '#6366f1',
      ...(existingGuestId !== undefined ? { existingId: existingGuestId } : {}),
    });

    return reply.status(200).send({ data: guest });
  });

  // ── GET /shared-with-me — guest sees what they have access to ─────────────
  // The guest provides their token; server returns what doc they can access.

  app.get('/shared-with-me', { config: { skipTokenAuth: true } }, async (request, reply) => {
    const token = extractShareToken(request);
    if (!token) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'x-fables-share-token header required',
          details: null,
        },
      });
    }

    const share = repo().validate(token);
    if (!share) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'share token invalid, expired, or revoked',
          details: null,
        },
      });
    }

    // Touch guest last_seen if guestId provided
    const guestId = request.headers['x-fables-guest-id'];
    if (typeof guestId === 'string') {
      repo().touchGuest(guestId);
    }

    return {
      data: {
        shareId: share.id,
        docId: share.docId,
        docType: share.docType,
        accessLevel: share.accessLevel,
        label: share.label,
        expiresAt: share.expiresAt,
      },
    };
  });
};

// ── Share token enforcement utility (used by collab + REST routes) ────────────

/**
 * Check that a request is authorized for a given doc.
 * Accepts either:
 *   1. The full FABLES_TOKEN (owner access — any level)
 *   2. A valid share token for the doc with sufficient access_level
 *
 * Returns null if authorized, or an error object if not.
 */
export function enforceShareAccess(
  db: Db,
  request: { headers: Record<string, string | string[] | undefined> },
  docId: string,
  requiredLevel: AccessLevel,
  ownerToken?: string,
): { authorized: true; accessLevel: AccessLevel } | { authorized: false; reason: string } {
  // Check full owner token first
  if (ownerToken) {
    const auth = request.headers['authorization'];
    const candidate =
      typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')
        ? auth.slice(7).trim()
        : (request.headers['x-fables-token'] as string | undefined);
    if (candidate === ownerToken) {
      return { authorized: true, accessLevel: 'edit' };
    }
  }

  // Check share token
  const shareToken = request.headers['x-fables-share-token'];
  if (typeof shareToken !== 'string') {
    return { authorized: false, reason: 'no auth token provided' };
  }

  const repo = sharesRepo(db);
  const share = repo.validate(shareToken.trim());
  if (!share) {
    return { authorized: false, reason: 'share token invalid, expired, or revoked' };
  }
  if (share.docId !== docId) {
    return { authorized: false, reason: 'share token not valid for this document' };
  }
  if (requiredLevel === 'edit' && share.accessLevel !== 'edit') {
    return { authorized: false, reason: 'share token grants read-only access' };
  }

  return { authorized: true, accessLevel: share.accessLevel };
}

export type { AccessLevel };
