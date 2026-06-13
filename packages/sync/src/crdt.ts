/**
 * CRDT core for Fables — Yjs integration (F1101–F1110).
 *
 * Architecture boundary:
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │  Op-log (SyncEngine) — canonical for note metadata, titles,    │
 *   │  notebook membership, tags, entities, save-slots.              │
 *   │                                                                │
 *   │  CRDT (this module) — live co-editing of note.body only.      │
 *   │  On disconnect / save, the final CRDT text is written back     │
 *   │  to the op-log as a NoteUpdateOp so metadata stays canonical. │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * Y.Doc lifecycle:
 *   - One Y.Doc per note (keyed by noteId).
 *   - The note body lives in doc.getText('body').
 *   - Snapshots are stored as binary state updates in the `crdt_docs` table
 *     (migration 018).  On reconnect the server loads the persisted state,
 *     encodes its state vector, and sends it back; the client sends only the
 *     diff.
 *
 * Protocol framing (binary, matches y-websocket-compatible providers):
 *   Message byte layout:
 *   [msgType: 1 varint byte] [payload…]
 *
 *   msgType 0 = Sync message (y-protocols/sync framing):
 *     [0x00] [syncSubType: 1 varint] [payload…]
 *     syncSubType 0 = SyncStep1 (client→server on connect, carries state vector)
 *     syncSubType 1 = SyncStep2 (server→client reply, carries missing updates)
 *     syncSubType 2 = Update (bidirectional incremental update)
 *
 *   msgType 1 = Awareness message:
 *     [0x01] [awarenessUpdate: varUint8Array]
 *
 *   This matches the y-websocket provider protocol exactly, so any standard
 *   y-websocket-compatible client can connect without custom configuration.
 *
 * Garbage collection:
 *   GC is disabled on the server Y.Doc (gc: false) so that all tombstones are
 *   retained for catch-up diffing.  Client docs may enable GC freely.
 *   Compaction: the server merges all stored updates into a single snapshot
 *   after CRDT_COMPACTION_THRESHOLD individual update rows accumulate.
 *
 * Document versioning:
 *   The `crdt_docs` table carries a `schema_version` column.  On load we check
 *   that the stored version equals CRDT_SCHEMA_VERSION; if it differs we run
 *   the migration handler (currently: clear + reinitialise from op-log body).
 */

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';

// ── Constants ──────────────────────────────────────────────────────────────────

export const CRDT_SCHEMA_VERSION = 1;

/** Number of update rows before triggering compaction. */
export const CRDT_COMPACTION_THRESHOLD = 100;

// Protocol message type bytes (top-level)
export const MSG_SYNC = 0;
export const MSG_AWARENESS = 1;

// ── Minimal varint encode/decode (no lib0 dependency) ─────────────────────────
// lib0 is a transitive dep of yjs but not directly installed; we implement the
// subset we need (varint reading/writing + varUint8Array) inline.

function writeVarUint(buf: number[], n: number): void {
  while (n > 0x7f) {
    buf.push(0x80 | (n & 0x7f));
    n >>>= 7;
  }
  buf.push(n);
}

function writeVarUint8Array(buf: number[], arr: Uint8Array): void {
  writeVarUint(buf, arr.length);
  for (let i = 0; i < arr.length; i++) buf.push(arr[i]!);
}

