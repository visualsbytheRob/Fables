/**
 * Scheduler edge-case helpers (Epic 18, F1761/F1762/F1765).
 *
 * Pure queue-quality transforms applied on top of the FSRS due queue:
 *   - sibling spacing: cards from the same source note shouldn't all land in one
 *     session (F1761);
 *   - duplicate detection: surface cards with the same prompt (F1762);
 *   - catch-up capping: after a long gap, cap how many cards re-enter rotation so
 *     the user doesn't face a demoralising pile (F1765).
 *
 * No I/O — these operate on plain card-like records.
 */

export interface QueueCard {
  id: string;
  noteId: string | null;
  prompt: string;
  state: string;
}

/** Normalise a prompt for duplicate comparison: lowercase, collapse whitespace. */
export function normalizePrompt(prompt: string): string {
  return prompt.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Space siblings (F1761): reorder so that cards sharing a noteId are separated by
 * at least one other card where possible. Stable: the relative order of the first
 * occurrence of each note is preserved; later siblings are interleaved after
 * other notes' cards. Cards with a null noteId are never considered siblings.
 */
export function spaceSiblings<T extends QueueCard>(cards: T[]): T[] {
  // Bucket by noteId (null → unique singleton buckets so they never group).
  const buckets = new Map<string, T[]>();
  const singles: T[] = [];
  for (const c of cards) {
    if (c.noteId === null) {
      singles.push(c);
      continue;
    }
    const list = buckets.get(c.noteId);
    if (list) list.push(c);
    else buckets.set(c.noteId, [c]);
  }
  // Round-robin across the note buckets so siblings spread out, then append the
  // note-less singles interleaved.
  const queues = [...buckets.values()];
  const out: T[] = [];
  let remaining = cards.length - singles.length;
  let si = 0;
  while (remaining > 0) {
    for (const q of queues) {
      const next = q.shift();
      if (next) {
        out.push(next);
        remaining--;
        // Drop in a single between siblings when available.
        if (si < singles.length) out.push(singles[si++]!);
      }
    }
  }
  while (si < singles.length) out.push(singles[si++]!);
  return out;
}

export interface DuplicateGroup {
  prompt: string;
  cardIds: string[];
}

/** Find cards sharing a normalised prompt (F1762). Only groups of 2+ returned. */
export function findDuplicates<T extends QueueCard>(cards: T[]): DuplicateGroup[] {
  const groups = new Map<string, { prompt: string; ids: string[] }>();
  for (const c of cards) {
    const key = normalizePrompt(c.prompt);
    const g = groups.get(key);
    if (g) g.ids.push(c.id);
    else groups.set(key, { prompt: c.prompt, ids: [c.id] });
  }
  return [...groups.values()]
    .filter((g) => g.ids.length > 1)
    .map((g) => ({ prompt: g.prompt, cardIds: g.ids }));
}

export interface CatchUpOptions {
  /** Max review cards to introduce this session (after a gap). */
  dueCap?: number;
  /** Max new cards to introduce this session. */
  newCap?: number;
}

/**
 * Catch-up cap (F1765): split a queue into a capped review portion + capped new
 * portion so a long absence doesn't dump everything at once. The rest is deferred
 * to later sessions. Review cards come first (they're more time-sensitive).
 */
export function applyCatchUp<T extends QueueCard>(
  cards: T[],
  opts: CatchUpOptions = {},
): { session: T[]; deferred: T[] } {
  const dueCap = opts.dueCap ?? Infinity;
  const newCap = opts.newCap ?? Infinity;
  const session: T[] = [];
  const deferred: T[] = [];
  let due = 0;
  let fresh = 0;
  for (const c of cards) {
    if (c.state === 'new') {
      if (fresh < newCap) {
        session.push(c);
        fresh++;
      } else deferred.push(c);
    } else {
      if (due < dueCap) {
        session.push(c);
        due++;
      } else deferred.push(c);
    }
  }
  return { session, deferred };
}
