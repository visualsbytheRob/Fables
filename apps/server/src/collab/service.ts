/**
 * Collaboration service (F1121–F1140).
 *
 * Manages per-document Y.Doc rooms with:
 *  - Room lifecycle: create on first connect, idle-timeout after last peer leaves
 *  - Update broadcast with backpressure (non-OPEN sockets skipped)
 *  - Persistence batching: flush to crdt_docs after FLUSH_INTERVAL ms of idle
 *    or FLUSH_UPDATE_COUNT updates, whichever comes first
 *  - State vector catch-up: client sends SyncStep1, server replies SyncStep2
 *  - Awareness relay: awareness messages rebroadcast to all room peers
 *  - Presence event hooks for plugin extensibility (F1139)
 *  - Room metrics tracked in collab_rooms table (F1127)
 *
 * Protocol framing (binary, y-websocket-compatible — web lane uses this):
 *   [msgType: varint] [payload…]
 *   msgType 0 = Sync  → [subType: varint] [data as varUint8Array]
 *     subType 0 = SyncStep1 (client→server on connect, carries state vector)
 *     subType 1 = SyncStep2 (server→client reply, carries missing updates)
 *     subType 2 = Update   (bidirectional incremental update)
 *   msgType 1 = Awareness → [awarenessUpdate as varUint8Array]
 *
 * Handshake sequence (client-server model per y-protocols spec):
 *   1. Client connects
 *   2. Server → SyncStep1 (server state vector) + current awareness state
 *   3. Client → SyncStep1 (client state vector)
 *   4. Server → SyncStep2 (diff: what client is missing) + SyncStep1 again
 *   5. Client → SyncStep2 (diff: what server is missing)
 *   After this both sides are in sync and exchange Update messages live.
 */

import type { WebSocket } from '@fastify/websocket';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/connection.js';
import { withTransaction } from '../db/connection.js';
import {
  createNoteDoc,
  encodeDocState,
  encodeSyncStep1,
  encodeUpdate,
  encodeAwarenessBinary,
  encodeAwarenessUpdate,
  applyDocUpdate,
  mergeUpdates,
  decodeMessage,
  seedDocFromBody,
  createAwareness,
  removeAwarenessClients,
  migrateCrdtDoc,
  CRDT_SCHEMA_VERSION,
  CRDT_COMPACTION_THRESHOLD,
} from '@fables/sync';
import type { Awareness, YDoc } from '@fables/sync';

// ── Constants ──────────────────────────────────────────────────────────────────

/** How long (ms) a room stays alive with zero peers before destruction. */
const IDLE_TIMEOUT_MS = 30_000;

/** Flush to DB after this many updates received (batching). */
const FLUSH_UPDATE_COUNT = 20;

/** Flush to DB after this many ms of inactivity (batching). */
const FLUSH_INTERVAL_MS = 5_000;

// WebSocket ready states
const WS_OPEN = 1;

// ── Peer ──────────────────────────────────────────────────────────────────────

interface Peer {
  id: string;
  socket: WebSocket;
  /** clientID reported by the remote Yjs doc (discovered via awareness). */
  awarenessClientId: number | null;
}

// ── Room ──────────────────────────────────────────────────────────────────────

interface Room {
  docId: string;
  doc: YDoc;
  awareness: Awareness;
  peers: Map<string, Peer>;
  pendingUpdates: Uint8Array[];
  idleTimer: ReturnType<typeof setTimeout> | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
  createdAt: number;
  lastActivityAt: number;
}

// ── Presence event types (F1139) ─────────────────────────────────────────────

export interface PresenceEvent {
  type: 'join' | 'leave' | 'update';
  docId: string;
  peerId: string;
  peerCount: number;
}

export type PresenceHook = (event: PresenceEvent) => void;

// ── CollabService ─────────────────────────────────────────────────────────────

export class CollabService {
  private rooms = new Map<string, Room>();
  private presenceHooks: PresenceHook[] = [];

  constructor(
    private readonly db: Db,
    private readonly log: FastifyBaseLogger,
  ) {}

  // ── Presence hooks (F1139) ──────────────────────────────────────────────────

