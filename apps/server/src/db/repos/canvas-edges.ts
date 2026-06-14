/**
 * Canvas edges repository (Epic 16, F1521).
 *
 * Connectors between canvas objects. The runner-level semantics (a 'link' edge
 * creating a real graph link) live in `canvas/connections.ts`; this is plain CRUD.
 */

import { nowIso } from '@fables/core';
import type { Db } from '../connection.js';

export type EdgeStyle = 'curved' | 'orthogonal' | 'straight';

export interface CanvasEdge {
  id: string;
  fromId: string;
  toId: string;
  kind: string;
  label: string;
  style: EdgeStyle;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  from_id: string;
  to_id: string;
  kind: string;
  label: string;
  style: string;
  data: string;
  created_at: string;
  updated_at: string;
}

const toEdge = (r: Row): CanvasEdge => ({
  id: r.id,
  fromId: r.from_id,
  toId: r.to_id,
  kind: r.kind,
  label: r.label,
  style: r.style as EdgeStyle,
  data: safeParse(r.data),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function safeParse(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const newEdgeId = (): string => `edg_${crypto.randomUUID()}`;

export interface EdgeInput {
  fromId: string;
  toId: string;
  kind?: string;
  label?: string;
  style?: EdgeStyle;
  data?: Record<string, unknown>;
}

export function canvasEdgesRepo(db: Db) {
  return {
    list(canvasId: string): CanvasEdge[] {
      return (
        db
          .prepare('SELECT * FROM canvas_edges WHERE canvas_id = ? ORDER BY created_at')
          .all(canvasId) as Row[]
      ).map(toEdge);
    },

    create(canvasId: string, input: EdgeInput): CanvasEdge {
      const now = nowIso();
      const edge: CanvasEdge = {
        id: newEdgeId(),
        fromId: input.fromId,
        toId: input.toId,
        kind: input.kind ?? 'line',
        label: input.label ?? '',
        style: input.style ?? 'curved',
        data: input.data ?? {},
        createdAt: now,
        updatedAt: now,
      };
      db.prepare(
        `INSERT INTO canvas_edges (canvas_id, id, from_id, to_id, kind, label, style, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        canvasId,
        edge.id,
        edge.fromId,
        edge.toId,
        edge.kind,
        edge.label,
        edge.style,
        JSON.stringify(edge.data),
        edge.createdAt,
        edge.updatedAt,
      );
      return edge;
    },

    remove(canvasId: string, id: string): boolean {
      return (
        db.prepare('DELETE FROM canvas_edges WHERE canvas_id = ? AND id = ?').run(canvasId, id)
          .changes > 0
      );
    },
  };
}

export type CanvasEdgesRepo = ReturnType<typeof canvasEdgesRepo>;
