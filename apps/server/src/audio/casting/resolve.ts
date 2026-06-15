/**
 * Cast resolver (F1618).
 *
 * Resolves each ScriptLine to a concrete voice using a CastSheet and
 * fallback rules.
 *
 * Fallback order:
 *   1. narration line          → cast.narrator
 *   2. dialogue + known speaker  → cast.bySpeaker[speaker.toLowerCase()]
 *   3. dialogue + unknown/unmatched speaker → cast.defaultCharacter ?? cast.narrator
 *   4. nothing available       → voice: null
 *
 * Pure module — no I/O.
 */

import type { ScriptLine } from './separate.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface VoiceAssignment {
  voiceId: string;
  // `| undefined` so zod-parsed route/repo payloads assign cleanly under
  // exactOptionalPropertyTypes.
  rate?: number | undefined;
  pitch?: number | undefined;
}

export interface CastSheet {
  /** Voice for narration lines. */
  narrator: VoiceAssignment | null;
  /** Lowercased speaker name → voice. */
  bySpeaker: Record<string, VoiceAssignment>;
  /** Fallback voice for dialogue whose speaker isn't in bySpeaker. */
  defaultCharacter: VoiceAssignment | null;
}

export interface ResolvedLine extends ScriptLine {
  voice: VoiceAssignment | null;
}

// ---------------------------------------------------------------------------
// Main exports
// ---------------------------------------------------------------------------

/**
 * Resolve each ScriptLine to a voice assignment using `cast`.
 *
 * @param lines - Ordered script lines from separateScript.
 * @param cast  - CastSheet mapping speakers and narrator to voice assignments.
 */
export function resolveCast(lines: ScriptLine[], cast: CastSheet): ResolvedLine[] {
  return lines.map((line): ResolvedLine => {
    if (line.kind === 'narration') {
      return { ...line, voice: cast.narrator };
    }

    // Dialogue line.
    if (line.speaker !== null) {
      const key = line.speaker.toLowerCase();
      const byName = cast.bySpeaker[key];
      if (byName !== undefined) {
        return { ...line, voice: byName };
      }
    }

    // Unknown/unmatched speaker — use defaultCharacter, then narrator.
    const fallback = cast.defaultCharacter ?? cast.narrator;
    return { ...line, voice: fallback };
  });
}

/**
 * Count how many lines resolved to a non-null voice.
 *
 * Useful for a "X% cast" readout in the UI.
 *
 * @param lines - Ordered script lines from separateScript.
 * @param cast  - CastSheet to evaluate coverage against.
 */
export function castCoverage(
  lines: ScriptLine[],
  cast: CastSheet,
): { total: number; cast: number; uncast: number } {
  const resolved = resolveCast(lines, cast);
  const castCount = resolved.filter((l) => l.voice !== null).length;
  return {
    total: resolved.length,
    cast: castCount,
    uncast: resolved.length - castCount,
  };
}
