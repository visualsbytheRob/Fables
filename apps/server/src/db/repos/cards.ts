/**
 * Cards repository (Epic 18, F1701/F1703/F1705/F1706/F1707/F1718).
 *
 * CRUD for spaced-repetition cards plus the review pipeline: a card is reviewed
 * by applying the FSRS scheduler, appending an immutable review-log row, and
 * updating the card's memory state in one transaction. The due queue mixes due
 * review cards with a capped intake of new cards (F1706); suspend/bury take cards
 * out of rotation (F1707); orphan listing surfaces cards whose note was deleted
 * (F1718).
 */

import { nowIso } from '@fables/core';
import type { Db } from '../connection.js';
import { reviewCard, type CardState, type ReviewableCard } from '../../learning/scheduler.js';
import type { Rating } from '../../learning/fsrs.js';
import type { ScheduleOptions } from '../../learning/fsrs.js';

export interface Card {
  id: string;
  noteId: string | null;
  blockRef: string;
  kind: string;
  prompt: string;
  answer: string;
  state: CardState;
  stability: number | null;
  difficulty: number | null;
  due: string | null;
  reps: number;
  lapses: number;
  lastReview: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CardRow {
  id: string;
  note_id: string | null;
  block_ref: string;
  kind: string;
  prompt: string;
  answer: string;
  state: string;
  stability: number | null;
  difficulty: number | null;
  due: string | null;
  reps: number;
  lapses: number;
  last_review: string | null;
  created_at: string;
  updated_at: string;
}

const toCard = (r: CardRow): Card => ({
  id: r.id,
  noteId: r.note_id,
  blockRef: r.block_ref,
  kind: r.kind,
  prompt: r.prompt,
  answer: r.answer,
  state: r.state as CardState,
  stability: r.stability,
  difficulty: r.difficulty,
  due: r.due,
  reps: r.reps,
  lapses: r.lapses,
  lastReview: r.last_review,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const newCardId = (): string => `card_${crypto.randomUUID()}`;

export interface CardInput {
  noteId?: string | null;
  blockRef?: string;
  kind?: string;
  prompt: string;
  answer: string;
}

export interface ReviewLogEntry {
  id: string;
  cardId: string;
  rating: number;
  stateBefore: string;
  stability: number | null;
  difficulty: number | null;
  elapsedDays: number;
  scheduledDays: number;
  reviewR: number | null;
  reviewedAt: string;
}

export interface DueQueueOptions {
  /** ISO timestamp treated as "now"; due review cards have due <= now. */
  now?: string;
  /** Max review cards to return. */
  limit?: number;
  /** Max brand-new cards to introduce (F1706). */
  newLimit?: number;
}

export function cardsRepo(db: Db) {
  return {
    create(input: CardInput): Card {
      const now = nowIso();
      const card: Card = {
        id: newCardId(),
        noteId: input.noteId ?? null,
        blockRef: input.blockRef ?? '',
        kind: input.kind ?? 'basic',
        prompt: input.prompt,
        answer: input.answer,
        state: 'new',
        stability: null,
        difficulty: null,
        due: null,
        reps: 0,
        lapses: 0,
        lastReview: null,
        createdAt: now,
        updatedAt: now,
      };
      db.prepare(
        `INSERT INTO cards
           (id, note_id, block_ref, kind, prompt, answer, state, stability, difficulty, due, reps, lapses, last_review, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'new', NULL, NULL, NULL, 0, 0, NULL, ?, ?)`,
      ).run(card.id, card.noteId, card.blockRef, card.kind, card.prompt, card.answer, now, now);
      return card;
    },

    get(id: string): Card | null {
      const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as CardRow | undefined;
      return row ? toCard(row) : null;
    },

    remove(id: string): boolean {
      return db.prepare('DELETE FROM cards WHERE id = ?').run(id).changes > 0;
    },

    /** Cards in a notebook-agnostic way for a source note (F1717 live link). */
    forNote(noteId: string): Card[] {
      return (
        db
          .prepare('SELECT * FROM cards WHERE note_id = ? ORDER BY created_at')
          .all(noteId) as CardRow[]
      ).map(toCard);
    },

    /** Cards whose source note was deleted (F1718). */
    orphans(): Card[] {
      return (
        db
          .prepare("SELECT * FROM cards WHERE note_id IS NULL AND state != 'suspended'")
          .all() as CardRow[]
      ).map(toCard);
    },

    /**
     * The due queue (F1705/F1706): due review/relearning cards (due <= now),
     * then up to `newLimit` brand-new cards, excluding suspended/buried.
     */
    dueQueue(opts: DueQueueOptions = {}): Card[] {
      const now = opts.now ?? nowIso();
      const limit = opts.limit ?? 200;
      const newLimit = opts.newLimit ?? 20;
      const due = (
        db
          .prepare(
            `SELECT * FROM cards
             WHERE state IN ('review', 'relearning', 'learning') AND due IS NOT NULL AND due <= ?
             ORDER BY due ASC LIMIT ?`,
          )
          .all(now, limit) as CardRow[]
      ).map(toCard);
      const fresh = (
        db
          .prepare("SELECT * FROM cards WHERE state = 'new' ORDER BY created_at ASC LIMIT ?")
          .all(newLimit) as CardRow[]
      ).map(toCard);
      return [...due, ...fresh];
    },

    /** Due/new/suspended counts for a dashboard (F1705). */
    counts(now = nowIso()): { due: number; new: number; suspended: number; total: number } {
      const due = (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM cards
             WHERE state IN ('review', 'relearning', 'learning') AND due IS NOT NULL AND due <= ?`,
          )
          .get(now) as { n: number }
      ).n;
      const fresh = (
        db.prepare("SELECT COUNT(*) AS n FROM cards WHERE state = 'new'").get() as {
          n: number;
        }
      ).n;
      const suspended = (
        db.prepare("SELECT COUNT(*) AS n FROM cards WHERE state = 'suspended'").get() as {
          n: number;
        }
      ).n;
      const total = (db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n;
      return { due, new: fresh, suspended, total };
    },

    /** Suspend / bury a card, taking it out of the queue (F1707). */
    setState(id: string, state: CardState): boolean {
      return (
        db
          .prepare('UPDATE cards SET state = ?, updated_at = ? WHERE id = ?')
          .run(state, nowIso(), id).changes > 0
      );
    },

    /** Review a card: apply FSRS, append the log, update state (F1701/F1703). */
    review(id: string, rating: Rating, now = nowIso(), options: ScheduleOptions = {}): Card | null {
      const card = this.get(id);
      if (!card) return null;
      const reviewable: ReviewableCard = {
        state: card.state,
        stability: card.stability,
        difficulty: card.difficulty,
        due: card.due,
        reps: card.reps,
        lapses: card.lapses,
        lastReview: card.lastReview,
      };
      const outcome = reviewCard(reviewable, rating, now, options);
      const tx = db.transaction(() => {
        db.prepare(
          `UPDATE cards SET state = ?, stability = ?, difficulty = ?, due = ?, reps = ?, lapses = ?, last_review = ?, updated_at = ?
           WHERE id = ?`,
        ).run(
          outcome.state,
          outcome.stability,
          outcome.difficulty,
          outcome.due,
          outcome.reps,
          outcome.lapses,
          outcome.lastReview,
          now,
          id,
        );
        db.prepare(
          `INSERT INTO review_log
             (id, card_id, rating, state_before, stability, difficulty, elapsed_days, scheduled_days, review_r, reviewed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          `rlog_${crypto.randomUUID()}`,
          id,
          outcome.log.rating,
          outcome.log.stateBefore,
          outcome.log.stability,
          outcome.log.difficulty,
          outcome.log.elapsedDays,
          outcome.log.scheduledDays,
          outcome.log.reviewR,
          now,
        );
      });
      tx();
      return this.get(id);
    },

    /** Full review history for a card, newest first (F1703). */
    reviewLog(cardId: string): ReviewLogEntry[] {
      return (
        db
          .prepare('SELECT * FROM review_log WHERE card_id = ? ORDER BY reviewed_at DESC')
          .all(cardId) as {
          id: string;
          card_id: string;
          rating: number;
          state_before: string;
          stability: number | null;
          difficulty: number | null;
          elapsed_days: number;
          scheduled_days: number;
          review_r: number | null;
          reviewed_at: string;
        }[]
      ).map((r) => ({
        id: r.id,
        cardId: r.card_id,
        rating: r.rating,
        stateBefore: r.state_before,
        stability: r.stability,
        difficulty: r.difficulty,
        elapsedDays: r.elapsed_days,
        scheduledDays: r.scheduled_days,
        reviewR: r.review_r,
        reviewedAt: r.reviewed_at,
      }));
    },
  };
}

export type CardsRepo = ReturnType<typeof cardsRepo>;