  onPresence(hook: PresenceHook): () => void {
    this.presenceHooks.push(hook);
    return () => {
      this.presenceHooks = this.presenceHooks.filter((h) => h !== hook);
    };
  }

  private emitPresence(event: PresenceEvent): void {
    for (const hook of this.presenceHooks) {
      try {
        hook(event);
      } catch (err) {
        this.log.warn({ err, event }, 'presence hook threw');
      }
    }
  }

  // ── Room management ─────────────────────────────────────────────────────────

  private getOrCreateRoom(docId: string, noteBody?: string): Room {
    let room = this.rooms.get(docId);
    if (room) {
      if (room.idleTimer) {
        clearTimeout(room.idleTimer);
        room.idleTimer = null;
      }
      return room;
    }

    const doc = createNoteDoc();
    const awareness = createAwareness(doc);

    // Load persisted state from DB
    const persisted = this.loadDocState(docId);
    if (persisted) {
      const state = migrateCrdtDoc({
        doc_id: docId,
        state: persisted.state,
        schema_version: persisted.schema_version,
        updated_at: '',
      });
      if (state && state.length > 0) {
        applyDocUpdate(doc, state, 'load');
      } else if (!state && noteBody) {
        this.log.warn({ docId }, 'CRDT schema version mismatch, reinitialising from note body');
        seedDocFromBody(doc, noteBody);
      }
    } else if (noteBody) {
      seedDocFromBody(doc, noteBody);
    }

    room = {
      docId,
      doc,
      awareness,
      peers: new Map(),
      pendingUpdates: [],
      idleTimer: null,
      flushTimer: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    this.rooms.set(docId, room);

    // Doc update listener: rebroadcast + schedule flush
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (!room) return;
      room.pendingUpdates.push(update);
      room.lastActivityAt = Date.now();
      const encoded = encodeUpdate(update);
      this.broadcastToRoom(room, encoded, typeof origin === 'string' ? origin : null);
      this.scheduleFlush(room);
      this.updateRoomMetrics(docId, room.peers.size);
    });

