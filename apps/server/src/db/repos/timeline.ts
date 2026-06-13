import type { Db } from '../connection.js';

/**
 * Timeline event sourcing (F651/F652). Each source contributes rows in a common
 * shape; the service merges, sorts, groups by day, and paginates. SQL lives
 * here so the service stays pure aggregation.
 */

export type TimelineType = 'notes' | 'stories' | 'playthroughs';

export interface TimelineRow {
  /** Stable id: `<source>:<key>` — also the pagination cursor token. */
  id: string;
  type: TimelineType;
  /** Finer-grained event verb, e.g. `note.created`, `playthrough.finished`. */
  event: string;
  at: string;
  title: string;
  /** Primary object id this event points at (note/story id). */
  refId: string;
  /** Optional extra context for the UI. */
  meta: Record<string, unknown>;
}

export function timelineRepo(db: Db) {
  return {
    /** Note create/edit events derived from the revision history (F651). */
    noteEvents(): TimelineRow[] {
      const rows = db
        .prepare(
          `SELECT r.note_id, r.rev, r.title, r.created_at, n.notebook_id
           FROM note_revisions r
           JOIN notes n ON n.id = r.note_id AND n.trashed_at IS NULL
           ORDER BY r.created_at, r.note_id, r.rev`,
        )
        .all() as {
        note_id: string;
        rev: number;
        title: string;
        created_at: string;
        notebook_id: string;
      }[];
      return rows.map((r) => ({
        id: `note:${r.note_id}:${r.rev}`,
        type: 'notes' as const,
        event: r.rev === 0 ? 'note.created' : 'note.edited',
        at: r.created_at,
        title: r.title === '' ? '(untitled note)' : r.title,
        refId: r.note_id,
        meta: { rev: r.rev, notebookId: r.notebook_id },
      }));
    },

    /** Story build and release events (F651). */
    storyEvents(): TimelineRow[] {
      const builds = db
        .prepare(
          `SELECT id, title, status, built_at FROM stories WHERE built_at IS NOT NULL
           ORDER BY built_at, id`,
        )
        .all() as { id: string; title: string; status: string; built_at: string }[];
      const releases = db
        .prepare(
          `SELECT id, story_id, name, status, created_at FROM story_releases ORDER BY created_at, id`,
        )
        .all() as {
        id: string;
        story_id: string;
        name: string;
        status: string;
        created_at: string;
      }[];
      return [
        ...builds.map((b) => ({
          id: `story-build:${b.id}`,
          type: 'stories' as const,
          event: 'story.built',
          at: b.built_at,
          title: b.title,
          refId: b.id,
          meta: { status: b.status },
        })),
        ...releases.map((r) => ({
          id: `story-release:${r.id}`,
          type: 'stories' as const,
          event: 'story.released',
          at: r.created_at,
          title: r.name,
          refId: r.story_id,
          meta: { releaseId: r.id, status: r.status },
        })),
      ];
    },

    /** Playthrough started/finished events (F651). */
    playthroughEvents(): TimelineRow[] {
      const rows = db
        .prepare(
          `SELECT p.story_id, p.id, p.started_at, p.finished_at, s.title
           FROM playthroughs p JOIN stories s ON s.id = p.story_id
           ORDER BY p.started_at, p.id`,
        )
        .all() as {
        story_id: string;
        id: string;
        started_at: string;
        finished_at: string | null;
        title: string;
      }[];
      const events: TimelineRow[] = [];
      for (const r of rows) {
        events.push({
          id: `pt-start:${r.story_id}:${r.id}`,
          type: 'playthroughs',
          event: 'playthrough.started',
          at: r.started_at,
          title: r.title,
          refId: r.story_id,
          meta: { playthroughId: r.id },
        });
        if (r.finished_at !== null) {
          events.push({
            id: `pt-finish:${r.story_id}:${r.id}`,
            type: 'playthroughs',
            event: 'playthrough.finished',
            at: r.finished_at,
            title: r.title,
            refId: r.story_id,
            meta: { playthroughId: r.id },
          });
        }
      }
      return events;
    },
  };
}

export type TimelineRepo = ReturnType<typeof timelineRepo>;
