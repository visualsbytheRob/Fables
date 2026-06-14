import type { Migration } from './index.js';

/**
 * Canvas connectors (Epic 16, F1521 edges, F1523 semantics).
 *
 * Edges between canvas objects. `kind` is the connection type ('line' is purely
 * visual; 'link' between two note cards materializes a real link in the graph,
 * F1523). Style/label/data carry presentation. Deleting an object or canvas
 * cascades to its edges.
 */
export const migration029CanvasEdges: Migration = {
  id: 29,
  name: 'canvas-edges',
  sql: /* sql */ `
    CREATE TABLE canvas_edges (
      canvas_id  TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
      id         TEXT NOT NULL,
      from_id    TEXT NOT NULL,
      to_id      TEXT NOT NULL,
      kind       TEXT NOT NULL DEFAULT 'line',
      label      TEXT NOT NULL DEFAULT '',
      style      TEXT NOT NULL DEFAULT 'curved',
      data       TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (canvas_id, id)
    );

    CREATE INDEX idx_canvas_edges_canvas ON canvas_edges (canvas_id);
  `,
};
