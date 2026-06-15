/**
 * Save-slot metadata (F467).
 *
 * Turns a stored save's flow state into the metadata a slot list shows: where
 * the reader is (scene/knot name), how far in (a real progress fraction from
 * distinct knots visited vs the story's knot count, or 100% when finished), the
 * turn count and timestamps. Pure — the route supplies the knot total from the
 * compiled program and the denormalised scene/turn from the save row.
 */

import type { StorySaveState } from '@fables/forge-vm';

export interface SaveProgress {
  /** 0..1, or null when the story's knot total is unknown. */
  progress: number | null;
  /** Distinct knots the reader has visited at least once. */
  visitedKnots: number;
  status: 'running' | 'choices' | 'done';
}

/**
 * Compute reader progress from a save state. A finished story is 100%; otherwise
 * progress is the share of the story's knots visited at least once. `visits`
 * keys can be `knot.stitch`/`knot#label` — we count distinct top-level knots.
 */
export function computeProgress(state: StorySaveState, totalKnots: number): SaveProgress {
  const visitedKnots = distinctKnots(state.visits);
  if (state.status === 'done') {
    return { progress: 1, visitedKnots, status: 'done' };
  }
  if (totalKnots <= 0) {
    return { progress: null, visitedKnots, status: state.status };
  }
  const progress = Math.min(1, visitedKnots / totalKnots);
  return { progress, visitedKnots, status: state.status };
}

/** Distinct top-level knot names among visited containers. */
function distinctKnots(visits: Readonly<Record<string, number>>): number {
  const knots = new Set<string>();
  for (const [name, count] of Object.entries(visits)) {
    if (count > 0) {
      const top = name.split(/[.#]/)[0];
      if (top) knots.add(top);
    }
  }
  return knots.size;
}

export interface SaveSlot {
  id: string;
  name: string;
  kind: string;
  turn: number;
  sceneName: string;
  status: 'running' | 'choices' | 'done';
  progress: number | null;
  visitedKnots: number;
  createdAt: string;
  updatedAt: string;
}

export interface SlotInput {
  id: string;
  name: string;
  kind: string;
  turn: number;
  scene: string;
  state: StorySaveState;
  createdAt: string;
  updatedAt: string;
}

/** Build the display slot for one save against the story's knot total. */
export function toSaveSlot(input: SlotInput, totalKnots: number): SaveSlot {
  const { progress, visitedKnots, status } = computeProgress(input.state, totalKnots);
  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    turn: input.turn,
    sceneName: input.scene,
    status,
    progress,
    visitedKnots,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}
