/**
 * WebSocket collaboration endpoint (F1121–F1140).
 *
 * GET /api/v1/collab/:docId (WebSocket upgrade)
 *
 * Authorization:
 *   The note must exist in the DB. We reuse the existing token auth gate that
 *   wraps the whole API. The WebSocket is gated the same way as REST routes —
 *   the preHandler hook fires before the WS upgrade.
 *
 * GET /api/v1/collab/:docId/presence
 *   Returns current awareness states for the room (F1131).
 *
 * GET /api/v1/collab/:docId/state
 *   Returns the persisted CRDT state as base64 for debugging (F1128).
 */

import { notFound } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { notesRepo } from '../db/repos/notes.js';

export const collabRoutes: FastifyPluginAsync = async (app) => {
  // ── WebSocket endpoint ─────────────────────────────────────────────────────

  app.get(
    '/collab/:docId',
    { websocket: true },
    (socket, request) => {
      const { docId } = request.params as { docId: string };

      // Authorization: verify note exists
      const repo = notesRepo(app.db);
      const note = repo.get(docId as never);
      if (!note) {
        socket.close(4004, 'note not found');
        return;
      }

      app.collab.handleConnection(socket, docId, note.body);
    },
  );

  // ── Presence query endpoint (F1131) ────────────────────────────────────────

  app.get('/collab/:docId/presence', async (request) => {
    const { docId } = request.params as { docId: string };

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
  });

  // ── CRDT state export (F1128 — horizontal readiness) ──────────────────────

  app.get('/collab/:docId/state', async (request) => {
    const { docId } = request.params as { docId: string };

    // Verify note exists
    const repo = notesRepo(app.db);
    const note = repo.get(docId as never);
    if (!note) throw notFound(`note ${docId}`);

    const row = app.db
      .prepare('SELECT state, schema_version, update_count, updated_at FROM crdt_docs WHERE doc_id = ?')
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
};
