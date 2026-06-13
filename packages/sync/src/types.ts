/**
 * Core sync types: operations, clocks, devices, cursors (F831, F835, F838).
 *
 * Design choices:
 *  - Every mutation is an Op carrying a Lamport clock, device ID, idempotency key.
 *  - Ops are discriminated unions per domain (note / entity / save-slot).
 *  - DeviceId is a branded string to prevent mixing with other IDs.
 *  - SyncCursor is a (serverSeq) number that survives process restarts via
 *    injected storage — never a wall-clock timestamp, which is skewable.
 *  - No runtime zod dependency: validation happens at HTTP boundaries in apps/server.
 */

// ── Branded types ─────────────────────────────────────────────────────────────

declare const brand: unique symbol;
type Branded<T, B extends string> = T & { readonly [brand]: B };

export type DeviceId = Branded<string, 'DeviceId'>;
export type OpId = Branded<string, 'OpId'>;

export function makeDeviceId(raw: string): DeviceId {
  return raw as DeviceId;
}

// ── Lamport clock ─────────────────────────────────────────────────────────────

/** Monotonically increasing logical timestamp. */
export type LamportClock = number;

/**
 * Advance a Lamport clock: take the max of local and received, then increment.
 * Pure — does not mutate anything.
 */
export function advanceClock(local: LamportClock, received: LamportClock): LamportClock {
  return Math.max(local, received) + 1;
}

/**
 * Increment local Lamport clock by 1 (for a locally generated event).
 */
export function tickClock(local: LamportClock): LamportClock {
  return local + 1;
}

// ── Sync cursor ───────────────────────────────────────────────────────────────

/**
 * Opaque cursor encoding a (serverSeq) position in the server op-log.
 * The server assigns strictly-monotonic seq numbers; clients remember the last
 * seq they successfully processed.
 */
export interface SyncCursor {
  /** Last server-assigned sequence number the client successfully applied. */
  serverSeq: number;
}

export const INITIAL_CURSOR: SyncCursor = { serverSeq: 0 };

export function encodeCursor(cursor: SyncCursor): string {
  return String(cursor.serverSeq);
}

export function decodeCursor(raw: string | null | undefined): SyncCursor {
  if (!raw) return INITIAL_CURSOR;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? { serverSeq: n } : INITIAL_CURSOR;
}

// ── Schema version negotiation (F865) ─────────────────────────────────────────

export const SYNC_SCHEMA_VERSION = 1;

// ── Per-domain op payload types ───────────────────────────────────────────────

export interface NoteUpsertPayload {
  notebookId: string;
  title: string;
  body: string;
  pinned?: boolean;
}

export interface NoteUpdatePayload {
  notebookId?: string;
  title?: string;
  body?: string;
  pinned?: boolean;
}

export interface NoteDeletePayload {
  noteId: string;
  hard: boolean;
}

export interface NoteRestorePayload {
  noteId: string;
}

export interface EntityUpsertPayload {
  notebookId?: string;
  type: string;
  name: string;
  fields: Record<string, unknown>;
  body?: string;
}

export interface EntityUpdatePayload {
  notebookId?: string;
  type?: string;
  name?: string;
  fields?: Record<string, unknown>;
  body?: string;
}

export interface EntityDeletePayload {
  entityId: string;
}

export interface SaveSlotUpsertPayload {
  storyId: string;
  slotName: string;
  state: Record<string, unknown>;
  deviceLabel?: string;
}

export interface SaveSlotDeletePayload {
  slotId: string;
}

// ── Common op header ──────────────────────────────────────────────────────────

interface OpHeader {
  /** Idempotency key — globally unique per device+clock (deviceId_lamport). */
  id: string;
  deviceId: string;
  lamport: number;
  schemaVersion: number;
  /** ISO timestamp for display only; ordering uses lamport. */
  clientCreatedAt: string;
}

// ── Discriminated op union ────────────────────────────────────────────────────

export interface NoteCreateOp extends OpHeader {
  domain: 'note';
  opType: 'create';
  entityId: string;
  payload: NoteUpsertPayload;
}

export interface NoteUpdateOp extends OpHeader {
  domain: 'note';
  opType: 'update';
  entityId: string;
  payload: NoteUpdatePayload;
}

export interface NoteDeleteOp extends OpHeader {
  domain: 'note';
  opType: 'delete';
  entityId: string;
  payload: NoteDeletePayload;
}

export interface NoteRestoreOp extends OpHeader {
  domain: 'note';
  opType: 'restore';
  entityId: string;
  payload: NoteRestorePayload;
}

export interface EntityCreateOp extends OpHeader {
  domain: 'entity';
  opType: 'create';
  entityId: string;
  payload: EntityUpsertPayload;
}

export interface EntityUpdateOp extends OpHeader {
  domain: 'entity';
  opType: 'update';
  entityId: string;
  payload: EntityUpdatePayload;
}

export interface EntityDeleteOp extends OpHeader {
  domain: 'entity';
  opType: 'delete';
  entityId: string;
  payload: EntityDeletePayload;
}

export interface SaveSlotUpsertOp extends OpHeader {
  domain: 'save_slot';
  opType: 'upsert';
  entityId: string;
  payload: SaveSlotUpsertPayload;
}

export interface SaveSlotDeleteOp extends OpHeader {
  domain: 'save_slot';
  opType: 'delete';
  entityId: string;
  payload: SaveSlotDeletePayload;
}

/** Discriminated union covering every op variant. */
export type SyncOp =
  | NoteCreateOp
  | NoteUpdateOp
  | NoteDeleteOp
  | NoteRestoreOp
  | EntityCreateOp
  | EntityUpdateOp
  | EntityDeleteOp
  | SaveSlotUpsertOp
  | SaveSlotDeleteOp;

// ── Device registry ────────────────────────────────────────────────────────────

export interface DeviceInfo {
  deviceId: DeviceId;
  name: string;
  lastSyncAt: string | null; // ISO
  lastSeenAt: string | null; // ISO
  createdAt: string; // ISO
}

// ── Sync health shape (F863) ──────────────────────────────────────────────────

export interface SyncHealth {
  lastSyncAt: string | null;
  pendingOps: number;
  appliedOps: number;
  quarantinedOps: number;
  lastError: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
}

// ── Snapshot (compaction result, F836) ────────────────────────────────────────

export interface EntitySnapshot {
  domain: 'note' | 'entity' | 'save_slot';
  entityId: string;
  /** Highest lamport clock included in this snapshot. */
  throughLamport: LamportClock;
  /** Server seq through which ops were compacted. */
  throughSeq: number;
  payload: Record<string, unknown>;
  createdAt: string;
}

// ── Per-op ack (F862) ─────────────────────────────────────────────────────────

export type OpAckStatus = 'accepted' | 'rejected' | 'duplicate';

export interface OpAck {
  opId: string;
  status: OpAckStatus;
  serverSeq?: number; // set for 'accepted'
  reason?: string; // set for 'rejected'
}

// ── Integrity checksum (F867) ─────────────────────────────────────────────────

export interface TableChecksum {
  table: string;
  rowCount: number;
  /** XOR-folded FNV hash of all entity IDs — deterministic, order-independent. */
  checksum: string;
}

// ── Schema version announcement ───────────────────────────────────────────────

export interface SchemaNegotiation {
  serverSchemaVersion: number;
  clientSchemaVersion: number;
  compatible: boolean;
  minSupportedVersion: number;
}