    // Awareness update listener: rebroadcast
    awareness.on(
      'update',
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
        if (!room) return;
        const changed = [...added, ...updated, ...removed];
        if (changed.length === 0) return;
        const rawUpdate = encodeAwarenessUpdate(awareness, changed);
        const msg = encodeAwarenessBinary(rawUpdate);
        this.broadcastToRoom(room, msg, 'awareness');
      },
    );

    this.upsertRoomMetrics(docId);
    this.log.debug({ docId }, 'collab room created');
    return room;
  }

  private destroyRoom(docId: string): void {
    const room = this.rooms.get(docId);
    if (!room) return;
    this.flushRoom(room);
    if (room.idleTimer) clearTimeout(room.idleTimer);
    if (room.flushTimer) clearTimeout(room.flushTimer);
    room.awareness.destroy();
    room.doc.destroy();
    this.rooms.delete(docId);
    this.deleteRoomMetrics(docId);
    this.log.debug({ docId }, 'collab room destroyed');
  }

  private scheduleIdleTimeout(room: Room): void {
    if (room.idleTimer) clearTimeout(room.idleTimer);
    room.idleTimer = setTimeout(() => {
      if (room.peers.size === 0) {
        this.destroyRoom(room.docId);
      }
    }, IDLE_TIMEOUT_MS);
  }

  private scheduleFlush(room: Room): void {
    if (room.pendingUpdates.length >= FLUSH_UPDATE_COUNT) {
      this.flushRoom(room);
      return;
    }
    if (!room.flushTimer) {
      room.flushTimer = setTimeout(() => {
        this.flushRoom(room);
      }, FLUSH_INTERVAL_MS);
    }
  }

  // ── Peer lifecycle ──────────────────────────────────────────────────────────

  handleConnection(socket: WebSocket, docId: string, noteBody?: string): void {
    const room = this.getOrCreateRoom(docId, noteBody);
    const peerId = crypto.randomUUID();
    const peer: Peer = { id: peerId, socket, awarenessClientId: null };
    room.peers.set(peerId, peer);
    this.updateRoomMetrics(docId, room.peers.size);

    this.log.debug({ docId, peerId, peerCount: room.peers.size }, 'collab peer joined');
    this.emitPresence({ type: 'join', docId, peerId, peerCount: room.peers.size });

    // y-websocket handshake: send server SyncStep1 so client knows what to send
    this.send(socket, encodeSyncStep1(room.doc));

    // Send current awareness state to the new peer
    const awarenessIds = Array.from(room.awareness.getStates().keys());
    if (awarenessIds.length > 0) {
      const rawAwareness = encodeAwarenessUpdate(room.awareness, awarenessIds);
      this.send(socket, encodeAwarenessBinary(rawAwareness));
    }

    socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      const data = toUint8Array(raw);
      const decoded = decodeMessage(data, room.doc, room.awareness, peerId);

      // Discover peer's awareness clientId from the first awareness message
      if (decoded.type === 'awareness' && peer.awarenessClientId === null) {
        for (const id of room.awareness.getStates().keys()) {
          if (id !== room.doc.clientID) {
            peer.awarenessClientId = id;
            this.emitPresence({ type: 'update', docId, peerId, peerCount: room.peers.size });
            break;
          }
        }
      }

      // Send reply to sender (SyncStep2 in response to SyncStep1)
      if (decoded.reply) {
        this.send(socket, decoded.reply);
      }

      // After responding to client Step1 with Step2, also send our own Step1
      // so the client can return Step2 with what WE are missing.
      if (decoded.type === 'sync' && decoded.syncType === 0) {
        this.send(socket, encodeSyncStep1(room.doc));
      }
    });

    socket.on('close', () => this.handleDisconnect(room, peer));
    socket.on('error', (err: Error) => {
      this.log.warn({ docId, peerId, err }, 'collab peer socket error');
      this.handleDisconnect(room, peer);
    });
  }

  private handleDisconnect(room: Room, peer: Peer): void {
    if (!room.peers.has(peer.id)) return; // Already removed
    room.peers.delete(peer.id);

    if (peer.awarenessClientId !== null) {
      removeAwarenessClients(room.awareness, [peer.awarenessClientId], peer.id);
    }

    this.log.debug(
      { docId: room.docId, peerId: peer.id, peerCount: room.peers.size },
      'collab peer left',
    );
    this.emitPresence({
      type: 'leave',
      docId: room.docId,
      peerId: peer.id,
      peerCount: room.peers.size,
    });

    this.updateRoomMetrics(room.docId, room.peers.size);

    if (room.peers.size === 0) {
      this.scheduleIdleTimeout(room);
    }
  }

  // ── Broadcast ───────────────────────────────────────────────────────────────

  private broadcastToRoom(room: Room, data: Uint8Array, excludeOrigin: string | null): void {
    for (const peer of room.peers.values()) {
      if (excludeOrigin && peer.id === excludeOrigin) continue;
      this.send(peer.socket, data);
    }
  }

  private send(socket: WebSocket, data: Uint8Array): void {
    if (socket.readyState !== WS_OPEN) return;
    try {
      socket.send(data);
    } catch (err) {
      this.log.warn({ err }, 'collab send failed');
    }
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  private flushRoom(room: Room): void {
    if (room.flushTimer) {
      clearTimeout(room.flushTimer);
      room.flushTimer = null;
    }
    if (room.pendingUpdates.length === 0) return;

    const updates = room.pendingUpdates.splice(0);
    const docId = room.docId;

    try {
      const persisted = this.loadDocState(docId);
      let merged: Uint8Array;

      if (persisted && persisted.state.length > 0) {
        merged = mergeUpdates([persisted.state, ...updates]);
      } else {
        merged = encodeDocState(room.doc);
      }

      const newCount = (persisted?.update_count ?? 0) + updates.length;
      const compact = newCount >= CRDT_COMPACTION_THRESHOLD;

      if (compact) {
        merged = encodeDocState(room.doc);
        this.upsertDocState(docId, merged, 0);
        this.log.debug({ docId, updates: newCount }, 'CRDT compaction completed');
      } else {
        this.upsertDocState(docId, merged, newCount);
      }
    } catch (err) {
      this.log.error({ docId, err }, 'CRDT flush error');
      room.pendingUpdates.unshift(...updates);
    }
  }

  private loadDocState(
    docId: string,
  ): { state: Uint8Array; schema_version: number; update_count: number } | null {
    const row = this.db
      .prepare('SELECT state, schema_version, update_count FROM crdt_docs WHERE doc_id = ?')
      .get(docId) as { state: Buffer; schema_version: number; update_count: number } | undefined;
    if (!row) return null;
    return {
      state: new Uint8Array(row.state),
      schema_version: row.schema_version,
      update_count: row.update_count,
    };
  }

  private upsertDocState(docId: string, state: Uint8Array, updateCount: number): void {
    withTransaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO crdt_docs (doc_id, state, schema_version, update_count, updated_at)
           VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
           ON CONFLICT (doc_id) DO UPDATE SET
             state = excluded.state,
             schema_version = excluded.schema_version,
             update_count = excluded.update_count,
             updated_at = excluded.updated_at`,
        )
        .run(docId, Buffer.from(state), CRDT_SCHEMA_VERSION, updateCount);
    });
  }

  // ── Room metrics (F1127) ────────────────────────────────────────────────────

  private upsertRoomMetrics(docId: string): void {
    try {
      this.db
        .prepare(
          `INSERT INTO collab_rooms (doc_id, peer_count, created_at, last_activity_at)
           VALUES (?, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
           ON CONFLICT (doc_id) DO NOTHING`,
        )
        .run(docId);
    } catch {
      // Non-fatal: e.g. if note doesn't exist yet
    }
  }

  private updateRoomMetrics(docId: string, peerCount: number): void {
    try {
      this.db
        .prepare(
          `UPDATE collab_rooms
           SET peer_count = ?, last_activity_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE doc_id = ?`,
        )
        .run(peerCount, docId);
    } catch {
      // Non-fatal
    }
  }

  private deleteRoomMetrics(docId: string): void {
    try {
      this.db.prepare('DELETE FROM collab_rooms WHERE doc_id = ?').run(docId);
    } catch {
      // Non-fatal
    }
  }

  // ── Debug / metrics API (F1127) ─────────────────────────────────────────────

  getRoomStats(): {
    activeRooms: number;
    totalPeers: number;
    rooms: Array<{ docId: string; peerCount: number; uptimeMs: number }>;
  } {
    const rooms = Array.from(this.rooms.values()).map((r) => ({
      docId: r.docId,
      peerCount: r.peers.size,
      uptimeMs: Date.now() - r.createdAt,
    }));
    return {
      activeRooms: rooms.length,
      totalPeers: rooms.reduce((n, r) => n + r.peerCount, 0),
      rooms,
    };
  }

  /** Presence query: current awareness states for a room (F1131). */
  getPresence(docId: string): Array<{ clientId: number; state: Record<string, unknown> }> {
    const room = this.rooms.get(docId);
    if (!room) return [];
    return Array.from(room.awareness.getStates().entries()).map(([clientId, state]) => ({
      clientId,
      state: state as Record<string, unknown>,
    }));
  }

  /**
   * Check if a note has an active collab room.
   * Used by horizontal-readiness check (F1128).
   */
  hasRoom(docId: string): boolean {
    return this.rooms.has(docId);
  }

  /**
   * Flush all rooms and clean up on server shutdown.
   */
  async shutdown(): Promise<void> {
    for (const room of this.rooms.values()) {
      this.flushRoom(room);
      if (room.idleTimer) clearTimeout(room.idleTimer);
      if (room.flushTimer) clearTimeout(room.flushTimer);
      room.awareness.destroy();
      room.doc.destroy();
    }
    this.rooms.clear();
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function toUint8Array(raw: Buffer | ArrayBuffer | Buffer[]): Uint8Array {
  if (raw instanceof Buffer) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  const total = (raw as Buffer[]).reduce((n, b) => n + b.length, 0);
  return Buffer.concat(raw as Buffer[], total);
}
