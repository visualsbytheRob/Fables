/**
 * Story-Gen — turns spaced-repetition cards into a playable Fable Forge story
 * (Epic 18, F1731/F1732/F1733).
 *
 * Pure module — no I/O.
 */

// ---------------------------------------------------------------------------
// FSRS constants (mirrors fsrs.ts — not re-imported to keep this self-contained)
// ---------------------------------------------------------------------------

const DECAY = -0.5;
const FACTOR = 19 / 81;

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface ReviewCardInput {
  id: string;
  prompt: string;
  answer: string;
  /** FSRS stability in days (null for new cards). */
  stability?: number | null | undefined;
  /** ISO of last review (null for new). */
  lastReview?: string | null | undefined;
}

export interface GeneratedStory {
  /** Compilable Fable Forge source. */
  source: string;
  /** knot name to card id, so the player can map a quiz knot back to its card. */
  knotToCard: Record<string, string>;
}

export interface StoryGenOptions {
  title?: string | undefined;
  /** Frame flavor text for the intro knot. */
  intro?: string | undefined;
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitize arbitrary user text so it cannot break Forge parsing.
 * - Collapses newlines/whitespace to single spaces.
 * - Strips `->` (divert arrows).
 * - Removes leading Forge markers: `=`, `#`, `+`, `*`, `-`.
 * - Replaces `[`, `]`, `{`, `}` with parentheses or spaces.
 * - Falls back to "(no text)" when the result is empty.
 */
function sanitize(text: string): string {
  let s = text;
  // Collapse whitespace (including newlines) first.
  s = s.replace(/\s+/g, ' ').trim();
  // Strip divert arrows.
  s = s.replace(/->/g, '');
  // Strip leading structural markers (may appear after earlier replacements expose them).
  s = s.replace(/^[=#+*-]+\s*/g, '');
  // Replace bracket characters with parens / spaces.
  s = s.replace(/\[/g, '(').replace(/\]/g, ')');
  s = s.replace(/\{/g, '(').replace(/\}/g, ')');
  // Clean up any double-spaces left over.
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s.length > 0 ? s : '(no text)';
}

// ---------------------------------------------------------------------------
// generateReviewStory (F1731 / F1732)
// ---------------------------------------------------------------------------

/**
 * Generate a compilable Fable Forge story that presents spaced-repetition
 * cards as a quiz-style fable. Each card becomes a quiz knot (tagged #quiz)
 * followed by a reveal knot. The returned `knotToCard` map links each quiz
 * knot name back to its card id.
 */
export function generateReviewStory(
  cards: ReviewCardInput[],
  opts?: StoryGenOptions,
): GeneratedStory {
  const title = opts?.title ?? 'Review Session';
  const intro = opts?.intro ?? 'A new fable begins. Let your memory be your guide.';

  const lines: string[] = [];
  const knotToCard: Record<string, string> = {};

  // ---- intro knot ----
  lines.push('=== review_intro ===');
  lines.push(`# title: ${sanitize(title)}`);
  lines.push(sanitize(intro));
  if (cards.length === 0) {
    lines.push('-> review_done');
  } else {
    lines.push('-> card_0');
  }
  lines.push('');

  // ---- card knots ----
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]!;
    const quizKnot = `card_${i}`;
    const revealKnot = `card_${i}_reveal`;
    const nextTarget = i < cards.length - 1 ? `card_${i + 1}` : 'review_done';

    knotToCard[quizKnot] = card.id;

    // Quiz knot
    lines.push(`=== ${quizKnot} ===`);
    lines.push('# quiz');
    lines.push(sanitize(card.prompt));
    lines.push(`+ [Recall the answer] -> ${revealKnot}`);
    lines.push('');

    // Reveal knot
    lines.push(`=== ${revealKnot} ===`);
    lines.push(sanitize(card.answer));
    lines.push(`-> ${nextTarget}`);
    lines.push('');
  }

  // ---- done knot ----
  lines.push('=== review_done ===');
  lines.push('The fable ends. Your memories grow stronger with each telling.');
  lines.push('-> END');
  lines.push('');

  return { source: lines.join('\n'), knotToCard };
}

// ---------------------------------------------------------------------------
// cardRetrievability (F1733)
// ---------------------------------------------------------------------------

/**
 * Current FSRS retrievability for a card (0..1).
 * Returns 0 for new or never-reviewed cards.
 * Uses the same forgetting-curve formula as fsrs.ts: R = (1 + FACTOR * t/S)^DECAY.
 */
export function cardRetrievability(card: ReviewCardInput, now?: string): number {
  const stability = card.stability ?? null;
  const lastReview = card.lastReview ?? null;
  if (stability === null || lastReview === null) return 0;

  const nowMs = now !== undefined ? new Date(now).getTime() : Date.now();
  const reviewMs = new Date(lastReview).getTime();
  const elapsedDays = Math.max(0, (nowMs - reviewMs) / 86_400_000);

  return Math.pow(1 + (FACTOR * elapsedDays) / stability, DECAY);
}

// ---------------------------------------------------------------------------
// masteryGate (F1733)
// ---------------------------------------------------------------------------

/**
 * Returns true when every card's current retrievability is >= threshold and
 * there is at least one card. New/unseen cards count as not-yet-mastered.
 */
export function masteryGate(cards: ReviewCardInput[], threshold: number, now?: string): boolean {
  if (cards.length === 0) return false;
  return cards.every((card) => cardRetrievability(card, now) >= threshold);
}
