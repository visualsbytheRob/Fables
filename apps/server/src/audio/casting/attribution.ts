/**
 * Dialogue attribution (F1612).
 *
 * Detects quoted dialogue in prose and attributes each quote to a speaker.
 * Supports straight double quotes ("...") and Unicode curly quotes (“...”).
 *
 * Attribution patterns detected (case-insensitive on the verb):
 *   After the close-quote: `"..." said Alice` / `"...," Alice said`
 *   Before the open-quote: `Alice said, "..."` / `Then Alice asked: "..."`
 *
 * Recognised attribution verbs:
 *   said, asked, replied, whispered, shouted, murmured, cried, answered,
 *   called, muttered, exclaimed, continued, added, began
 *
 * Speaker names: a run of Capitalized words (e.g. "Mira Vale"), or a
 * "the <word>" phrase (e.g. "the goblin"). Trailing punctuation is stripped.
 *
 * If `knownSpeakers` is supplied, matching is first attempted against that
 * list (case-insensitive), then falls back to the capitalised-word heuristic.
 *
 * Pure module — no I/O.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DialogueSpan {
  /** The spoken text, quotes stripped, whitespace collapsed. */
  text: string;
  /** Attributed speaker name as it appears in the prose, or null if unknown. */
  speaker: string | null;
  /** Character offsets of the quoted span (including quote marks) in the source. */
  start: number;
  end: number;
}

