/**
 * CollabProvider (F1111–F1119): a minimal y-websocket-style WebSocket provider
 * that connects a Y.Doc to `GET /api/v1/collab/:docId` using the standard
 * y-protocols binary framing:
 *
 *   Outer message type (varUint at byte 0):
 *     0 = SYNC, 1 = AWARENESS
 *
 *   SYNC sub-messages (next varUint after outer type):
 *     0 | <sv>     → sync step 1: here is my state vector; send me what I'm missing
 *     1 | <update> → sync step 2: here are the updates you're missing
 *     2 | <update> → incremental update
 *
 *   AWARENESS sub-message (immediately follows outer type 1):
 *     <awareness update bytes>
 *
 * This framing is identical to y-websocket's and the server lane MUST implement
 * the same protocol using y-protocols on the Node.js side.
 *
 * Notes:
 *   F1124: reconnection with state-vector catch-up (exponential back-off).
 *   F1119: graceful degradation — Y.Doc keeps accepting local edits when offline.
 *   F1138: awareness state removed on disconnect/destroy.
 *
 * We implement the binary encoding inline (in ./msgpack.ts) rather than
 * importing lib0 directly, because lib0 is not a listed dependency of apps/web.
 * The framing produced is byte-for-byte compatible with lib0's encoder.
 */

import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { Encoder, Decoder } from './msgpack.js';

export type ConnState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface CollabUser {
  name: string;
  color: string;
}

export interface CollabProviderOptions {
  docId: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  /** Collab endpoint base path (default `/api/v1/collab`). */
  wsBase?: string;
  onStateChange?: (state: ConnState) => void;
}

// y-protocols sync message sub-types
const SYNC_STEP1 = 0;
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;

// Outer message types
const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

// Use a numeric constant rather than WebSocket.OPEN so mocks work cleanly.
const WS_OPEN = 1;

export class CollabProvider {
  private ws: WebSocket | null = null;
  private destroyed = false;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private _state: ConnState = 'disconnected';

  private readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  private readonly wsUrl: string;
  private readonly onStateChange: ((state: ConnState) => void) | undefined;

  private readonly _onDocUpdate: (update: Uint8Array, origin: unknown) => void;
  private readonly _onAwarenessUpdate: (arg: {
    added: number[];
    updated: number[];
    removed: number[];
  }) => void;

  get state(): ConnState {
    return this._state;
  }

