/**
 * VM state serialization (F448–F449) and save-migration (F465) data shapes.
 * The whole runtime state of a story is a plain JSON-able object: globals,
 * visit counts (keyed by container *name* so saves can survive recompiles),
 * the call stack, alternative counters, PRNG state, turn counter, choice
 * history, and the pending choice point.
 */

import type { JsonValue } from './values.js';

/** Current state-format version (independent of the bytecode version). */
export const STATE_VERSION = 1;

export interface SavedFrame {
  /** Container name (resolved back to an index on load). */
  readonly container: string;
  readonly ip: number;
  readonly kind: 'flow' | 'tunnel';
  /** Temp slot values; null for frames without their own temp scope. */
  readonly temps: JsonValue[] | null;
}

export interface SavedPendingChoice {
  readonly flags: number;
  /** Container names; '' for no condition container. */
  readonly cond: string;
  readonly text: string;
  readonly body: string;
}

export interface SavedChoiceView {
  readonly index: number;
  readonly text: string;
  readonly tags: readonly string[];
  readonly sticky: boolean;
  readonly body: string;
}

export interface HistoryEntry {
  readonly turn: number;
  readonly index: number;
  readonly text: string;
}

export interface TranscriptEntry {
  readonly kind: 'text' | 'choice';
  readonly text: string;
  readonly tags?: readonly string[];
}

export interface StorySaveState {
  readonly stateVersion: number;
  /** `version:checksum` of the bytecode this state was created against (F449). */
  readonly bytecode: string;
  readonly seed: number;
  readonly prng: number;
  readonly turn: number;
  readonly status: 'running' | 'choices' | 'done';
  readonly history: readonly HistoryEntry[];
  readonly globals: Readonly<Record<string, JsonValue>>;
  /** Non-zero visit counts by container name. */
  readonly visits: Readonly<Record<string, number>>;
  readonly alts: Readonly<Record<string, { count: number; deck: readonly number[] }>>;
  readonly frames: readonly SavedFrame[];
  readonly stack: readonly JsonValue[];
  readonly pending: readonly SavedPendingChoice[];
  readonly choiceViews: readonly SavedChoiceView[];
  readonly lineBuf: string;
  readonly glue: boolean;
  readonly lineTags: readonly string[];
  readonly transcript: readonly TranscriptEntry[];
}

/** Best-effort migration report (F465). */
export interface MigrationReport {
  readonly migrated: true;
  /** Globals carried over by name. */
  readonly keptGlobals: readonly string[];
  /** Globals in the save that no longer exist (dropped). */
  readonly droppedGlobals: readonly string[];
  /** Visit counts carried over by container name. */
  readonly keptVisits: number;
  readonly droppedVisits: number;
  /** Flow position cannot be migrated: the story restarts at its entry point. */
  readonly notes: readonly string[];
}

/** Thrown when a save cannot be loaded (corruption, incompatible bytecode). */
export class SaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveError';
  }
}

/** Structural sanity check for untrusted save data (F469). */
export function validateSaveShape(s: unknown): asserts s is StorySaveState {
  if (typeof s !== 'object' || s === null) throw new SaveError('save is not an object');
  const o = s as Record<string, unknown>;
  if (o.stateVersion !== STATE_VERSION) {
    throw new SaveError(`unsupported save state version ${String(o.stateVersion)} (expected ${STATE_VERSION})`);
  }
  if (typeof o.bytecode !== 'string') throw new SaveError('save is missing its bytecode fingerprint');
  if (typeof o.turn !== 'number' || typeof o.prng !== 'number' || typeof o.seed !== 'number') {
    throw new SaveError('save is missing core counters');
  }
  if (o.status !== 'running' && o.status !== 'choices' && o.status !== 'done') {
    throw new SaveError('save has an invalid status');
  }
  if (!Array.isArray(o.frames) || !Array.isArray(o.history) || !Array.isArray(o.stack)) {
    throw new SaveError('save is missing flow data');
  }
  if (typeof o.globals !== 'object' || o.globals === null || typeof o.visits !== 'object' || o.visits === null) {
    throw new SaveError('save is missing variable data');
  }
}
