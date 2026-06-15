/**
 * Recording Studio — narration plan (Epic 17, F1656 + F1657).
 *
 * Decides, for each narration line, whether it will be voiced by a human
 * recording, fall back to TTS, or remain uncast — and produces a checklist
 * of the lines a narrator still needs to record.
 *
 * Pure module — no I/O.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** How a line will be voiced in the final mix. */
export type LineSource = 'human' | 'tts' | 'uncast';

/** Input: one line that may need audio. `cast` = a TTS voice is assigned. */
export interface PlanInput {
  lineKey: string;
  text: string;
  cast: boolean;
}

export interface PlanLine extends PlanInput {
  hasHuman: boolean;
  source: LineSource;
}

export interface RecordingPlan {
  lines: PlanLine[];
  total: number;
  /** Lines with a human take. */
  recorded: number;
  /** Lines still needing a human recording (total - recorded). */
  remaining: number;
  /** Lines that will use TTS (cast, no human take). */
  ttsFallback: number;
  /** Lines with neither a human take nor a TTS voice. */
  uncast: number;
  /** 0..1 fraction recorded by a human. */
  humanCoverage: number;
}

// ---------------------------------------------------------------------------
// Main exports
// ---------------------------------------------------------------------------

/**
 * Build a full recording plan for a set of narration lines.
 *
 * @param lines        - Ordered narration inputs describing each line.
 * @param recordedKeys - Set of lineKeys for which a human take exists.
 */
export function buildRecordingPlan(
  lines: PlanInput[],
  recordedKeys: ReadonlySet<string>,
): RecordingPlan {
  const planLines: PlanLine[] = lines.map((input): PlanLine => {
    const hasHuman = recordedKeys.has(input.lineKey);
    const source: LineSource = hasHuman ? 'human' : input.cast ? 'tts' : 'uncast';
    return { ...input, hasHuman, source };
  });

  const total = planLines.length;
  const recorded = planLines.filter((l) => l.source === 'human').length;
  const ttsFallback = planLines.filter((l) => l.source === 'tts').length;
  const uncast = planLines.filter((l) => l.source === 'uncast').length;
  const remaining = total - recorded;
  const humanCoverage = total === 0 ? 0 : recorded / total;

  return {
    lines: planLines,
    total,
    recorded,
    remaining,
    ttsFallback,
    uncast,
    humanCoverage,
  };
}

/**
 * Return the line keys still needing a human recording, in input order (F1657).
 *
 * These are the lines whose source is not 'human' — either falling back to
 * TTS or fully uncast. The narrator works through this list to hit 100% human
 * coverage.
 *
 * @param plan - A RecordingPlan produced by {@link buildRecordingPlan}.
 */
export function sessionChecklist(plan: RecordingPlan): string[] {
  return plan.lines.filter((l) => l.source !== 'human').map((l) => l.lineKey);
}
