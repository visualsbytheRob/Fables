/**
 * Read-along alignment model (Epic 17, F1642 timestamps, F1647 fallback, F1646
 * notes-too).
 *
 * Maps a passage of text to per-word and per-sentence time ranges so the player
 * (web layer) can highlight, auto-scroll, and tap-to-seek during narration. Two
 * sources of truth:
 *
 *   - Engine word boundaries (F1642): when a TTS engine reports when each word
 *     starts, we use them directly via `alignmentFromBoundaries`.
 *   - Proportional fallback (F1647): when it doesn't, `estimateAlignment` spreads
 *     the known total duration across words weighted by length, so highlighting
 *     still tracks reasonably.
 *
 * Pure module — works for any text, story or plain note (F1646). No I/O.
 */

export interface WordTiming {
  word: string;
  /** Index into the word stream. */
  index: number;
  /** Character offset of the word in the source text (for tap-to-jump). */
  charStart: number;
  charEnd: number;
  startMs: number;
  endMs: number;
}

export interface SentenceTiming {
  text: string;
  startMs: number;
  endMs: number;
  /** Inclusive word-index range covered by this sentence. */
  wordStart: number;
  wordEnd: number;
}

export interface Alignment {
  words: WordTiming[];
  sentences: SentenceTiming[];
  totalMs: number;
}

interface RawWord {
  word: string;
  charStart: number;
  charEnd: number;
}

const WORD_RE = /\S+/g;

/** Split text into words, keeping each word's character span. */
export function tokenizeWords(text: string): RawWord[] {
  const out: RawWord[] = [];
  let m: RegExpExecArray | null;
  WORD_RE.lastIndex = 0;
  while ((m = WORD_RE.exec(text)) !== null) {
    out.push({ word: m[0], charStart: m.index, charEnd: m.index + m[0].length });
  }
  return out;
}

/** Relative spoken "cost" of a word — longer words take longer to say. */
function weight(word: string): number {
  // Letters drive duration; trailing sentence punctuation adds a small beat.
  const letters = word.replace(/[^A-Za-z0-9]/g, '').length;
  const pause = /[.!?,;:]$/.test(word) ? 2 : 0;
  return Math.max(1, letters) + pause;
}

/** Group word timings into sentences, splitting after . ! ? terminators. */
function buildSentences(text: string, words: WordTiming[]): SentenceTiming[] {
  const sentences: SentenceTiming[] = [];
  let start = 0;
  const flush = (end: number): void => {
    if (end < start) return;
    const first = words[start]!;
    const last = words[end]!;
    sentences.push({
      text: text.slice(first.charStart, last.charEnd),
      startMs: first.startMs,
      endMs: last.endMs,
      wordStart: start,
      wordEnd: end,
    });
    start = end + 1;
  };
  for (let i = 0; i < words.length; i++) {
    if (/[.!?]$/.test(words[i]!.word)) flush(i);
  }
  if (start < words.length) flush(words.length - 1);
  return sentences;
}

/**
 * Proportional fallback alignment (F1647): spread `totalMs` across the words of
 * `text`, weighting by word length so longer words get more time. Used whenever
 * real engine timestamps aren't available.
 */
export function estimateAlignment(text: string, totalMs: number): Alignment {
  const raw = tokenizeWords(text);
  if (raw.length === 0) return { words: [], sentences: [], totalMs: Math.max(0, totalMs) };
  const total = Math.max(0, totalMs);
  const weights = raw.map((r) => weight(r.word));
  const sum = weights.reduce((a, b) => a + b, 0);

  const words: WordTiming[] = [];
  let cursor = 0;
  for (let i = 0; i < raw.length; i++) {
    const share = (weights[i]! / sum) * total;
    const startMs = cursor;
    const endMs = i === raw.length - 1 ? total : cursor + share;
    words.push({
      word: raw[i]!.word,
      index: i,
      charStart: raw[i]!.charStart,
      charEnd: raw[i]!.charEnd,
      startMs: Math.round(startMs),
      endMs: Math.round(endMs),
    });
    cursor = endMs;
  }
  return { words, sentences: buildSentences(text, words), totalMs: total };
}

export interface WordBoundary {
  /** Word index this boundary refers to. */
  index: number;
  startMs: number;
  endMs: number;
}

/**
 * Alignment from engine-reported word boundaries (F1642). Boundaries are matched
 * to the tokenised words by index; any word without a boundary is interpolated
 * from its neighbours so the stream stays gap-free.
 */
export function alignmentFromBoundaries(text: string, boundaries: WordBoundary[]): Alignment {
  const raw = tokenizeWords(text);
  if (raw.length === 0) return { words: [], sentences: [], totalMs: 0 };

  const byIndex = new Map(boundaries.map((b) => [b.index, b]));
  const words: WordTiming[] = [];
  let lastEnd = 0;
  for (let i = 0; i < raw.length; i++) {
    const b = byIndex.get(i);
    const startMs = b ? b.startMs : lastEnd;
    const endMs = b ? b.endMs : startMs;
    words.push({
      word: raw[i]!.word,
      index: i,
      charStart: raw[i]!.charStart,
      charEnd: raw[i]!.charEnd,
      startMs: Math.round(startMs),
      endMs: Math.round(Math.max(endMs, startMs)),
    });
    lastEnd = words[i]!.endMs;
  }
  const totalMs = words.length > 0 ? words[words.length - 1]!.endMs : 0;
  return { words, sentences: buildSentences(text, words), totalMs };
}

/** Index of the word playing at `ms` (clamped); -1 for an empty alignment. */
export function wordAtTime(alignment: Alignment, ms: number): number {
  const { words } = alignment;
  if (words.length === 0) return -1;
  if (ms <= 0) return 0;
  if (ms >= alignment.totalMs) return words.length - 1;
  for (let i = 0; i < words.length; i++) {
    if (ms >= words[i]!.startMs && ms < words[i]!.endMs) return i;
  }
  return words.length - 1;
}

/** Start time of a word index (0 if out of range). */
export function timeOfWord(alignment: Alignment, index: number): number {
  const w = alignment.words[index];
  return w ? w.startMs : 0;
}
