/**
 * Knowledge simulation (F646/F647). Playtesting a story that reads
 * `@entity.field` knowledge bindings shouldn't have to hit live entity data —
 * an author wants to try "what if Fox.cunning were 9?" deterministically. This
 * module builds a VM `StoryHost` backed by an in-memory mock map, and tracks
 * every `@entity.field` read so the pane can warn when a read fell through to
 * unmocked (live) data — a determinism risk for recorded scenarios (F647).
 *
 * Pure module: the pane only renders the mock editor and the flag.
 */
import type { StoryHost, Value } from '@fables/forge-vm';
import { parseVarInput } from './playtest/engine.js';

/** Mocked entity field values: entity name → (field → value). */
export type SimMocks = ReadonlyMap<string, ReadonlyMap<string, Value>>;

/** Records which `@entity.field` reads a sim run made, and how each resolved. */
export interface SimReadLog {
  /** Reads served from a mock. */
  readonly mocked: ReadonlySet<string>;
  /** Reads with no mock backing — these would hit live data (F647). */
  readonly live: ReadonlySet<string>;
}

/** A sim host plus the live mutable read log it writes into. */
export interface SimHost {
  readonly host: StoryHost;
  /** True once any `@entity.field` read had no mock (read after a run). */
  usedLiveBindings(): boolean;
  /** Snapshot of the reads observed so far. */
  log(): SimReadLog;
}

const readKey = (name: string, field: string): string => `${name}.${field}`;

/**
 * Parse free-text mock lines (`entity.field = value`, one per line) into a
 * nested mock map. Values reuse the playtest VAR parser (booleans, numbers,
 * quoted/bare strings). Blank lines and malformed lines are skipped.
 */
export function parseMockInput(text: string): Map<string, Map<string, Value>> {
  const mocks = new Map<string, Map<string, Value>>();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('//')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const lhs = line.slice(0, eq).trim();
    const rhs = line.slice(eq + 1).trim();
    const dot = lhs.indexOf('.');
    if (dot === -1 || rhs === '') continue;
    const name = lhs.slice(0, dot).trim().replace(/^@/, '');
    const field = lhs.slice(dot + 1).trim();
    if (name === '' || field === '') continue;
    const fields = mocks.get(name) ?? new Map<string, Value>();
    fields.set(field, parseVarInput(rhs));
    mocks.set(name, fields);
  }
  return mocks;
}

/** Build the mock map from already-structured `{name: {field: value}}` pairs. */
export function mocksFrom(
  pairs: Readonly<Record<string, Readonly<Record<string, Value>>>>,
): Map<string, Map<string, Value>> {
  const mocks = new Map<string, Map<string, Value>>();
  for (const [name, fields] of Object.entries(pairs)) {
    mocks.set(name, new Map(Object.entries(fields)));
  }
  return mocks;
}

/**
 * Make a VM host that serves mocked `@entity.field` reads from `mocks` and
 * records every read. A read with no mock is logged as "live": the host still
 * returns a placeholder so the run completes, but `usedLiveBindings()` flips so
 * callers can flag the determinism risk (F647).
 *
 * Lookups are case-insensitive on the entity name to match the player host.
 */
export function makeSimHost(mocks: SimMocks): SimHost {
  const lower = new Map<string, ReadonlyMap<string, Value>>();
  for (const [name, fields] of mocks) lower.set(name.toLowerCase(), fields);

  const mocked = new Set<string>();
  const live = new Set<string>();

  const host: StoryHost = {
    resolveEntityDisplay(name, displayName) {
      return displayName ?? name;
    },
    readEntityField(name, field) {
      if (field === undefined) throw new Error(`@${name} needs a field to be read`);
      const key = readKey(name, field);
      const fields = lower.get(name.toLowerCase());
      const value = fields?.get(field);
      if (value !== undefined) {
        mocked.add(key);
        return value;
      }
      // No mock: this read would hit live data. Record it and return a benign
      // placeholder so the playtest run continues deterministically.
      live.add(key);
      return 0;
    },
    resolveNote(title) {
      return `[[${title}]]`;
    },
  };

  return {
    host,
    usedLiveBindings: () => live.size > 0,
    log: () => ({ mocked: new Set(mocked), live: new Set(live) }),
  };
}