export interface AttributionResult {
  spans: DialogueSpan[];
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const OPEN_STRAIGHT = '"';
const CLOSE_STRAIGHT = '"';
const OPEN_CURLY = '“';
const CLOSE_CURLY = '”';

const VERBS =
  'said|asked|replied|whispered|shouted|murmured|cried|answered|called|muttered|exclaimed|continued|added|began';

/**
 * Pattern matching an attribution verb phrase that follows a close-quote.
 * Capture groups:
 *   1 — optional comma/punctuation before the verb phrase
 *   2 — optional "the " prefix for the speaker
 *   3 — speaker name (Capitalised words or lowercase after "the ")
 *   4 — the verb (when speaker comes before the verb)
 * OR
 *   1 — punctuation
 *   verb comes first, then speaker
 */
// After-quote pattern: optional comma/punct, then either:
//   verb + speaker  ("…," said Alice)
//   speaker + verb  ("…," Alice said)
const AFTER_VERB_RE = new RegExp(
  `^[,\\s]*` + // optional comma + whitespace
    `(?:` +
    // option A: verb THEN speaker
    `(?:${VERBS})\\s+` + // verb
    `(the\\s+[a-z][a-z\\s]*[a-z]|[A-Z][a-zA-Z]*(?:\\s+[A-Z][a-zA-Z]*)*)` + // speaker A
    `|` +
    // option B: speaker THEN verb
    `(the\\s+[a-z][a-z\\s]*[a-z]|[A-Z][a-zA-Z]*(?:\\s+[A-Z][a-zA-Z]*)*)` + // speaker B
    `\\s+(?:${VERBS})` + // verb
    `)`,
  'i',
);

// Finds the verb at the tail of the before-fragment, returning the index of the
// last non-whitespace/punct character before the verb so we can scan backwards
// for the speaker.
const BEFORE_VERB_ONLY_RE = new RegExp(
  `\\b(?:${VERBS})\\b` + // the verb
    `[,:\\s]*$`, // optional trailing punctuation/whitespace
  'i',
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collapse runs of whitespace (including newlines) to a single space and trim. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Strip trailing punctuation from a speaker name. */
function stripTrailingPunct(s: string): string {
  return s.replace(/[.,!?;:'"]+$/, '').trim();
}

/**
 * Try to match a speaker name in `fragment` using the known-speakers list
 * (case-insensitive), returning the canonical form from the list.
 */
function matchKnown(fragment: string, knownSpeakers: string[]): string | null {
  const lower = fragment.toLowerCase();
  for (const known of knownSpeakers) {
    if (lower.includes(known.toLowerCase())) {
      return known;
    }
  }
  return null;
}

/**
 * Extract a speaker from a fragment that comes AFTER the close-quote.
 * Uses AFTER_VERB_RE which handles "said Alice" and "Alice said".
 */
function extractSpeakerAfter(fragment: string, knownSpeakers: string[]): string | null {
  if (knownSpeakers.length > 0) {
    const known = matchKnown(fragment, knownSpeakers);
    if (known !== null) return known;
  }
  const m = AFTER_VERB_RE.exec(fragment);
  if (m !== null) {
    const raw = m[1] ?? m[2];
    if (raw !== undefined && raw.length > 0) {
      return stripTrailingPunct(collapse(raw));
    }
  }
  return null;
}

/**
 * Extract a speaker from a fragment that comes BEFORE the open-quote.
 *
 * Strategy: locate the attribution verb near the end of the fragment, then
 * scan backwards for the speaker — this avoids greedy capture of leading
 * sentence-adverbs (e.g. "Then" in "Then Alice asked:").
 *
 * Speaker candidates (immediately before the verb):
 *   - A run of one or more TitleCase words:  "Alice", "Mira Vale"
 *   - A "the <lowercase-words>" phrase:       "the goblin", "the old wizard"
 */
function extractSpeakerBefore(fragment: string, knownSpeakers: string[]): string | null {
  if (knownSpeakers.length > 0) {
    const known = matchKnown(fragment, knownSpeakers);
    if (known !== null) return known;
  }
  // Find the verb near the tail of the before-fragment.
  const verbMatch = BEFORE_VERB_ONLY_RE.exec(fragment);
  if (verbMatch === null) return null;

  // Text to the left of the verb.
  const beforeVerb = fragment.slice(0, verbMatch.index).trimEnd();

  // Try "the <lowercase words>" first (e.g. "the old wizard").
  const theMatch = /(?:^|\s)(the\s+[a-z][a-z\s]*[a-z])\s*$/.exec(beforeVerb);
  if (theMatch !== null && theMatch[1] !== undefined) {
    return stripTrailingPunct(collapse(theMatch[1]));
  }

  // Extract the last run of TitleCase words (words starting with a capital letter)
  // immediately before the verb. Scan backwards: collect consecutive TitleCase
  // tokens, but stop as soon as the token just before the collected run is also
  // TitleCase (indicating sentence-initial capitalization, e.g. "Then Alice" →
  // stop at "Alice" because "Then" is also TitleCase and appears to be a
  // sentence-starting adverb). Concretely: trim the collected run so it starts
  // right after the last lowercase word or punctuation.
  const words = beforeVerb.split(/\s+/).filter((w) => w.length > 0);
  // Collect TitleCase words from the right.
  const nameEnd = words.length;
  let nameStart = nameEnd;
  for (let k = nameEnd - 1; k >= 0; k--) {
    const w = words[k]!;
    if (/^[A-Z]/.test(w)) {
      nameStart = k;
    } else {
      break; // hit a lowercase word — speaker ends here
    }
  }
  // If the collected run starts at index 0 AND there's more than one word in it,
  // check if the word just before the sequence (if any) in the ORIGINAL fragment
  // context is lowercase. If the run starts at 0, it might contain a sentence-
  // initial adverb like "Then". In that case: take only the LAST single word
  // (the name immediately adjacent to the verb) unless all words are likely names.
  //
  // Heuristic: if nameStart === 0 and there are multiple words in the run and
  // there's no lowercase context before them in the fragment, keep only the
  // last word in the run as the speaker (closest to the verb).
  const nameWords = words.slice(nameStart, nameEnd);
  if (nameWords.length === 0) return null;

  if (nameStart === 0 && nameWords.length > 1) {
    // Check if there's any lowercase word before the sequence in the fragment.
    // If not, we likely have a sentence-initial cap followed by a proper name.
    // Keep only the last word(s) that are actual proper names by trimming the
    // leading word if it looks like a common sentence-starter.
    // Common single-word sentence starters that are capitalized but not names:
    const ADVERBS = new Set([
      'then',
      'when',
      'after',
      'before',
      'but',
      'and',
      'so',
      'yet',
      'nor',
      'while',
      'since',
      'though',
      'although',
      'however',
      'therefore',
      'thus',
      'now',
      'next',
      'suddenly',
      'finally',
      'meanwhile',
      'here',
      'there',
      'still',
      'just',
      'always',
      'never',
      'once',
      'soon',
      'already',
    ]);
    // Trim leading words that are in the adverb list.
    let start = 0;
    while (start < nameWords.length - 1) {
      const w = nameWords[start]!.toLowerCase().replace(/[^a-z]/g, '');
      if (ADVERBS.has(w)) {
        start++;
      } else {
        break;
      }
    }
    const trimmed = nameWords.slice(start);
    if (trimmed.length === 0) return null;
    return stripTrailingPunct(collapse(trimmed.join(' ')));
  }

  return stripTrailingPunct(collapse(nameWords.join(' ')));
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Detect quoted dialogue spans in `text` and attribute each to a speaker.
 *
 * @param text          - Raw prose to analyse.
 * @param knownSpeakers - Optional list of character names to prefer when
 *                        attributing. Case-insensitive.
 */
export function attributeDialogue(text: string, knownSpeakers: string[] = []): AttributionResult {
  const spans: DialogueSpan[] = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i]!;

    // Detect the open-quote character.
    let closeChar: string;
    if (ch === OPEN_STRAIGHT) {
      closeChar = CLOSE_STRAIGHT;
    } else if (ch === OPEN_CURLY) {
      closeChar = CLOSE_CURLY;
    } else {
      i++;
      continue;
    }

    const openIdx = i;
    // Find matching close-quote (not the same position).
    const closeIdx = text.indexOf(closeChar, openIdx + 1);
    if (closeIdx === -1) {
      // Unmatched open-quote — skip.
      i++;
      continue;
    }

    const inner = text.slice(openIdx + 1, closeIdx);
    const spokenText = collapse(inner);

    // --- Try attribution from text AFTER the close-quote ---
    const afterFragment = text.slice(closeIdx + 1, closeIdx + 60);
    let speaker = extractSpeakerAfter(afterFragment, knownSpeakers);

    // --- Fallback: try text BEFORE the open-quote ---
    if (speaker === null) {
      const beforeFragment = text.slice(Math.max(0, openIdx - 80), openIdx);
      speaker = extractSpeakerBefore(beforeFragment, knownSpeakers);
    }

    spans.push({ text: spokenText, speaker, start: openIdx, end: closeIdx + 1 });
    // Advance past the closing quote.
    i = closeIdx + 1;
  }

  return { spans };
}
