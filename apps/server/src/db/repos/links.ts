import { newLinkId, nowIso, type LinkId, type NoteId } from '@fables/core';
import type { Db } from '../connection.js';

export type LinkKind = 'wikilink' | 'mention' | 'binding' | 'relation';

export interface Link {
  id: LinkId;
  kind: LinkKind;
  sourceType: string;
  sourceId: string;
  targetType: string;
  /** Empty string while the link is broken (unresolved title). */
  targetId: string;
  /** JS-lowercased title text as written by the source. */
  targetTitle: string;
  targetHeading: string | null;
  targetBlock: string | null;
  /** Match offset in the source body (UTF-16 code units). */
  position: number;
  /** Match length in the source body. */
  length: number;
  broken: boolean;
  createdAt: string;
}

export type NewLink = Omit<Link, 'id' | 'createdAt' | 'sourceType' | 'sourceId' | 'targetType'>;

interface Row {
  id: string;
  kind: string;
  source_type: string;
  source_id: string;
  target_type: string;
  target_id: string;
  target_title: string;
  target_heading: string | null;
  target_block: string | null;
  position: number;
  length: number;
  broken: number;
  created_at: string;
}

function toLink(row: Row): Link {
  return {
    id: row.id as LinkId,
    kind: row.kind as LinkKind,
    sourceType: row.source_type,
    sourceId: row.source_id,
    targetType: row.target_type,
    targetId: row.target_id,
    targetTitle: row.target_title,
    targetHeading: row.target_heading,
    targetBlock: row.target_block,
    position: row.position,
    length: row.length,
    broken: row.broken === 1,
    createdAt: row.created_at,
  };
}

/** Backlink/mention row joined with its (live) source note. */
export interface IncomingLink extends Link {
  sourceTitle: string;
  sourceNotebookId: string;
  sourceUpdatedAt: string;
  sourceBody: string;
}

function toIncoming(row: Row & SourceColumns): IncomingLink {
  return {
    ...toLink(row),
    sourceTitle: row.source_title,
    sourceNotebookId: row.source_notebook_id,
    sourceUpdatedAt: row.source_updated_at,
    sourceBody: row.source_body,
  };
}

interface SourceColumns {
  source_title: string;
  source_notebook_id: string;
  source_updated_at: string;
  source_body: string;
}

const INCOMING_SQL = /* sql */ `
  SELECT l.*, n.title AS source_title, n.notebook_id AS source_notebook_id,
         n.updated_at AS source_updated_at, n.body AS source_body
  FROM links l
  JOIN notes n ON n.id = l.source_id AND n.trashed_at IS NULL
  WHERE l.kind = ? AND l.target_id = ? AND l.source_type = 'note'
  ORDER BY n.updated_at DESC, l.source_id, l.position`;

export interface GraphEdgeRow {
  sourceId: string;
  targetId: string;
  kind: LinkKind;
  weight: number;
}

