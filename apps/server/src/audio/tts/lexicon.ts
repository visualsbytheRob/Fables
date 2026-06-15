/**
 * Pronunciation lexicon (F1605).
 *
 * Allows authors to map names and invented words to phonetic respellings so
 * that a TTS engine pronounces them correctly.
 *
 * Format accepted by parseLexicon:
 *   word or phrase: Respelling     # one entry per line
 *   # comment lines and blank lines are ignored
 *
 * Replacement rules applied by applyLexicon:
 *   - Keys are matched case-insensitively on whole-word boundaries.
 *   - Longer keys take precedence over shorter ones (greedy longest-match).
 *   - The respelling is emitted verbatim (original casing preserved).
 *   - Surrounding punctuation and spacing are preserved.
 *
 * Pure module — no I/O.
 */

/** Lowercased word/phrase → respelling string. */
export type Lexicon = Map<string, string>;

// ---------------------------------------------------------------------------
// parseLexicon
// ---------------------------------------------------------------------------

/**
 * Parse a lexicon definition string into a Map.
 *
 * Each non-blank, non-comment line must have the form:
 *   <key>: <respelling>
 *
 * Keys are stored lowercased and trimmed. Respellings are trimmed but keep
 * their original casing. Lines without a colon separator are silently ignored.
 *
 * @param text - Multi-line lexicon definition.
 */
export function parseLexicon(text: string): Lexicon {
  const lex: Lexicon = new Map();

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    // Skip blank lines and comment lines.
    if (line.length === 0 || line.startsWith('#')) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue; // malformed — skip gracefully

    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const respelling = line.slice(colonIdx + 1).trim();

    if (key.length > 0 && respelling.length > 0) {
      lex.set(key, respelling);
    }
  }

  return lex;
}

// ---------------------------------------------------------------------------
// applyLexicon
// ---------------------------------------------------------------------------

/**
 * Escape a string so it can be used verbatim inside a RegExp source.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a single RegExp that matches all lexicon keys (sorted longest-first so
 * that multi-word entries win over their sub-phrases). Each key is wrapped in
 * word-boundary assertions that work for multi-word phrases too.
 *
 * For a phrase like "Mira Vale" the regex is:
 *   (?<![a-zA-Z])mira vale(?![a-zA-Z])   (case-insensitive)
 *
 * We use manual character-class boundaries instead of \b so that the boundary
 * sits at the letter-edge even for phrases containing spaces.
 */
function buildPattern(lex: Lexicon): RegExp | null {
  if (lex.size === 0) return null;

  // Sort keys by descending length so alternation prefers longer matches.
  const keys = [...lex.keys()].sort((a, b) => b.length - a.length);

  const alts = keys.map((k) => {
    // For a phrase boundary: no alpha char immediately before/after the phrase.
    // We use a negative lookbehind/lookahead for [a-zA-Z] characters.
    return `(?<![a-zA-Z])${escapeRegExp(k)}(?![a-zA-Z])`;
  });

  return new RegExp(alts.join('|'), 'gi');
}

/**
 * Replace all whole-word occurrences of lexicon keys in `text` with their
 * respellings. Longer keys take precedence. Matching is case-insensitive;
 * respellings are emitted verbatim.
 *
 * @param text    - Input text to process.
 * @param lex     - Lexicon produced by parseLexicon.
 * @returns       The text with all recognised keys replaced.
 */
export function applyLexicon(text: string, lex: Lexicon): string {
  const pattern = buildPattern(lex);
  if (pattern === null) return text;

  return text.replace(pattern, (matched) => {
    const key = matched.toLowerCase();
    return lex.get(key) ?? matched;
  });
}