function readVarUint(data: Uint8Array, pos: { v: number }): number {
  let result = 0;
  let shift = 0;
  while (pos.v < data.length) {
    const b = data[pos.v++]!;
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return result >>> 0;
}

function readVarUint8Array(data: Uint8Array, pos: { v: number }): Uint8Array {
  const len = readVarUint(data, pos);
  const slice = data.slice(pos.v, pos.v + len);
  pos.v += len;
  return slice;
}

function toUint8Array(buf: number[]): Uint8Array {
  return new Uint8Array(buf);
}

// ── lib0-compatible encoder/decoder for y-protocols ───────────────────────────
// y-protocols uses lib0/encoding internally — we provide a shim that satisfies
// the types by forwarding to y-protocols' own encoder/decoder constructors via
// dynamic import, but since we call y-protocols directly with encoding objects
// we need to use its internal encoding primitives.
//
// STRATEGY: Instead of using y-protocols' readSyncMessage (which needs lib0),
// we parse the sync messages ourselves and use Y.Doc methods directly.

// ── Document factory ───────────────────────────────────────────────────────────

/**
 * Create a server-side Y.Doc for a note body.
 * GC disabled so tombstones survive for catch-up diffing.
 */
export function createNoteDoc(): Y.Doc {
  return new Y.Doc({ gc: false });
}

/**
 * The note body lives in a shared Y.Text named 'body'.
 * Markdown semantics are preserved as plain text — no rich-text attributes —
 * so the markdown string is the single source of truth for rendering.
 */
export function getNoteText(doc: Y.Doc): Y.Text {
  return doc.getText('body');
}

// ── Encoding / decoding helpers ────────────────────────────────────────────────

/**
 * Encode the full document state as a binary update.
 * Used for storage and for SyncStep2 replies.
 */
export function encodeDocState(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/**
 * Encode only the state vector (for SyncStep1).
 */
export function encodeDocStateVector(doc: Y.Doc): Uint8Array {
  return Y.encodeStateVector(doc);
}

/**
 * Apply a binary update to a doc.  Returns true on success.
 */
export function applyDocUpdate(doc: Y.Doc, update: Uint8Array, origin?: string): boolean {
  try {
    Y.applyUpdate(doc, update, origin);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compute the diff that `remote` needs to reach `local`'s state.
 */
export function diffUpdate(doc: Y.Doc, remoteStateVector: Uint8Array): Uint8Array {
  return Y.encodeStateAsUpdate(doc, remoteStateVector);
}

/**
 * Merge multiple binary updates into a single compact representation.
 */
export function mergeUpdates(updates: Uint8Array[]): Uint8Array {
  if (updates.length === 0) return new Uint8Array(0);
  if (updates.length === 1) return updates[0]!;
  return Y.mergeUpdates(updates);
}

// ── CRDT ↔ Op-log bridge ──────────────────────────────────────────────────────

/**
 * Extract the current note body text from a Y.Doc.
 */
export function extractBody(doc: Y.Doc): string {
  return getNoteText(doc).toString();
}

/**
 * Seed a Y.Doc from an existing plaintext body string.
 * Only inserts text if the doc is empty to avoid duplication.
 */
export function seedDocFromBody(doc: Y.Doc, body: string): void {
  const text = getNoteText(doc);
  if (text.length === 0 && body.length > 0) {
    doc.transact(() => {
      text.insert(0, body);
    });
  }
}

// ── Wire message framing (y-websocket compatible) ─────────────────────────────
//
// We implement the y-protocols/sync and awareness framing manually to avoid
// needing a direct lib0 dependency.  The format is identical to what
// y-websocket uses so any standard provider can connect.

/**
 * Encode a SyncStep1 message carrying our state vector.
 * Format: [0x00 MSG_SYNC] [0x00 step1] [stateVector as varUint8Array]
 */
export function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  const sv = Y.encodeStateVector(doc);
  const buf: number[] = [];
  writeVarUint(buf, MSG_SYNC);
  writeVarUint(buf, syncProtocol.messageYjsSyncStep1); // 0
  writeVarUint8Array(buf, sv);
  return toUint8Array(buf);
}

/**
 * Encode a SyncStep2 message carrying updates the remote peer is missing.
 * Format: [0x00 MSG_SYNC] [0x01 step2] [update as varUint8Array]
 */
export function encodeSyncStep2(doc: Y.Doc, remoteStateVector?: Uint8Array): Uint8Array {
  const update = Y.encodeStateAsUpdate(doc, remoteStateVector);
  const buf: number[] = [];
  writeVarUint(buf, MSG_SYNC);
  writeVarUint(buf, syncProtocol.messageYjsSyncStep2); // 1
  writeVarUint8Array(buf, update);
  return toUint8Array(buf);
}

/**
 * Encode an incremental update message.
 * Format: [0x00 MSG_SYNC] [0x02 update] [update as varUint8Array]
 */
export function encodeUpdate(update: Uint8Array): Uint8Array {
  const buf: number[] = [];
  writeVarUint(buf, MSG_SYNC);
  writeVarUint(buf, syncProtocol.messageYjsUpdate); // 2
  writeVarUint8Array(buf, update);
  return toUint8Array(buf);
}

/**
 * Encode an awareness update message.
 * Format: [0x01 MSG_AWARENESS] [awarenessUpdate as varUint8Array]
 */
export function encodeAwarenessMsg(
  awareness: awarenessProtocol.Awareness,
  clientIds: number[],
): Uint8Array {
  const update = awarenessProtocol.encodeAwarenessUpdate(awareness, clientIds);
  return encodeAwarenessBinary(update);
}

export function encodeAwarenessBinary(awarenessUpdate: Uint8Array): Uint8Array {
  const buf: number[] = [];
  writeVarUint(buf, MSG_AWARENESS);
  writeVarUint8Array(buf, awarenessUpdate);
  return toUint8Array(buf);
}

// ── Message decoding ──────────────────────────────────────────────────────────

export interface DecodedMessage {
  type: 'sync' | 'awareness' | 'unknown';
  /** For sync messages: inner y-protocols syncType (0=step1, 1=step2, 2=update). */
  syncType?: 0 | 1 | 2;
  /** For awareness messages: raw bytes. */
  awarenessUpdate?: Uint8Array;
  /** For step2/update messages: the raw Yjs update applied to the doc. */
  yjsUpdate?: Uint8Array;
  /** Encoded reply to send back (may be null if no reply needed). */
  reply: Uint8Array | null;
}

/**
 * Decode an incoming binary WebSocket message.
 *
 * For SyncStep1: replies with SyncStep2 (diff).
 * For SyncStep2/Update: applies to doc, returns update for rebroadcast.
 * For Awareness: applies to local awareness, returns update for rebroadcast.
 */
export function decodeMessage(
  data: Uint8Array,
  doc: Y.Doc,
  awareness: awarenessProtocol.Awareness,
  origin?: string,
): DecodedMessage {
  const pos = { v: 0 };
  if (pos.v >= data.length) return { type: 'unknown', reply: null };

  const msgType = readVarUint(data, pos);

  if (msgType === MSG_SYNC) {
    if (pos.v >= data.length) return { type: 'unknown', reply: null };
    const syncType = readVarUint(data, pos) as 0 | 1 | 2;

    if (syncType === syncProtocol.messageYjsSyncStep1) {
      // Client sent state vector; we reply with SyncStep2
      const sv = readVarUint8Array(data, pos);
      const reply = encodeSyncStep2(doc, sv);
      return { type: 'sync', syncType: 0, reply };
    } else if (syncType === syncProtocol.messageYjsSyncStep2) {
      // Client sent its missing updates; apply them
      const update = readVarUint8Array(data, pos);
      applyDocUpdate(doc, update, origin);
      return { type: 'sync', syncType: 1, yjsUpdate: update, reply: null };
    } else if (syncType === syncProtocol.messageYjsUpdate) {
      // Incremental update
      const update = readVarUint8Array(data, pos);
      applyDocUpdate(doc, update, origin);
      return { type: 'sync', syncType: 2, yjsUpdate: update, reply: null };
    }
    return { type: 'unknown', reply: null };
  } else if (msgType === MSG_AWARENESS) {
    const update = readVarUint8Array(data, pos);
    try {
      awarenessProtocol.applyAwarenessUpdate(awareness, update, origin ?? null);
    } catch {
      // Malformed awareness — non-fatal
    }
    return { type: 'awareness', awarenessUpdate: update, reply: null };
  }

  return { type: 'unknown', reply: null };
}

// ── GC / compaction ───────────────────────────────────────────────────────────

/**
 * Merge an array of stored update blobs into a single compacted state.
 */
export function compactUpdates(updates: Uint8Array[]): Uint8Array {
  if (updates.length === 0) return new Uint8Array(0);
  const doc = createNoteDoc();
  for (const u of updates) {
    applyDocUpdate(doc, u);
  }
  return encodeDocState(doc);
}

// ── Document versioning ────────────────────────────────────────────────────────

export interface CrdtDocRow {
  doc_id: string;
  state: Uint8Array;
  schema_version: number;
  updated_at: string;
}

/**
 * Migrate a stored CRDT document row to the current schema version.
 * Returns null if migration is impossible (caller reinitialises from op-log).
 */
export function migrateCrdtDoc(row: CrdtDocRow): Uint8Array | null {
  if (row.schema_version === CRDT_SCHEMA_VERSION) {
    return row.state;
  }
  // Unknown version → signal caller to reinitialise
  return null;
}

// ── Awareness ─────────────────────────────────────────────────────────────────

/**
 * Create an Awareness instance bound to a Y.Doc.
 */
export function createAwareness(doc: Y.Doc): awarenessProtocol.Awareness {
  return new awarenessProtocol.Awareness(doc);
}

/**
 * Remove client states on disconnect.
 */
export function removeAwarenessClients(
  awareness: awarenessProtocol.Awareness,
  clientIds: number[],
  origin?: string,
): void {
  awarenessProtocol.removeAwarenessStates(awareness, clientIds, origin ?? 'disconnect');
}

// Re-exports for consumers
export type { Awareness } from 'y-protocols/awareness';
export { Y };
