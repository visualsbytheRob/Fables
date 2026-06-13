/**
 * Save slots, rewind, and corrupt-save handling (F461, F464–F466, F469).
 * This is the pure library half — HTTP endpoints, autosave ring-buffer
 * wiring, slot UI metadata, and op-log sync (F462/F463/F467/F468) live in
 * the server/web lanes.
 */

import type { IrProgram } from './ir.js';
import type { MigrationReport, StorySaveState } from './state.js';
import { SaveError, validateSaveShape } from './state.js';
import type { Story, StoryOptions } from './vm.js';
import { createStory } from './vm.js';

/** A named snapshot of VM state plus story metadata (F461). */
export interface SaveSlot {
  readonly name: string;
  readonly createdAt: string;
  readonly storyTitle: string;
  readonly turn: number;
  /** Knot of the current flow position — a human "where am I" hint. */
  readonly scene: string;
  readonly state: StorySaveState;
}

export interface CreateSaveSlotOptions {
  /** Injectable clock for deterministic tests. Defaults to `Date`. */
  readonly now?: () => Date;
}

export function createSaveSlot(story: Story, name: string, options: CreateSaveSlotOptions = {}): SaveSlot {
  const state = story.saveState();
  const frame = state.frames[state.frames.length - 1];
  const scene = frame === undefined ? '' : (frame.container.split('#')[0] ?? frame.container);
  return {
    name,
    createdAt: (options.now?.() ?? new Date()).toISOString(),
    storyTitle: story.program.meta['title'] ?? '',
    turn: state.turn,
    scene,
    state,
  };
}

/**
 * Restore a slot into a story. Detects corruption (bad JSON shape, missing
 * fields, dangling references) and refuses gracefully with `SaveError`
 * instead of leaving the story half-restored (F469).
 */
export function restoreSaveSlot(
  story: Story,
  slot: SaveSlot | unknown,
  options: { migrate?: boolean } = {},
): MigrationReport | null {
  const state = extractState(slot);
  // Restore against a scratch copy first so corruption cannot wreck `story`.
  const probe = createStory(story.program, { seed: state.seed });
  probe.loadState(state, options);
  return story.loadState(state, options);
}

function extractState(slot: unknown): StorySaveState {
  if (typeof slot === 'string') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(slot);
    } catch {
      throw new SaveError('save slot is not valid JSON');
    }
    return extractState(parsed);
  }
  if (typeof slot !== 'object' || slot === null) throw new SaveError('save slot is not an object');
  const candidate = 'state' in slot ? (slot as { state: unknown }).state : slot;
  validateSaveShape(candidate);
  return candidate;
}

/**
 * Replay a story deterministically: same program, same seed, same choice
 * indexes. The backbone of rewind (F464) and debugger time travel (F496).
 */
export function replayStory(
  program: IrProgram,
  options: StoryOptions,
  choices: readonly number[],
): Story {
  const story = createStory(program, options);
  story.continue();
  for (const index of choices) {
    if (story.status !== 'choices') break;
    story.choose(index);
    story.continue();
  }
  return story;
}

/**
 * Rewind to any prior point in the choice history (F464): replays the first
 * `turn` choices against fresh state and returns the rewound story.
 */
export function rewindStory(story: Story, turn: number, options: StoryOptions = {}): Story {
  const state = story.saveState();
  if (turn < 0 || turn > state.history.length) {
    throw new SaveError(`cannot rewind to turn ${turn}: history has ${state.history.length} choices`);
  }
  return replayStory(story.program, { ...options, seed: state.seed }, state.history.slice(0, turn).map((h) => h.index));
}
