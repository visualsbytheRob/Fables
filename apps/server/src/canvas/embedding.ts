/**
 * Canvas embedding & linking (F1562 deep links, F1563 note→canvas backlinks,
 * F1567 canvas object search).
 *
 * Bridges the spatial canvas back into the rest of the vault: find every canvas a
 * note is placed on, search objects across all canvases, and encode/decode deep
 * links that fly to a specific region.
 */

import type { Db } from '../db/connection.js';
import type { BBox } from './spatial-index.js';

// ── Note → canvas backlinks (F1563) ──────────────────────────────────────────

export interface CanvasPlacement {
  canvasId: string;
  canvasName: string;
  objectId: string;
}

/** Every canvas (and object) where a given note is placed as a card (F1563). */
export function noteCanvasPlacements(db: Db, noteId: string): CanvasPlacement[] {
  const rows = db
    .prepare(
      `SELECT o.canvas_id AS canvas_id, o.id AS object_id, c.name AS canvas_name
       FROM canvas_objects o
       JOIN canvases c ON c.id = o.canvas_id
       WHERE o.kind = 'note' AND json_extract(o.data, '$.noteId') = ?
       ORDER BY c.updated_at DESC`,
    )
    .all(noteId) as { canvas_id: string; object_id: string; canvas_name: string }[];
  return rows.map((r) => ({
    canvasId: r.canvas_id,
    canvasName: r.canvas_name,
    objectId: r.object_id,
  }));
}

// ── Canvas object search (F1567) ─────────────────────────────────────────────

export interface CanvasSearchHit {
  canvasId: string;
  objectId: string;
  kind: string;
  /** Best-effort text label of the matched object. */
  label: string;
}

/** Find objects whose text/knot/file payload matches a query, across all canvases (F1567). */
export function searchCanvasObjects(db: Db, query: string, limit = 50): CanvasSearchHit[] {
  const q = query.trim();
  if (q === '') return [];
  const like = `%${q.toLowerCase()}%`;
  const rows = db
    .prepare(
      `SELECT canvas_id, id, kind,
              COALESCE(json_extract(data, '$.text'),
                       json_extract(data, '$.knot'),
                       json_extract(data, '$.file'), '') AS label
       FROM canvas_objects
       WHERE lower(COALESCE(json_extract(data, '$.text'), '')
                || ' ' || COALESCE(json_extract(data, '$.knot'), '')
                || ' ' || COALESCE(json_extract(data, '$.file'), '')) LIKE ?
       LIMIT ?`,
    )
    .all(like, limit) as { canvas_id: string; id: string; kind: string; label: string }[];
  return rows.map((r) => ({
    canvasId: r.canvas_id,
    objectId: r.id,
    kind: r.kind,
    label: r.label,
  }));
}

// ── Deep links (F1562) ───────────────────────────────────────────────────────

/** Encode a deep link to a canvas region (F1562): `canvas/<id>#region=minX,minY,maxX,maxY`. */
export function encodeCanvasDeepLink(canvasId: string, region?: BBox): string {
  const base = `canvas/${canvasId}`;
  if (!region) return base;
  const r = [region.minX, region.minY, region.maxX, region.maxY].map((n) => Math.round(n));
  return `${base}#region=${r.join(',')}`;
}

export interface ParsedDeepLink {
  canvasId: string;
  region?: BBox;
}

/** Parse a canvas deep link back into a canvas id + optional region (F1562). */
export function decodeCanvasDeepLink(link: string): ParsedDeepLink | null {
  const m = /^canvas\/([^#]+)(?:#region=(-?\d+),(-?\d+),(-?\d+),(-?\d+))?$/.exec(link.trim());
  if (!m) return null;
  const result: ParsedDeepLink = { canvasId: m[1]! };
  if (m[2] !== undefined) {
    result.region = {
      minX: Number(m[2]),
      minY: Number(m[3]),
      maxX: Number(m[4]),
      maxY: Number(m[5]),
    };
  }
  return result;
}
