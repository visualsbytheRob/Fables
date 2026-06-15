/**
 * Flashcard extraction from markdown note bodies (Epic 18, F1711–F1715).
 *
 * Extracts candidate flashcards using three strategies:
 *   - Anki-style cloze deletions: {{c1::hidden}} / {{c1::hidden::hint}}
 *   - Explicit Q&A blocks: consecutive lines beginning with Q: / A:
 *   - Heuristic suggestions: definition lines and lists under headings
 *
 * Pure module — no I/O. All functions are referentially transparent.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ExtractedKind = 'cloze' | 'qa' | 'definition' | 'list';

export interface ExtractedCard {
  /** Card kind. */
  kind: ExtractedKind;
  /** Card front. */
  prompt: string;
  /** Card back. */
  answer: string;
  /** A stable key within the note (for dedup + live-link reconciliation). */
  blockRef: string;
}

// ---------------------------------------------------------------------------
// extractCloze — F1711 + F1715
// ---------------------------------------------------------------------------

/**
 * Match a single cloze token: {{cN::answer}} or {{cN::answer::hint}}
 * Capture groups:
 *   1 — cloze index (digits after "c")
 *   2 — answer text
 *   3 — hint text (may be undefined)
 */
const CLOZE_RE = /\{\{c(\d+)::([^}:][^}]*?)(?:::([^}]*))?\}\}/g;

/** Strip all cloze markup, leaving plain answer text. */
function stripCloze(text: string): string {
  return text.replace(CLOZE_RE, (_m, _idx, answer: string) => answer);
}

/**
 * Extract cloze cards from `text` (F1711 + F1715 multi-cloze).
 *
 * For each distinct cloze index cN found in the text, one card is produced:
 *   - prompt: cN deletions shown as [...] (or [hint]), other indices revealed.
 *   - answer: all cloze markup stripped (full revealed text).
 *   - blockRef: "cloze:cN"
 *
 * Cards are returned in ascending index order.
 */
export function extractCloze(text: string): ExtractedCard[] {
  // First pass: collect all distinct cloze indices.
  const indices = new Set<number>();
  let m: RegExpExecArray | null;
  // Reset lastIndex before each scan.
  CLOZE_RE.lastIndex = 0;
  while ((m = CLOZE_RE.exec(text)) !== null) {
    indices.add(Number(m[1]));
  }

  if (indices.size === 0) return [];

  const answer = stripCloze(text);
  const sorted = [...indices].sort((a, b) => a - b);

  return sorted.map((targetIdx) => {
    // Build prompt: for targetIdx, replace with [...] or [hint].
    // For other indices, reveal the plain answer text.
    CLOZE_RE.lastIndex = 0;
    const prompt = text.replace(
      CLOZE_RE,
      (_match, idxStr: string, answerText: string, hint: string | undefined) => {
        const idx = Number(idxStr);
        if (idx === targetIdx) {
          return hint !== undefined && hint.length > 0 ? `[${hint}]` : '[...]';
        }
        return answerText;
      },
    );
    return {
      kind: 'cloze' as const,
      prompt,
      answer,
      blockRef: `cloze:c${targetIdx}`,
    };
  });
}

// ---------------------------------------------------------------------------
// extractQA — F1712
// ---------------------------------------------------------------------------

/**
 * Extract explicit Q&A pairs from `text`.
 *
 * Recognises consecutive lines:
 *   Q: <question>
 *   A: <answer (may span multiple lines until next Q: or blank line)>
 *
 * Case-insensitive on the Q:/A: prefix. Returns one card per pair with
 * blockRef "qa:N" (0-based).
 */
export function extractQA(text: string): ExtractedCard[] {
  const lines = text.split('\n');
  const cards: ExtractedCard[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const qMatch = /^q:\s*(.+)/i.exec(line);
    if (qMatch === null) {
      i++;
      continue;
    }
    const question = qMatch[1]!.trim();
    i++;

    // Collect the A: line(s).
    const answerLines: string[] = [];
    // Skip blank lines between Q and A.
    while (i < lines.length && lines[i]!.trim() === '') {
      i++;
    }
    // Expect an A: line.
    if (i < lines.length) {
      const aMatch = /^a:\s*(.*)/i.exec(lines[i]!);
      if (aMatch !== null) {
        const firstLine = aMatch[1]!;
        if (firstLine.trim().length > 0) answerLines.push(firstLine.trim());
        i++;
        // Collect continuation lines until next Q: or blank line.
        while (i < lines.length) {
          const cont = lines[i]!;
          if (cont.trim() === '') break;
          if (/^q:/i.test(cont)) break;
          if (/^a:/i.test(cont)) break;
          answerLines.push(cont.trim());
          i++;
        }
      }
    }

    if (answerLines.length === 0) continue;

    cards.push({
      kind: 'qa',
      prompt: question,
      answer: answerLines.join(' '),
      blockRef: `qa:${cards.length}`,
    });
  }

  return cards;
}

