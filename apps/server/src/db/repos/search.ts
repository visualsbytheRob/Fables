import type { Db } from '../connection.js';

export type SearchType = 'notes' | 'entities' | 'stories';

export interface Highlight {
  start: number;
  end: number;
}

export interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  highlights: Highlight[];
  score: number;
}

export interface SearchGroup {
  type: SearchType;
  total: number;
  results: SearchResult[];
}

/**
 * FTS5 trigger convention: content= tables include ALL rows (trashed included),
 * and we filter trashed notes out at query time by JOINing to the notes table.
 * This avoids SQLITE_CORRUPT_VTAB from conditional trigger re-inserts.
 */

const OPEN = '\x02';
const CLOSE = '\x03';

/**
 * Parses {start, end} highlight offsets from an FTS5 snippet string.
 * FTS5 snippet() wraps matched terms with our private marker bytes \x02/\x03.
 * We scan the raw string to produce offsets in the cleaned (no-marker) text.
 */
function parseHighlights(raw: string, open: string, close: string): Highlight[] {
  const highlights: Highlight[] = [];
  let pos = 0; // position in cleaned output
  let i = 0;
  while (i < raw.length) {
    const openIdx = raw.indexOf(open, i);
    if (openIdx === -1) break;
    pos += openIdx - i;
    i = openIdx + open.length;
    const closeIdx = raw.indexOf(close, i);
    if (closeIdx === -1) break;
    const matchLen = closeIdx - i;
    highlights.push({ start: pos, end: pos + matchLen });
    pos += matchLen;
    i = closeIdx + close.length;
  }
  return highlights;
}

function stripMarkers(raw: string): string {
  return raw.replaceAll(OPEN, '').replaceAll(CLOSE, '');
}

/**
 * Sanitize a raw FTS5 query string.
 * Accepts phrases ("…"), prefix words (word*), and NEAR(…).
 * Unbalanced quotes → wrap as a phrase.
 * Bare operators only → wrap as phrase.
 * Returns null for empty input.
 */
