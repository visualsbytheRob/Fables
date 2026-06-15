/**
 * Script separator (F1613).
 *
 * Splits prose into an ordered list of narration vs dialogue lines by
 * leveraging attributeDialogue to locate and attribute quoted spans.
 *
 * The attribution verb phrase (e.g. "said Alice.") is kept as part of the
 * surrounding narration so that no text is silently dropped. Narration
 * segments before, between, and after quoted spans are emitted in source
 * order; empty or whitespace-only narration segments are skipped.
 *
 * Pure module — no I/O.
 */

import { attributeDialogue } from './attribution.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LineKind = 'narration' | 'dialogue';

export interface ScriptLine {
  kind: LineKind;
  text: string;
  /** Speaker name for dialogue lines; null for narration. */
  speaker: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collapse runs of whitespace (including newlines) to a single space and trim. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Split `text` into an ordered sequence of narration and dialogue lines.
 *
 * Narration lines surround/separate quoted spans and carry speaker:null.
 * Dialogue lines contain the spoken text (quotes stripped) and the attributed
 * speaker (or null when unknown). The verb phrase used for attribution is
 * preserved in the surrounding narration.
 *
 * @param text          - Raw prose to split.
 * @param knownSpeakers - Optional list of known speaker names forwarded to
 *                        attributeDialogue for disambiguation.
 */
export function separateScript(text: string, knownSpeakers?: string[]): ScriptLine[] {
  const result = attributeDialogue(text, knownSpeakers);
  const lines: ScriptLine[] = [];
  let cursor = 0;

  for (const span of result.spans) {
    // Narration BEFORE this quote.
    if (span.start > cursor) {
      const narration = collapse(text.slice(cursor, span.start));
      if (narration.length > 0) {
        lines.push({ kind: 'narration', text: narration, speaker: null });
      }
    }

    // Dialogue line.
    lines.push({ kind: 'dialogue', text: span.text, speaker: span.speaker });

    cursor = span.end;
  }

  // Narration AFTER the last quote.
  if (cursor < text.length) {
    const narration = collapse(text.slice(cursor));
    if (narration.length > 0) {
      lines.push({ kind: 'narration', text: narration, speaker: null });
    }
  }

  return lines;
}