// ---------------------------------------------------------------------------
// suggestCards — F1713
// ---------------------------------------------------------------------------

/** Word count in a string (whitespace-delimited). */
function wordCount(s: string): number {
  return s
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

/**
 * Suggest flashcards heuristically from definition lines and lists under headings.
 *
 * Definition patterns (Term 1-6 words, non-empty definition):
 *   Term: definition
 *   Term — definition  (em dash)
 *   Term - definition  (hyphen with surrounding spaces)
 *
 * List-under-heading: a markdown heading (# / ##) immediately followed (in the
 * same paragraph block) by 2+ bullet items (- or *). Produces one card per heading.
 *
 * Skips cloze lines, Q:/A: lines, and lines with empty definitions.
 */
export function suggestCards(text: string): ExtractedCard[] {
  const lines = text.split('\n');
  const cards: ExtractedCard[] = [];

  // Definition pattern: term separator definition
  // Separators: ": " | " — " | " - "
  // We build the regex carefully to avoid braces in literals.
  const DEF_COLON_RE = /^([^:]+?):\s+(.+)$/;
  const DEF_EMDASH_RE = /^(.+?)\s+—\s+(.+)$/;
  const DEF_HYPHEN_RE = /^(.+?)\s+-\s+(.+)$/;

  // Heading line
  const HEADING_RE = /^#{1,2}\s+(.+)/;
  // Bullet line
  const BULLET_RE = /^[-*]\s+(.+)/;
  // Cloze line (contains cloze markup)
  const HAS_CLOZE_RE = /\{\{c\d+::/;
  // Q: or A: line
  const QA_RE = /^[qa]:/i;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const lineNum = i + 1; // 1-based for blockRef
    i++;

    // --- List-under-heading ---
    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch !== null) {
      const headingText = headingMatch[1]!.trim();
      const bulletItems: string[] = [];
      // Collect consecutive bullet lines (skip blank lines between them).
      let j = i;
      while (j < lines.length) {
        const bLine = lines[j]!;
        if (bLine.trim() === '') {
          j++;
          continue;
        }
        const bMatch = BULLET_RE.exec(bLine);
        if (bMatch !== null) {
          bulletItems.push(bMatch[1]!.trim());
          j++;
        } else {
          break;
        }
      }
      if (bulletItems.length >= 2) {
        cards.push({
          kind: 'list',
          prompt: `List the items under "${headingText}"`,
          answer: bulletItems.join(', '),
          blockRef: `list:${lineNum}`,
        });
        i = j;
        continue;
      }
      // Fall through to check the heading line itself for definition patterns
      // (unlikely, but let definition logic handle non-heading content).
      continue;
    }

    // Skip cloze lines and Q:/A: lines.
    if (HAS_CLOZE_RE.test(line)) continue;
    if (QA_RE.test(line)) continue;
    // Skip markdown structural lines (bullets, headings already handled).
    if (/^[-*]\s/.test(line)) continue;

    // --- Definition lines ---
    const tryDef = (termRaw: string, defRaw: string): void => {
      const term = termRaw.trim();
      const def = defRaw.trim();
      if (def.length === 0) return;
      if (wordCount(term) < 1 || wordCount(term) > 6) return;
      cards.push({
        kind: 'definition',
        prompt: term,
        answer: def,
        blockRef: `def:${lineNum}`,
      });
    };

    const colonMatch = DEF_COLON_RE.exec(line);
    if (colonMatch !== null) {
      // Skip if term looks like Q or A (already handled above, but double-check).
      const term = colonMatch[1]!.trim();
      if (/^[qa]$/i.test(term)) {
        continue;
      }
      tryDef(colonMatch[1]!, colonMatch[2]!);
      continue;
    }

    const emDashMatch = DEF_EMDASH_RE.exec(line);
    if (emDashMatch !== null) {
      tryDef(emDashMatch[1]!, emDashMatch[2]!);
      continue;
    }

    const hyphenMatch = DEF_HYPHEN_RE.exec(line);
    if (hyphenMatch !== null) {
      tryDef(hyphenMatch[1]!, hyphenMatch[2]!);
      continue;
    }
  }

  return cards;
}

// ---------------------------------------------------------------------------
// extractCards — combine + dedup
// ---------------------------------------------------------------------------

/**
 * Extract all flashcard candidates from `text`.
 *
 * Returns cloze cards, then Q&A cards, then suggestions. Deduplicates by
 * blockRef (first occurrence wins). Order within each group is preserved.
 */
export function extractCards(text: string): ExtractedCard[] {
  const all = [...extractCloze(text), ...extractQA(text), ...suggestCards(text)];
  const seen = new Set<string>();
  const result: ExtractedCard[] = [];
  for (const card of all) {
    if (!seen.has(card.blockRef)) {
      seen.add(card.blockRef);
      result.push(card);
    }
  }
  return result;
}
