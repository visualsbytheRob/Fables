/**
 * Soundscape Triggers (F1637).
 *
 * Extracts sound-effect trigger calls (e.g. `~ play("door")`) from a Forge
 * story source.  Pure module -- no I/O.
 */

import { parse, findAll } from '@fables/forge-dsl';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SoundTrigger {
  knot: string;
  sound: string;
  fn: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_FNS = ['play', 'sound', 'sfx'];

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Parse `source` and return one {@link SoundTrigger} per call whose callee
 * name is in `fns` (default `['play', 'sound', 'sfx']`) and whose first
 * argument is a string literal.  Calls with no string-literal first arg are
 * skipped.  Returns `[]` on parse failure or empty source.
 *
 * Results are ordered by knot order in the story, then by source position
 * within each knot.
 */
export function extractSoundTriggers(source: string, fns: string[] = DEFAULT_FNS): SoundTrigger[] {
  let story: ReturnType<typeof parse>['story'] | undefined;
  try {
    const result = parse(source);
    story = result.story;
  } catch {
    return [];
  }

  if (!story) return [];

  const allowedFns = new Set(fns);
  const triggers: SoundTrigger[] = [];

  for (const knot of story.knots) {
    const knotName = knot.name.name;
    const calls = findAll(knot, 'Call');

    for (const call of calls) {
      const fnName = call.callee.name;
      if (!allowedFns.has(fnName)) continue;

      const firstArg = call.args[0];
      if (firstArg === undefined) continue;
      if (firstArg.kind !== 'Literal') continue;
      if (typeof firstArg.value !== 'string') continue;

      const sound = firstArg.value.trim();
      triggers.push({ knot: knotName, sound, fn: fnName });
    }
  }

  return triggers;
}
