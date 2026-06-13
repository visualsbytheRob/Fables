/**
 * @fables/sync — offline-first op-log sync engine
 *
 * Public API surface for the web client and test harnesses.
 *
 * Note: zod validation schemas for HTTP boundaries live in apps/server (which
 * already depends on zod) rather than here, keeping this package dep-free.
 */

// Core types
export type {
  DeviceId,
  OpId,
  LamportClock,
  SyncCursor,
  SyncOp,
  NoteCreateOp,
  NoteUpdateOp,
  NoteDeleteOp,
  NoteRestoreOp,
  EntityCreateOp,
  EntityUpdateOp,
  EntityDeleteOp,
  SaveSlotUpsertOp,
  SaveSlotDeleteOp,
  NoteUpsertPayload,
  NoteUpdatePayload,
  NoteDeletePayload,
  NoteRestorePayload,
  EntityUpsertPayload,
  EntityUpdatePayload,
  EntityDeletePayload,
  SaveSlotUpsertPayload,
  SaveSlotDeletePayload,
  DeviceInfo,
  SyncHealth,
  EntitySnapshot,
  OpAck,
  OpAckStatus,
  TableChecksum,
  SchemaNegotiation,
} from './types.js';

export {
  SYNC_SCHEMA_VERSION,
  INITIAL_CURSOR,
  encodeCursor,
  decodeCursor,
  makeDeviceId,
  advanceClock,
  tickClock,
} from './types.js';

// Clock
export { compareLamport } from './clock.js';
export type { Clock } from './clock.js';

// Store interfaces + in-memory implementations
export type {
  LocalStore,
  CursorStorage,
  Outbox,
  NoteRow,
  EntityRow,
  SaveSlotRow,
} from './store.js';
export { MemoryStore, MemoryCursorStorage, MemoryOutbox } from './store.js';

// Op application
export { applyOp, applyOps } from './apply.js';
export type { ApplyResult, ApplyError } from './apply.js';

// Conflict resolution
export {
  lwwField,
  threeWayMerge,
  resolveTombstoneConflict,
  createSaveSlotConflict,
  emptyConflictMetrics,
} from './conflict.js';
export type {
  VersionedField,
  MergeResult,
  TombstoneDecision,
  SaveSlotConflict,
  ConflictMetrics,
} from './conflict.js';

// Backoff + reliability
export { computeBackoff, RejectionTracker, DEFAULT_BACKOFF } from './backoff.js';
export type { BackoffConfig, BackoffResult, BatchAck } from './backoff.js';

// Sync engine
export { SyncEngine, DEFAULT_ENGINE_CONFIG } from './engine.js';
export type { SyncEngineConfig, SyncTransport, PullResponse, PushResponse } from './engine.js';

// Compaction
export { compactEntity, findCompactionCandidates } from './compaction.js';
export type { CompactionInput } from './compaction.js';

// Checksum
export { computeChecksum, buildChecksum, compareChecksums } from './checksum.js';

// CRDT core (F1101–F1110)
export {
  CRDT_SCHEMA_VERSION,
  CRDT_COMPACTION_THRESHOLD,
  MSG_SYNC,
  MSG_AWARENESS,
  createNoteDoc,
  getNoteText,
  encodeDocState,
  encodeDocStateVector,
  applyDocUpdate,
  diffUpdate,
  mergeUpdates,
  compactUpdates,
  seedDocFromBody,
  extractBody,
  encodeSyncStep1,
  encodeSyncStep2,
  encodeUpdate,
  encodeAwarenessMsg,
  encodeAwarenessBinary,
  decodeMessage,
  createAwareness,
  removeAwarenessClients,
  migrateCrdtDoc,
  Y,
} from './crdt.js';
export type { CrdtDocRow, DecodedMessage, Awareness } from './crdt.js';
export type { Doc as YDoc } from 'yjs';

// Re-export awareness protocol utilities needed by the server collab service
export { encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness';