  constructor({ docId, doc, awareness, wsBase, onStateChange }: CollabProviderOptions) {
    this.doc = doc;
    this.awareness = awareness;
    this.onStateChange = onStateChange;

    const basePath = wsBase ?? '/api/v1/collab';
    const proto =
      typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = typeof window !== 'undefined' ? window.location.host : 'localhost';
    this.wsUrl = `${proto}://${host}${basePath}/${encodeURIComponent(docId)}`;

    // F1111: forward local Y.Doc updates to the server
    this._onDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === this) return; // skip updates that arrived from the WS
      this._sendSyncUpdate(update);
    };
    doc.on('update', this._onDocUpdate);

    // F1131: forward local awareness changes
    this._onAwarenessUpdate = ({
      added,
      updated,
      removed,
    }: {
      added: number[];
      updated: number[];
      removed: number[];
    }) => {
      const changed = [...added, ...updated, ...removed];
      if (changed.length === 0) return;
      const enc = new Encoder();
      enc.writeVarUint(MSG_AWARENESS);
      enc.writeVarUint8Array(
        awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
      );
      this._sendRaw(enc.toUint8Array());
    };
    awareness.on('update', this._onAwarenessUpdate);

    this._connect();
  }

  // ---- connection lifecycle ----

  private _setState(s: ConnState) {
    if (this._state === s) return;
    this._state = s;
    this.onStateChange?.(s);
  }

  private _connect() {
    if (this.destroyed) return;
    this._setState('connecting');
    try {
      const ws = new WebSocket(this.wsUrl);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      ws.addEventListener('open', () => {
        if (this.destroyed || ws !== this.ws) {
          ws.close();
          return;
        }
        this.retries = 0;
        this._setState('connected');
        this._sendSyncStep1();
        this._broadcastLocalAwareness();
      });

      ws.addEventListener('message', (ev: MessageEvent) => {
        if (ws !== this.ws) return;
        this._handleMessage(new Uint8Array(ev.data as ArrayBuffer));
      });

      ws.addEventListener('close', () => {
        if (this.destroyed || ws !== this.ws) return;
        this.ws = null;
        // F1138: remove our awareness state so peers see us leave
        awarenessProtocol.removeAwarenessStates(
          this.awareness,
          [this.doc.clientID],
          'disconnect',
        );
        this._setState('disconnected');
        this._scheduleReconnect();
      });

      ws.addEventListener('error', () => {
        if (ws !== this.ws) return;
        this._setState('error');
      });
    } catch {
      this._setState('error');
      this._scheduleReconnect();
    }
  }

  private _scheduleReconnect() {
    if (this.destroyed) return;
    const delay = BACKOFF_MS[Math.min(this.retries, BACKOFF_MS.length - 1)];
    this.retries += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this._connect();
    }, delay);
  }

  // ---- y-protocols sync framing ----

  /**
   * Send sync step 1: outer=SYNC, inner=STEP1, body=state-vector.
   */
  private _sendSyncStep1() {
    const sv = Y.encodeStateVector(this.doc);
    const enc = new Encoder();
    enc.writeVarUint(MSG_SYNC);
    enc.writeVarUint(SYNC_STEP1);
    enc.writeVarUint8Array(sv);
    this._sendRaw(enc.toUint8Array());
  }

  /**
   * Send sync step 2: outer=SYNC, inner=STEP2, body=missing updates.
   * Called in response to a peer's step1.
   */
  private _sendSyncStep2(peerStateVector: Uint8Array) {
    const update = Y.encodeStateAsUpdate(this.doc, peerStateVector);
    const enc = new Encoder();
    enc.writeVarUint(MSG_SYNC);
    enc.writeVarUint(SYNC_STEP2);
    enc.writeVarUint8Array(update);
    this._sendRaw(enc.toUint8Array());
  }

  /**
   * Send an incremental update: outer=SYNC, inner=UPDATE, body=update.
   */
  private _sendSyncUpdate(update: Uint8Array) {
    if (this.ws?.readyState !== WS_OPEN) return;
    const enc = new Encoder();
    enc.writeVarUint(MSG_SYNC);
    enc.writeVarUint(SYNC_UPDATE);
    enc.writeVarUint8Array(update);
    this._sendRaw(enc.toUint8Array());
  }

  /** Broadcast our full local awareness state. */
  private _broadcastLocalAwareness() {
    const enc = new Encoder();
    enc.writeVarUint(MSG_AWARENESS);
    enc.writeVarUint8Array(
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]),
    );
    this._sendRaw(enc.toUint8Array());
  }

  private _handleMessage(msg: Uint8Array) {
    const dec = new Decoder(msg);
    const msgType = dec.readVarUint();

    if (msgType === MSG_SYNC) {
      const syncType = dec.readVarUint();
      if (syncType === SYNC_STEP1) {
        // Peer wants our state; respond with step2
        const peerSV = dec.readVarUint8Array();
        this._sendSyncStep2(peerSV);
      } else if (syncType === SYNC_STEP2 || syncType === SYNC_UPDATE) {
        // Apply the incoming update to our doc (origin=this to avoid re-sending)
        const update = dec.readVarUint8Array();
        Y.applyUpdate(this.doc, update, this);
      }
    } else if (msgType === MSG_AWARENESS) {
      const awarenessUpdate = dec.readVarUint8Array();
      awarenessProtocol.applyAwarenessUpdate(this.awareness, awarenessUpdate, this);
    }
  }

  private _sendRaw(data: Uint8Array) {
    if (this.ws?.readyState === WS_OPEN) {
      this.ws.send(data);
    }
  }

  // ---- public API ----

  /** Update the local user's awareness user field. */
  setLocalUser(user: Partial<CollabUser> & Record<string, unknown>) {
    this.awareness.setLocalStateField('user', user);
  }

  /** Disconnect, cancel reconnect, remove listeners. */
  destroy() {
    this.destroyed = true;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.doc.off('update', this._onDocUpdate);
    this.awareness.off('update', this._onAwarenessUpdate);
    awarenessProtocol.removeAwarenessStates(
      this.awareness,
      [this.doc.clientID],
      'destroy',
    );
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