export function sanitizeFtsQuery(q: string): string | null {
  const trimmed = q.trim();
  if (!trimmed) return null;

  const quoteCount = (trimmed.match(/"/g) ?? []).length;
  if (quoteCount % 2 !== 0) {
    return `"${trimmed.replace(/"/g, '""')}"`;
  }

  const tokens = trimmed.split(/\s+/);
  const onlyOperators = tokens.every((t) => /^(AND|OR|NOT)$/i.test(t));
  if (onlyOperators) {
    return `"${trimmed.replace(/"/g, '""')}"`;
  }

  return trimmed;
}

/**
 * Search repo: BM25-ranked FTS5 queries returning grouped results.
 * Column weights: notes(title×10, body×1), entities(name×10, aliases×5, fields×1),
 * scenes(path×10, source×1).
 *
 * Trashed notes are excluded via a JOIN to the live notes table — the FTS
 * table itself holds all notes (see migration 011-fts trigger convention).
 */
export function searchRepo(db: Db) {
  return {
    /**
     * Search live (non-trashed) notes via FTS5.
     * bm25 weights: title=10, body=1.
     */
    searchNotes(q: string, limit: number): SearchResult[] {
      const safe = sanitizeFtsQuery(q);
      if (!safe) return [];
      try {
        const rows = db
          .prepare(
            `SELECT
               fts_notes.id,
               notes.title,
               snippet(fts_notes, 1, ?, ?, '…', 32) AS snip,
               bm25(fts_notes, 10, 1) AS score
             FROM fts_notes
             JOIN notes ON notes.id = fts_notes.id AND notes.trashed_at IS NULL
             WHERE fts_notes MATCH ?
             ORDER BY score
             LIMIT ?`,
          )
          .all(OPEN, CLOSE, safe, limit) as {
          id: string;
          title: string;
          snip: string;
          score: number;
        }[];
        return rows.map((r) => ({
          id: r.id,
          title: r.title,
          snippet: stripMarkers(r.snip),
          highlights: parseHighlights(r.snip, OPEN, CLOSE),
          score: r.score,
        }));
      } catch {
        return [];
      }
    },

    /** Count total FTS-matching live notes. */
    countNotes(q: string): number {
      const safe = sanitizeFtsQuery(q);
      if (!safe) return 0;
      try {
        const row = db
          .prepare(
            `SELECT COUNT(*) AS n
             FROM fts_notes
             JOIN notes ON notes.id = fts_notes.id AND notes.trashed_at IS NULL
             WHERE fts_notes MATCH ?`,
          )
          .get(safe) as { n: number };
        return row.n;
      } catch {
        return 0;
      }
    },

    /**
     * Search entities.
     * bm25 weights: name=10, aliases=5, fields=1.
     */
    searchEntities(q: string, limit: number): SearchResult[] {
      const safe = sanitizeFtsQuery(q);
      if (!safe) return [];
      try {
        const rows = db
          .prepare(
            `SELECT
               fts_entities.id,
               entities.name AS title,
               snippet(fts_entities, 0, ?, ?, '…', 32) AS snip,
               bm25(fts_entities, 10, 5, 1) AS score
             FROM fts_entities
             JOIN entities ON entities.id = fts_entities.id
             WHERE fts_entities MATCH ?
             ORDER BY score
             LIMIT ?`,
          )
          .all(OPEN, CLOSE, safe, limit) as {
          id: string;
          title: string;
          snip: string;
          score: number;
        }[];
        return rows.map((r) => ({
          id: r.id,
          title: r.title,
          snippet: stripMarkers(r.snip),
          highlights: parseHighlights(r.snip, OPEN, CLOSE),
          score: r.score,
        }));
      } catch {
        return [];
      }
    },

    countEntities(q: string): number {
      const safe = sanitizeFtsQuery(q);
      if (!safe) return 0;
      try {
        const row = db
          .prepare(
            `SELECT COUNT(*) AS n
             FROM fts_entities
             JOIN entities ON entities.id = fts_entities.id
             WHERE fts_entities MATCH ?`,
          )
          .get(safe) as { n: number };
        return row.n;
      } catch {
        return 0;
      }
    },

    /**
     * Search story scenes (surfaced as 'stories' type).
     * bm25 weights: path=10, source=1.
     */
    searchStories(q: string, limit: number): SearchResult[] {
      const safe = sanitizeFtsQuery(q);
      if (!safe) return [];
      try {
        const rows = db
          .prepare(
            `SELECT
               fts_scenes.id,
               scenes.path AS title,
               snippet(fts_scenes, 0, ?, ?, '…', 32) AS snip,
               bm25(fts_scenes, 10, 1) AS score
             FROM fts_scenes
             JOIN scenes ON scenes.id = fts_scenes.id
             WHERE fts_scenes MATCH ?
             ORDER BY score
             LIMIT ?`,
          )
          .all(OPEN, CLOSE, safe, limit) as {
          id: string;
          title: string;
          snip: string;
          score: number;
        }[];
        return rows.map((r) => ({
          id: r.id,
          title: r.title,
          snippet: stripMarkers(r.snip),
          highlights: parseHighlights(r.snip, OPEN, CLOSE),
          score: r.score,
        }));
      } catch {
        return [];
      }
    },

    countStories(q: string): number {
      const safe = sanitizeFtsQuery(q);
      if (!safe) return 0;
      try {
        const row = db
          .prepare(
            `SELECT COUNT(*) AS n
             FROM fts_scenes
             JOIN scenes ON scenes.id = fts_scenes.id
             WHERE fts_scenes MATCH ?`,
          )
          .get(safe) as { n: number };
        return row.n;
      } catch {
        return 0;
      }
    },

    /** FTS row counts (includes ALL notes rows, trashed included). */
    ftsCounts(): { notes: number; entities: number; scenes: number } {
      const notes = (
        db.prepare('SELECT COUNT(*) AS n FROM fts_notes').get() as { n: number }
      ).n;
      const entities = (
        db.prepare('SELECT COUNT(*) AS n FROM fts_entities').get() as { n: number }
      ).n;
      const scenes = (
        db.prepare('SELECT COUNT(*) AS n FROM fts_scenes').get() as { n: number }
      ).n;
      return { notes, entities, scenes };
    },

    /** Source table total counts (notes includes trashed for consistency check). */
    sourceCounts(): { notes: number; entities: number; scenes: number } {
      const notes = (
        db.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }
      ).n;
      const entities = (
        db.prepare('SELECT COUNT(*) AS n FROM entities').get() as { n: number }
      ).n;
      const scenes = (
        db.prepare('SELECT COUNT(*) AS n FROM scenes').get() as { n: number }
      ).n;
      return { notes, entities, scenes };
    },

    /**
     * Rebuild FTS tables from source tables (F708).
     * FTS5 'rebuild' command regenerates the index from the content= source.
     */
    rebuildAll(): void {
      db.exec(`INSERT INTO fts_notes(fts_notes) VALUES('rebuild')`);
      db.exec(`INSERT INTO fts_scenes(fts_scenes) VALUES('rebuild')`);
      db.exec(`INSERT INTO fts_entities(fts_entities) VALUES('rebuild')`);
    },
  };
}

export type SearchRepo = ReturnType<typeof searchRepo>;
