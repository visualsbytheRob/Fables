/**
 * Host hooks (F481–F490). The VM is fully sandboxed: a story can only reach
 * the world through (a) the effect registry and (b) external functions the
 * host explicitly registers (allowlist, F485). Every crossing is recorded in
 * the per-playthrough audit log (F487), and host failures surface as
 * story-visible error values — the VM never crashes on a bad host (F488).
 *
 * ## Example
 *
 * ```ts
 * const story = createStory(bytecode, {
 *   host: {
 *     resolveEntityDisplay: (name, display) => display ?? entityDb.displayName(name),
 *     readEntityField: (name, field) => entityDb.read(name, field),
 *     resolveNote: (title) => `[[${title}]]`,
 *     onEffect: (name, args) => {
 *       if (name === 'PLAY_AUDIO') audio.play(String(args[0]));
 *       if (name === 'ENTITY_SET') entityDb.write(args);
 *     },
 *   },
 *   functions: {
 *     WEATHER: () => 'rainy',                       // sync
 *     FETCH_SCORE: async () => db.score(),          // async → use continueAsync()
 *   },
 * });
 * ```
 */

import type { Value } from './values.js';

/**
 * An external function callable from story logic (F481). Async functions
 * suspend the VM (F486); drive the story with `continueAsync()` when any
 * registered function returns promises.
 */
export type ExternalFunction = (...args: Value[]) => Value | Promise<Value>;

/** Host integration surface. Every member is optional; defaults are inert. */
export interface StoryHost {
  /** Display text for `@entity` / `@entity(Display Name)` in story prose. */
  resolveEntityDisplay?(name: string, displayName?: string): string;
  /** Value of `@entity.field` reads (F428). Throwing yields an error value. */
  readEntityField?(name: string, field: string | undefined): Value;
  /** Display text for `[[Note Title]]` references. */
  resolveNote?(title: string): string;
  /**
   * Opaque effect dispatch (F482–F484): PLAY_AUDIO, SET_THEME, VIBRATE,
   * PAUSE, JOURNAL, ENTITY_SET. Fire-and-forget; throwing yields an error
   * value into the story instead of crashing it.
   */
  onEffect?(name: string, args: readonly Value[]): void;
}

/** One audit-log entry (F487): every host crossing, in execution order. */
export interface AuditEntry {
  readonly turn: number;
  readonly kind: 'effect' | 'function' | 'entity-read';
  readonly name: string;
  readonly args: readonly string[];
  readonly ok: boolean;
  readonly error?: string;
}

/** Callback for variable observers (F444). */
export type VariableObserver = (name: string, value: Value, previous: Value | undefined) => void;