export function linksRepo(db: Db) {
  return {
    /**
     * Atomically replaces every `kind` row owned by a source note (F202).
     * Callers wrap this in the note-save transaction.
     */
    replaceForSource(sourceId: NoteId, kind: LinkKind, rows: NewLink[]): void {
      db.prepare(`DELETE FROM links WHERE source_type = 'note' AND source_id = ? AND kind = ?`).run(
        sourceId,
        kind,
      );
      const insert = db.prepare(
        `INSERT INTO links (id, kind, source_type, source_id, target_type, target_id,
                            target_title, target_heading, target_block, position, length, broken, created_at)
         VALUES (?, ?, 'note', ?, 'note', ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const now = nowIso();
      for (const row of rows) {
        insert.run(
          newLinkId(),
          row.kind,
          sourceId,
          row.targetId,
          row.targetTitle,
          row.targetHeading,
          row.targetBlock,
          row.position,
          row.length,
          row.broken ? 1 : 0,
          now,
        );
      }
    },

    get(id: LinkId): Link | null {
      const row = db.prepare('SELECT * FROM links WHERE id = ?').get(id) as Row | undefined;
      return row ? toLink(row) : null;
    },

    listBySource(sourceId: NoteId, kind?: LinkKind): Link[] {
      const rows = (
        kind === undefined
          ? db
              .prepare(
                `SELECT * FROM links WHERE source_type = 'note' AND source_id = ? ORDER BY position`,
              )
              .all(sourceId)
          : db
              .prepare(
                `SELECT * FROM links WHERE source_type = 'note' AND source_id = ? AND kind = ? ORDER BY position`,
              )
              .all(sourceId, kind)
      ) as Row[];
      return rows.map(toLink);
    },

    /** Incoming links of one kind with live source-note context, newest source first (F211, F217). */
    incoming(targetId: NoteId, kind: LinkKind): IncomingLink[] {
      const rows = db.prepare(INCOMING_SQL).all(kind, targetId) as (Row & SourceColumns)[];
      return rows.map(toIncoming);
    },

    /** Distinct live source notes that wikilink to `targetId` (rename propagation, F209). */
    sourceIdsLinkingTo(targetId: NoteId): NoteId[] {
      const rows = db
        .prepare(
          `SELECT DISTINCT l.source_id FROM links l
           JOIN notes n ON n.id = l.source_id AND n.trashed_at IS NULL
           WHERE l.kind = 'wikilink' AND l.target_id = ? AND l.source_type = 'note'`,
        )
        .all(targetId) as { source_id: string }[];
      return rows.map((r) => r.source_id as NoteId);
    },

    /** Re-points broken wikilinks written as `titleLc` at a (new) note (F206). */
    resolveBrokenByTitle(titleLc: string, targetId: NoteId): number {
      return db
        .prepare(
          `UPDATE links SET target_id = ?, broken = 0
           WHERE kind = 'wikilink' AND broken = 1 AND target_title = ?`,
        )
        .run(targetId, titleLc).changes;
    },

    deleteMentionsTargeting(targetId: NoteId): number {
      return db.prepare(`DELETE FROM links WHERE kind = 'mention' AND target_id = ?`).run(targetId)
        .changes;
    },

    /**
     * Link-integrity sweep (F219): drops rows whose source note is gone,
     * re-breaks wikilinks whose target note is gone (keeping `target_title`
     * so they can re-resolve), and drops mentions of deleted notes.
     */
    cleanupOrphans(): { removedSources: number; brokenTargets: number; removedMentions: number } {
      const removedSources = db
        .prepare(
          `DELETE FROM links WHERE source_type = 'note'
           AND source_id NOT IN (SELECT id FROM notes)`,
        )
        .run().changes;
      const brokenTargets = db
        .prepare(
          `UPDATE links SET target_id = '', broken = 1
           WHERE kind = 'wikilink' AND target_type = 'note' AND target_id != ''
           AND target_id NOT IN (SELECT id FROM notes)`,
        )
        .run().changes;
      const removedMentions = db
        .prepare(
          `DELETE FROM links WHERE kind = 'mention' AND target_type = 'note'
           AND target_id NOT IN (SELECT id FROM notes)`,
        )
        .run().changes;
      return { removedSources, brokenTargets, removedMentions };
    },

    /**
     * Resolved note→note edges between live notes, collapsed per
     * (source, target, kind) with a link-count weight (F231, F237).
     */
    graphEdges(kinds: LinkKind[]): GraphEdgeRow[] {
      if (kinds.length === 0) return [];
      const placeholders = kinds.map(() => '?').join(', ');
      const rows = db
        .prepare(
          `SELECT l.source_id, l.target_id, l.kind, COUNT(*) AS weight
           FROM links l
           JOIN notes s ON s.id = l.source_id AND s.trashed_at IS NULL
           JOIN notes t ON t.id = l.target_id AND t.trashed_at IS NULL
           WHERE l.broken = 0 AND l.source_type = 'note' AND l.target_type = 'note'
             AND l.kind IN (${placeholders})
           GROUP BY l.source_id, l.target_id, l.kind
           ORDER BY l.source_id, l.target_id, l.kind`,
        )
        .all(...kinds) as { source_id: string; target_id: string; kind: string; weight: number }[];
      return rows.map((r) => ({
        sourceId: r.source_id,
        targetId: r.target_id,
        kind: r.kind as LinkKind,
        weight: r.weight,
      }));
    },
  };
}

export type LinksRepo = ReturnType<typeof linksRepo>;
