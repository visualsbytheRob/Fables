/**
 * WebSocket collaboration endpoint (F1121–F1140, F1141–F1150, F1191–F1200).
 *
 * GET /api/v1/collab/:docId (WebSocket upgrade)
 *
 * Authorization:
 *   - Owner: standard FABLES_TOKEN bearer/x-fables-token header (edit access)
 *   - Guests: x-fables-share-token header with a valid share token for this doc
 *     - read-only tokens receive SyncStep2 but their updates are rejected
 *     - revoked/expired tokens are rejected before the WebSocket upgrade
 *
 * GET /api/v1/collab/:docId/presence
 *   Returns current awareness states for the room (F1131).
 *
 * GET /api/v1/collab/:docId/state
 *   Returns the persisted CRDT state as base64 for debugging (F1128).
 *
 * GET /api/v1/collab/health
 *   Collab health diagnostics endpoint (F1191–F1200 hardening).
 */

import { notFound } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../db/connection.js';
import { notesRepo } from '../db/repos/notes.js';
import { sharesRepo } from '../db/repos/shares.js';

// ── Auth helpers ──────────────────────────────────────────────────────────────

/**
 * Returns true if the request carries the full owner token.
 */
function hasOwnerToken(
  request: { headers: Record<string, string | string[] | undefined> },
  ownerToken?: string,
): boolean {
  if (!ownerToken) return true; // auth gate off — all are owners
  const auth = request.headers['authorization'];
  const candidate =
    typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')
      ? auth.slice(7).trim()
      : (request.headers['x-fables-token'] as string | undefined);
  return candidate === ownerToken;
}

/**
 * Validate a share token for a specific docId.
 * Returns null if invalid/expired/revoked or wrong doc.
 * Returns the access level if valid.
 */
function validateShareToken(
  db: Db,
  tokenHeader: string | string[] | undefined,
  docId: string,
): 'read' | 'edit' | null {
  if (typeof tokenHeader !== 'string') return null;
  const repo = sharesRepo(db);
  const share = repo.validate(tokenHeader.trim());
  if (!share) return null;
  if (share.docId !== docId) return null;
  return share.accessLevel;
}

// ── Routes ────────────────────────────────────────────────────────────────────

