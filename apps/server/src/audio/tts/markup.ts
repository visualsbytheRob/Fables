/**
 * Speech markup parser (F1606).
 *
 * Parses a small SSML-ish inline markup subset into a flat list of
 * SpeechSegments that a synthesis engine can consume directly.
 *
 * Supported syntax:
 *   [pause]          → 500 ms pause attached to the preceding segment (or a
 *                      standalone empty segment when there is no preceding one).
 *   [pause 800]      → 800 ms pause (same attachment rule).
 *   [pause 800ms]    → same.
 *   *emphasized*     → segment with emphasis: true (asterisks stripped).
 *   {rate:slow} … {/rate}  → segments inside carry that rate value.
 *   plain text       → one or more plain segments; whitespace is collapsed.
 *
 * Pause attachment: [pause] / [pause N] attaches pauseAfterMs to the
 * immediately preceding segment in the output array. If no previous segment
 * exists yet, a standalone empty segment is emitted. This keeps the segment
 * count minimal for callers that iterate and speak each entry in turn.
 *
 * Pure module — no I/O.
 */

export type Rate = 'x-slow' | 'slow' | 'normal' | 'fast' | 'x-fast';

export interface SpeechSegment {
  text: string;
  emphasis?: boolean;
  rate?: Rate;
  pauseAfterMs?: number;
}

// ---------------------------------------------------------------------------
// Internal token types produced by the tokeniser.
// ---------------------------------------------------------------------------

type TokText = { kind: 'text'; value: string };
type TokPause = { kind: 'pause'; ms: number };
type TokEmph = { kind: 'emph'; text: string };
type TokRateOpen = { kind: 'rate-open'; rate: Rate };
type TokRateClose = { kind: 'rate-close' };
type Token = TokText | TokPause | TokEmph | TokRateOpen | TokRateClose;

const VALID_RATES = new Set<string>(['x-slow', 'slow', 'normal', 'fast', 'x-fast']);

function isRate(s: string): s is Rate {
  return VALID_RATES.has(s);
}

/**
 * Tokenise `input` into a flat array of typed tokens. We consume left-to-right
 * with a manual cursor so we can skip over matched spans.
 */
function tokenise(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  // Accumulate plain-text characters until we hit a special construct.
  let textBuf = '';

  const flushText = (): void => {
    if (textBuf.length > 0) {
      tokens.push({ kind: 'text', value: textBuf });
      textBuf = '';
    }
  };

  while (i < input.length) {
    // [pause] or [pause N] or [pause Nms]
    if (input[i] === '[') {
      const closeBracket = input.indexOf(']', i);
      if (closeBracket !== -1) {
        const inner = input.slice(i + 1, closeBracket).trim();
        const pauseMatch = /^pause(?:\s+(\d+)(?:ms)?)?$/i.exec(inner);
        if (pauseMatch) {
          flushText();
          const ms = pauseMatch[1] !== undefined ? parseInt(pauseMatch[1]!, 10) : 500;
          tokens.push({ kind: 'pause', ms });
          i = closeBracket + 1;
          continue;
        }
      }
      // Not a recognized [..] construct — treat [ as plain text.
      textBuf += input[i]!;
      i++;
      continue;
    }

    // {rate:VALUE}
    if (input[i] === '{') {
      const closeBrace = input.indexOf('}', i);
      if (closeBrace !== -1) {
        const inner = input.slice(i + 1, closeBrace).trim();
        // Close tag: {/rate}
        if (inner === '/rate') {
          flushText();
          tokens.push({ kind: 'rate-close' });
          i = closeBrace + 1;
          continue;
        }
        // Open tag: {rate:VALUE}
        const rateMatch = /^rate:([a-z-]+)$/.exec(inner);
        if (rateMatch && isRate(rateMatch[1]!)) {
          flushText();
          tokens.push({ kind: 'rate-open', rate: rateMatch[1]! as Rate });
          i = closeBrace + 1;
          continue;
        }
      }
      // Not recognized — treat { as plain text.
      textBuf += input[i]!;
      i++;
      continue;
    }

    // *emphasized* — look for closing * (must have at least one char inside)
    if (input[i] === '*') {
      const closeAsterisk = input.indexOf('*', i + 1);
      if (closeAsterisk !== -1 && closeAsterisk > i + 1) {
        const inner = input.slice(i + 1, closeAsterisk);
        flushText();
        tokens.push({ kind: 'emph', text: inner });
        i = closeAsterisk + 1;
        continue;
      }
      // Unmatched * — treat as plain text.
      textBuf += input[i]!;
      i++;
      continue;
    }

    textBuf += input[i]!;
    i++;
  }

  flushText();
  return tokens;
}

/** Collapse runs of whitespace (including newlines) to a single space and trim. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Parse speech markup into a flat array of SpeechSegments.
 *
 * @param input - Raw markup string.
 * @returns Ordered array of segments; empty segments (text === '') are only
 *   emitted when a [pause] has no preceding segment to attach to.
 */
export function parseSpeechMarkup(input: string): SpeechSegment[] {
  const tokens = tokenise(input);
  const segments: SpeechSegment[] = [];
  let currentRate: Rate | undefined;

  const pushSegment = (seg: SpeechSegment): void => {
    segments.push(seg);
  };

  for (const tok of tokens) {
    if (tok.kind === 'text') {
      const text = collapse(tok.value);
      if (text.length === 0) continue;
      const seg: SpeechSegment = { text };
      if (currentRate !== undefined) {
        seg.rate = currentRate;
      }
      pushSegment(seg);
    } else if (tok.kind === 'emph') {
      const text = collapse(tok.text);
      if (text.length === 0) continue;
      const seg: SpeechSegment = { text, emphasis: true };
      if (currentRate !== undefined) {
        seg.rate = currentRate;
      }
      pushSegment(seg);
    } else if (tok.kind === 'rate-open') {
      currentRate = tok.rate;
    } else if (tok.kind === 'rate-close') {
      currentRate = undefined;
    } else if (tok.kind === 'pause') {
      // Attach to previous segment if one exists, otherwise emit standalone.
      const prev = segments[segments.length - 1];
      if (prev !== undefined) {
        // Accumulate multiple pauses: sum them.
        prev.pauseAfterMs = (prev.pauseAfterMs ?? 0) + tok.ms;
      } else {
        pushSegment({ text: '', pauseAfterMs: tok.ms });
      }
    }
  }

  return segments;
}

/**
 * Concatenate the text of all segments, separated by a single space.
 * Useful as a plain-text fallback when speech synthesis is unavailable.
 * Segments with empty text (pause-only) are skipped.
 */
export function segmentsToPlainText(segs: SpeechSegment[]): string {
  return segs
    .map((s) => s.text)
    .filter((t) => t.length > 0)
    .join(' ');
}
