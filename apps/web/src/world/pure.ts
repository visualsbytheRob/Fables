/**
 * Pure helpers for the World inspector UI (F681–F688). Kept free of React and
 * the network so they can be unit-tested directly.
 */
import type { SnapshotFieldDiff, WorldEntityView, WorldExport } from './api.js';

/** Stable, human-readable rendering of an arbitrary field value. */
export function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return '∅';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((v) => formatFieldValue(v)).join(', ');
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export interface MutationSummary {
  /** Fields a live story write has touched, sorted by name. */
  fields: string[];
  /** Total mutation events across all mutated fields. */
  totalCount: number;
  /** Distinct story ids that wrote any field on this entity. */
  storyIds: string[];
  /** True when at least one field was story-mutated. */
  hasMutations: boolean;
}

/** Roll up an entity's `mutatedFields` map into a flat summary (F681). */
export function summarizeMutations(view: WorldEntityView): MutationSummary {
  const entries = Object.entries(view.mutatedFields);
  const fields = entries.map(([field]) => field).sort();
  let totalCount = 0;
  const storyIds = new Set<string>();
  for (const [, info] of entries) {
    totalCount += info.count;
    for (const id of info.storyIds) storyIds.add(id);
  }
  return {
    fields,
    totalCount,
    storyIds: [...storyIds].sort(),
    hasMutations: fields.length > 0,
  };
}

/** CSS modifier class for a snapshot-diff row by status (F685). */
export function diffRowClass(status: SnapshotFieldDiff['status']): string {
  return `world-diff-row world-diff-${status}`;
}

/** Two-character glyph marking a diff status, for compact display (F685). */
export function diffStatusGlyph(status: SnapshotFieldDiff['status']): string {
  switch (status) {
    case 'added':
      return '+';
    case 'removed':
      return '−';
    case 'changed':
      return '~';
  }
}

/** Timestamped filename for a downloaded world export (F688). */
export function exportFilename(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  return `fables-world-${stamp}.json`;
}

/** Pretty-printed JSON blob for an export download (F688). */
export function exportBlob(payload: WorldExport): Blob {
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

/**
 * Validate a parsed import payload to the minimum the server requires (F688).
 * Throws with a readable message rather than letting a bad POST 422 silently.
 */
export function assertWorldExport(value: unknown): asserts value is WorldExport {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Import file must be a JSON object.');
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.version !== 'number' || !Number.isInteger(obj.version) || obj.version < 1) {
    throw new Error('Import file is missing a valid "version".');
  }
  if (!Array.isArray(obj.entities)) {
    throw new Error('Import file is missing an "entities" array.');
  }
  for (const entity of obj.entities) {
    if (
      typeof entity !== 'object' ||
      entity === null ||
      typeof (entity as Record<string, unknown>).id !== 'string' ||
      typeof (entity as Record<string, unknown>).fields !== 'object'
    ) {
      throw new Error('Each entity must have a string id and a fields object.');
    }
  }
}