export const collabRoutes: FastifyPluginAsync = async (app) => {
  const ownerToken = process.env['FABLES_TOKEN'];

  // ── WebSocket endpoint ─────────────────────────────────────────────────────

  app.get(
    '/collab/:docId',
    { websocket: true, config: { skipTokenAuth: true } },
    (socket, request) => {
      const { docId } = request.params as { docId: string };

      // ── Permission check: owner token OR valid share token ─────────────────
      const isOwner = hasOwnerToken(request, ownerToken);
      let accessLevel: 'read' | 'edit' = 'edit';

      if (!isOwner) {
        const shareAccess = validateShareToken(
          app.db,
          request.headers['x-fables-share-token'],
          docId,
        );
        if (shareAccess === null) {
          socket.close(4003, 'unauthorized: invalid or missing token');
          return;
        }
        accessLevel = shareAccess;

        // Audit the share access
        try {
          const tokenHeader = request.headers['x-fables-share-token'];
          const token = typeof tokenHeader === 'string' ? tokenHeader.trim() : null;
          if (token) {
            const repo = sharesRepo(app.db);
            const share = repo.validate(token);
            if (share) {
              const guestId = request.headers['x-fables-guest-id'];
              repo.audit(share.id, 'accessed', typeof guestId === 'string' ? guestId : null, {
                via: 'websocket',
                docId,
              });
            }
          }
        } catch {
          // Non-fatal audit failure
        }
      }

      // ── Note existence check ───────────────────────────────────────────────
      const repo = notesRepo(app.db);
      const note = repo.get(docId as never);
      if (!note) {
        socket.close(4004, 'note not found');
        return;
      }

      // ── Connect to collab room with access level ───────────────────────────
      app.collab.handleConnection(socket, docId, note.body, accessLevel);
    },
  );

  // ── Presence query endpoint (F1131) ────────────────────────────────────────

  app.get(
    '/collab/:docId/presence',
    { config: { skipTokenAuth: true } },
    async (request, reply) => {
      const { docId } = request.params as { docId: string };

      // Allow owner OR valid share token
      const isOwner = hasOwnerToken(request, ownerToken);
      if (!isOwner) {
        const shareAccess = validateShareToken(
          app.db,
          request.headers['x-fables-share-token'],
          docId,
        );
        if (shareAccess === null) {
          return reply.status(403).send({
            error: { code: 'FORBIDDEN', message: 'unauthorized', details: null },
          });
        }
      }

      // Verify note exists
      const repo = notesRepo(app.db);
      const note = repo.get(docId as never);
      if (!note) throw notFound(`note ${docId}`);

      const presence = app.collab.getPresence(docId);
      return {
        data: {
          docId,
          peers: presence,
          peerCount: presence.length,
        },
      };
    },
  );

  // ── CRDT state export (F1128 — horizontal readiness) ──────────────────────

  app.get('/collab/:docId/state', async (request) => {
    const { docId } = request.params as { docId: string };

    // Verify note exists
    const repo = notesRepo(app.db);
    const note = repo.get(docId as never);
    if (!note) throw notFound(`note ${docId}`);

    const row = app.db
      .prepare(
        'SELECT state, schema_version, update_count, updated_at FROM crdt_docs WHERE doc_id = ?',
      )
      .get(docId) as
      | { state: Buffer; schema_version: number; update_count: number; updated_at: string }
      | undefined;

    return {
      data: {
        docId,
        hasState: !!row,
        schemaVersion: row?.schema_version ?? null,
        updateCount: row?.update_count ?? 0,
        updatedAt: row?.updated_at ?? null,
        stateBytes: row ? row.state.length : 0,
        // Base64-encoded state for debugging / horizontal sync
        state: row ? Buffer.from(row.state).toString('base64') : null,
        isRoomActive: app.collab.hasRoom(docId),
      },
    };
  });

  // ── Collab health diagnostics endpoint (F1191–F1200 hardening) ────────────

  app.get('/collab/health', async (_request) => {
    const stats = app.collab.getRoomStats();

    // Count persisted CRDT docs
    const crdtCount = (app.db.prepare('SELECT COUNT(*) as n FROM crdt_docs').get() as { n: number })
      .n;

    // Count active shares
    const shareCount = (
      app.db
        .prepare(
          `SELECT COUNT(*) as n FROM shares WHERE revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
        )
        .get() as { n: number }
    ).n;

    // Integrity: check all active room doc_ids have DB entries
    const roomDocIds = stats.rooms.map((r) => r.docId);
    const persistedDocIds = new Set(
      (app.db.prepare('SELECT doc_id FROM crdt_docs').all() as { doc_id: string }[]).map(
        (r) => r.doc_id,
      ),
    );
    const roomsWithoutPersistedState = roomDocIds.filter((id) => !persistedDocIds.has(id));

    return {
      data: {
        status: 'healthy',
        collab: {
          activeRooms: stats.activeRooms,
          totalPeers: stats.totalPeers,
          rooms: stats.rooms,
          roomsWithoutPersistedState,
        },
        persistence: {
          persistedDocCount: crdtCount,
        },
        shares: {
          activeShareCount: shareCount,
        },
        bandwidth: {
          note: 'Coalescing: updates broadcast per-message; collab service batches flushes every 5s or 20 updates.',
          recommendation: 'For phone connections, clients should debounce sends by 100-300ms.',
        },
        singleUserMode: {
          supported: true,
          note: 'When no peers are connected, REST paths are fully functional without CRDT. CRDT room idles out after 30s.',
        },
      },
    };
  });
};
