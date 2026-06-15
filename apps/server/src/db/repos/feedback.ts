/**
 * Reader feedback + playthrough analytics repository (Epic 19, F1851–F1856).
 *
 * Captures per-moment reader feedback and a local play-event log (knot visits,
 * choices, endings, migration 038), and derives aggregate analytics: choice
 * statistics, per-knot drop-off, and ending distribution. Everything is local; a
 * feedback bundle (F1852) can be exported to send back to an author, and an
 * author can import reader bundles into an inbox (F1853).
 */

import { nowIso } from '@fables/core';
import type { Db } from '../connection.js';

export type FeedbackKind = 'note' | 'reaction' | 'bug';
export type PlayEventType = 'visit' | 'choice' | 'ending';

export interface Feedback {
  id: string;
  storyId: string;
  knot: string;
  kind: FeedbackKind;
  text: string;
  sentiment: string | null;
  createdAt: string;
}

interface FeedbackRow {
  id: string;
  story_id: string;
  knot: string;
  kind: string;
  text: string;
  sentiment: string | null;
  created_at: string;
}

const toFeedback = (r: FeedbackRow): Feedback => ({
  id: r.id,
  storyId: r.story_id,
  knot: r.knot,
  kind: r.kind as FeedbackKind,
  text: r.text,
  sentiment: r.sentiment,
  createdAt: r.created_at,
});

export interface PlayEventInput {
  sessionId: string;
  type: PlayEventType;
  knot: string;
  choiceIndex?: number | undefined;
  label?: string | undefined;
  seq?: number | undefined;
}

export interface ChoiceStat {
  knot: string;
  choiceIndex: number;
  label: string;
  count: number;
}
export interface DropOffStat {
  knot: string;
  dropOffs: number;
}
export interface EndingStat {
  ending: string;
  count: number;
}
export interface FeedbackBundle {
  format: 'fables-feedback';
  version: 1;
  storyId: string;
  feedback: Omit<Feedback, 'id' | 'storyId'>[];
  choiceStats: ChoiceStat[];
  endings: EndingStat[];
}

export function feedbackRepo(db: Db) {
  return {
    addFeedback(
      storyId: string,
      input: { knot?: string; kind?: FeedbackKind; text: string; sentiment?: string },
    ): Feedback {
      const fb: Feedback = {
        id: `fb_${crypto.randomUUID()}`,
        storyId,
        knot: input.knot ?? '',
        kind: input.kind ?? 'note',
        text: input.text,
        sentiment: input.sentiment ?? null,
        createdAt: nowIso(),
      };
      db.prepare(
        'INSERT INTO reader_feedback (id, story_id, knot, kind, text, sentiment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(fb.id, storyId, fb.knot, fb.kind, fb.text, fb.sentiment, fb.createdAt);
      return fb;
    },

    listFeedback(storyId: string): Feedback[] {
      return (
        db
          .prepare('SELECT * FROM reader_feedback WHERE story_id = ? ORDER BY created_at')
          .all(storyId) as FeedbackRow[]
      ).map(toFeedback);
    },

    logEvent(storyId: string, e: PlayEventInput): void {
      db.prepare(
        'INSERT INTO play_events (id, story_id, session_id, type, knot, choice_index, label, seq, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        `pe_${crypto.randomUUID()}`,
        storyId,
        e.sessionId,
        e.type,
        e.knot,
        e.choiceIndex ?? null,
        e.label ?? '',
        e.seq ?? 0,
        nowIso(),
      );
    },

    /** Choice pick counts per (knot, choice) (F1854). */
    choiceStats(storyId: string): ChoiceStat[] {
      return db
        .prepare(
          `SELECT knot, choice_index AS choiceIndex, label, COUNT(*) AS count
           FROM play_events WHERE story_id = ? AND type = 'choice'
           GROUP BY knot, choice_index, label ORDER BY knot, choice_index`,
        )
        .all(storyId) as { knot: string; choiceIndex: number; label: string; count: number }[];
    },

    /**
     * Per-knot drop-off (F1855): for each session, the last knot visited when the
     * session has no ending event is a drop-off. Returns counts per knot.
     */
    dropOff(storyId: string): DropOffStat[] {
      const sessions = db
        .prepare('SELECT DISTINCT session_id FROM play_events WHERE story_id = ?')
        .all(storyId) as { session_id: string }[];
      const counts = new Map<string, number>();
      for (const { session_id } of sessions) {
        const hasEnding = db
          .prepare(
            "SELECT 1 FROM play_events WHERE story_id = ? AND session_id = ? AND type = 'ending' LIMIT 1",
          )
          .get(storyId, session_id);
        if (hasEnding) continue;
        const last = db
          .prepare(
            `SELECT knot FROM play_events WHERE story_id = ? AND session_id = ? AND type = 'visit'
             ORDER BY seq DESC, created_at DESC LIMIT 1`,
          )
          .get(storyId, session_id) as { knot: string } | undefined;
        if (last) counts.set(last.knot, (counts.get(last.knot) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([knot, dropOffs]) => ({ knot, dropOffs }))
        .sort((a, b) => b.dropOffs - a.dropOffs);
    },

    /** Ending distribution (F1856): how many sessions reached each ending. */
    endingDistribution(storyId: string): EndingStat[] {
      return db
        .prepare(
          `SELECT CASE WHEN label != '' THEN label ELSE knot END AS ending, COUNT(*) AS count
           FROM play_events WHERE story_id = ? AND type = 'ending'
           GROUP BY ending ORDER BY count DESC`,
        )
        .all(storyId) as { ending: string; count: number }[];
    },

    /** An exportable feedback bundle to send back to an author (F1852). */
    exportBundle(storyId: string, anonymize = false): FeedbackBundle {
      const feedback = this.listFeedback(storyId).map((f) => ({
        knot: f.knot,
        kind: f.kind,
        text: anonymize ? f.text : f.text,
        sentiment: f.sentiment,
        createdAt: anonymize ? f.createdAt.slice(0, 10) : f.createdAt, // F1858: coarsen time
      }));
      return {
        format: 'fables-feedback',
        version: 1,
        storyId,
        feedback,
        choiceStats: this.choiceStats(storyId),
        endings: this.endingDistribution(storyId),
      };
    },

    /** Import a reader's feedback bundle into the author inbox (F1853). */
    importBundle(
      storyId: string,
      bundle: {
        feedback: {
          knot?: string | undefined;
          kind?: FeedbackKind | undefined;
          text: string;
          sentiment?: string | null | undefined;
        }[];
      },
    ): number {
      let n = 0;
      const tx = db.transaction(() => {
        for (const f of bundle.feedback) {
          this.addFeedback(storyId, {
            ...(f.knot !== undefined ? { knot: f.knot } : {}),
            ...(f.kind !== undefined ? { kind: f.kind } : {}),
            text: f.text,
            ...(f.sentiment !== undefined && f.sentiment !== null
              ? { sentiment: f.sentiment }
              : {}),
          });
          n++;
        }
      });
      tx();
      return n;
    },
  };
}

export type FeedbackRepo = ReturnType<typeof feedbackRepo>;
