import type { Db } from '../connection.js';

/**
 * Insights repo (F791–F798): pure aggregation queries over existing tables.
 * No new deps. All SQL lives here.
 */

export interface InsightsOverview {
  notes: number;
  notebooks: number;
  entities: number;
  stories: number;
  links: number;
  orphans: number;
  wordsTotal: number;
}

export interface GrowthPoint {
  day: string; // YYYY-MM-DD
  notes: number;
  links: number;
  words: number;
}

export interface StreakResult {
  current: number;
  longest: number;
  /** 365 items, index 0 = today, index 364 = 365 days ago. Count of notes created that day. */
  heatmap: number[];
}

export interface StaleNote {
  id: string;
  title: string;
  updatedAt: string;
  linkDegree: number;
}

export interface SuggestedLink {
  sourceId: string;
  sourceTitle: string;
  targetId: string;
  targetTitle: string;
  mentionCount: number;
}

export interface ReadingInsights {
  plays: number;
  turns: number;
  completions: number;
  topScenes: { scene: string; count: number }[];
}

export interface DeadEnds {
  orphanNotes: { id: string; title: string; createdAt: string }[];
  brokenLinks: { id: string; sourceId: string; targetTitle: string }[];
}

export interface HealthCheckItem {
  key: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export interface VaultHealth {
  score: number;
  checklist: HealthCheckItem[];
}

export function insightsRepo(db: Db) {
  return {
    overview(): InsightsOverview {
      const notes = (
        db
          .prepare(`SELECT COUNT(*) AS n FROM notes WHERE trashed_at IS NULL`)
          .get() as { n: number }
      ).n;
      const notebooks = (
        db.prepare(`SELECT COUNT(*) AS n FROM notebooks`).get() as { n: number }
      ).n;
      const entities = (
        db.prepare(`SELECT COUNT(*) AS n FROM entities`).get() as { n: number }
      ).n;
      const stories = (
        db.prepare(`SELECT COUNT(*) AS n FROM stories`).get() as { n: number }
      ).n;
      const links = (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM links WHERE kind IN ('wikilink','mention') AND source_type = 'note'`,
          )
          .get() as { n: number }
      ).n;

      // Orphans: live notes with no incoming or outgoing wikilinks
      const orphans = (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM notes n
             WHERE n.trashed_at IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM links l WHERE l.kind = 'wikilink'
                   AND ((l.source_type = 'note' AND l.source_id = n.id)
                     OR (l.target_type = 'note' AND l.target_id = n.id))
               )`,
          )
          .get() as { n: number }
      ).n;

      // Total word count: split on whitespace
      const wordsRow = db
        .prepare(
          `SELECT SUM(
            length(trim(title)) - length(replace(trim(title), ' ', '')) + CASE WHEN trim(title) = '' THEN 0 ELSE 1 END
            + length(trim(body)) - length(replace(trim(body), ' ', '')) + CASE WHEN trim(body) = '' THEN 0 ELSE 1 END
          ) AS w FROM notes WHERE trashed_at IS NULL`,
        )
        .get() as { w: number | null };

      return { notes, notebooks, entities, stories, links, orphans, wordsTotal: wordsRow.w ?? 0 };
    },

    /**
     * Per-day notes created, links created, and approximate word additions
     * between `from` and `to` (inclusive, ISO date strings YYYY-MM-DD).
     */
    growth(from: string, to: string): GrowthPoint[] {
      const rows = db
        .prepare(
          `SELECT
             substr(created_at, 1, 10) AS day,
             COUNT(*) AS notes,
             SUM(
               length(trim(title)) - length(replace(trim(title), ' ', '')) + CASE WHEN trim(title) = '' THEN 0 ELSE 1 END
               + length(trim(body)) - length(replace(trim(body), ' ', '')) + CASE WHEN trim(body) = '' THEN 0 ELSE 1 END
             ) AS words
           FROM notes
           WHERE trashed_at IS NULL
             AND substr(created_at, 1, 10) >= ?
             AND substr(created_at, 1, 10) <= ?
           GROUP BY day
           ORDER BY day`,
        )
        .all(from, to) as { day: string; notes: number; words: number }[];

      const linkRows = db
        .prepare(
          `SELECT
             substr(created_at, 1, 10) AS day,
             COUNT(*) AS links
           FROM links
           WHERE kind IN ('wikilink','mention') AND source_type = 'note'
             AND substr(created_at, 1, 10) >= ?
             AND substr(created_at, 1, 10) <= ?
           GROUP BY day
           ORDER BY day`,
        )
        .all(from, to) as { day: string; links: number }[];

      const linkMap = new Map(linkRows.map((r) => [r.day, r.links]));

      // Fill in days with notes but no links (and vice versa)
      const allDays = new Set([...rows.map((r) => r.day), ...linkRows.map((r) => r.day)]);
      const noteMap = new Map(rows.map((r) => [r.day, r]));

      const result: GrowthPoint[] = [];
      for (const day of [...allDays].sort()) {
        const n = noteMap.get(day);
        result.push({
          day,
          notes: n?.notes ?? 0,
          links: linkMap.get(day) ?? 0,
          words: n?.words ?? 0,
        });
      }
      return result;
    },

    streaks(): StreakResult {
      // Get the count of notes created per day for the last 365 days
      const rows = db
        .prepare(
          `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS cnt
           FROM notes
           WHERE trashed_at IS NULL
             AND created_at >= datetime('now', '-365 days')
           GROUP BY day
           ORDER BY day DESC`,
        )
        .all() as { day: string; cnt: number }[];

      const today = new Date();

      // Build heatmap: 365 slots, index 0 = today, 364 = oldest
      const heatmap = new Array(365).fill(0);
      const dayMap = new Map(rows.map((r) => [r.day, r.cnt]));
      for (let i = 0; i < 365; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dayKey = d.toISOString().slice(0, 10);
        heatmap[i] = dayMap.get(dayKey) ?? 0;
      }

      // Compute current streak (consecutive days ending today or yesterday with notes)
      let current = 0;
      for (let i = 0; i < 365; i++) {
        if (heatmap[i] > 0) {
          current++;
        } else {
          // Allow a gap for today (may not have written yet)
          if (i === 0) continue;
          break;
        }
      }

      // Compute longest streak
      let longest = 0;
      let run = 0;
      for (let i = 364; i >= 0; i--) {
        if (heatmap[i] > 0) {
          run++;
          if (run > longest) longest = run;
        } else {
          run = 0;
        }
      }
      if (current > longest) longest = current;

      return { current, longest, heatmap };
    },

    /**
     * High-degree notes (many backlinks) that haven't been touched in 14+ days.
     */
    stale(limit: number): StaleNote[] {
      const rows = db
        .prepare(
          `SELECT
             n.id,
             n.title,
             n.updated_at AS updatedAt,
             COUNT(l.id) AS linkDegree
           FROM notes n
           LEFT JOIN links l ON l.target_type = 'note' AND l.target_id = n.id AND l.kind = 'wikilink'
           WHERE n.trashed_at IS NULL
             AND n.updated_at <= datetime('now', '-14 days')
           GROUP BY n.id
           HAVING linkDegree > 0
           ORDER BY linkDegree DESC, n.updated_at ASC
           LIMIT ?`,
        )
        .all(limit) as { id: string; title: string; updatedAt: string; linkDegree: number }[];
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        updatedAt: r.updatedAt,
        linkDegree: r.linkDegree,
      }));
    },

    /**
     * Top unlinked-mention pairs: notes that mention each other by title but
     * have no wikilink in the links table yet.
     */
    suggestedLinks(limit: number): SuggestedLink[] {
      const rows = db
        .prepare(
          `SELECT
             l.source_id AS sourceId,
             ns.title AS sourceTitle,
             l.target_id AS targetId,
             nt.title AS targetTitle,
             COUNT(*) AS mentionCount
           FROM links l
           JOIN notes ns ON ns.id = l.source_id AND ns.trashed_at IS NULL
           JOIN notes nt ON nt.id = l.target_id AND nt.trashed_at IS NULL
           WHERE l.kind = 'mention'
             AND l.source_type = 'note'
             AND l.target_type = 'note'
             AND NOT EXISTS (
               SELECT 1 FROM links lw
               WHERE lw.kind = 'wikilink'
                 AND lw.source_type = 'note' AND lw.source_id = l.source_id
                 AND lw.target_type = 'note' AND lw.target_id = l.target_id
             )
           GROUP BY l.source_id, l.target_id
           ORDER BY mentionCount DESC
           LIMIT ?`,
        )
        .all(limit) as {
        sourceId: string;
        sourceTitle: string;
        targetId: string;
        targetTitle: string;
        mentionCount: number;
      }[];
      return rows;
    },

    /**
     * Reading stats from story_saves (proxy for plays) and effect_events (turns/completions).
     */
    reading(): ReadingInsights {
      const plays = (
        db
          .prepare(
            `SELECT COUNT(DISTINCT story_id || '::' || id) AS n FROM playthroughs`,
          )
          .get() as { n: number }
      ).n;

      const turns = (
        db
          .prepare(`SELECT COUNT(*) AS n FROM effect_events`)
          .get() as { n: number }
      ).n;

      // Count completions: playthroughs that have a finished_at
      const completions = (
        db
          .prepare(`SELECT COUNT(*) AS n FROM playthroughs WHERE finished_at IS NOT NULL`)
          .get() as { n: number }
      ).n;

      // Top scenes from saves: most-visited scene paths
      const topScenesRows = db
        .prepare(
          `SELECT scene, COUNT(*) AS cnt
           FROM story_saves
           GROUP BY scene
           ORDER BY cnt DESC
           LIMIT 10`,
        )
        .all() as { scene: string; cnt: number }[];

      return {
        plays,
        turns,
        completions,
        topScenes: topScenesRows.map((r) => ({ scene: r.scene, count: r.cnt })),
      };
    },

    deadEnds(): DeadEnds {
      const orphanNotes = db
        .prepare(
          `SELECT n.id, n.title, n.created_at AS createdAt
           FROM notes n
           WHERE n.trashed_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM links l WHERE l.kind = 'wikilink'
                 AND ((l.source_type = 'note' AND l.source_id = n.id)
                   OR (l.target_type = 'note' AND l.target_id = n.id))
             )
           ORDER BY n.created_at DESC
           LIMIT 100`,
        )
        .all() as { id: string; title: string; createdAt: string }[];

      const brokenLinks = db
        .prepare(
          `SELECT l.id, l.source_id AS sourceId, l.target_title AS targetTitle
           FROM links l
           WHERE l.kind = 'wikilink' AND l.broken = 1
           ORDER BY l.created_at DESC
           LIMIT 100`,
        )
        .all() as { id: string; sourceId: string; targetTitle: string }[];

      return { orphanNotes, brokenLinks };
    },

    health(): VaultHealth {
      const counts = this.overview();
      const dead = this.deadEnds();

      const checklist: HealthCheckItem[] = [
        {
          key: 'has_notes',
          label: 'Vault has notes',
          ok: counts.notes > 0,
          detail: `${counts.notes} notes`,
        },
        {
          key: 'low_orphans',
          label: 'Low orphan rate (<20%)',
          ok: counts.notes === 0 || counts.orphans / counts.notes < 0.2,
          detail: `${counts.orphans} of ${counts.notes} notes are orphans`,
        },
        {
          key: 'no_broken_links',
          label: 'No broken wikilinks',
          ok: dead.brokenLinks.length === 0,
          detail: `${dead.brokenLinks.length} broken links`,
        },
        {
          key: 'has_stories',
          label: 'Has stories',
          ok: counts.stories > 0,
          detail: `${counts.stories} stories`,
        },
        {
          key: 'has_entities',
          label: 'Has entities in codex',
          ok: counts.entities > 0,
          detail: `${counts.entities} entities`,
        },
        {
          key: 'words_written',
          label: 'Meaningful content (>500 words)',
          ok: counts.wordsTotal > 500,
          detail: `${counts.wordsTotal} words`,
        },
      ];

      const okCount = checklist.filter((c) => c.ok).length;
      const score = Math.round((okCount / checklist.length) * 100);

      return { score, checklist };
    },
  };
}

export type InsightsRepo = ReturnType<typeof insightsRepo>;
