import type { Migration } from './index.js';

/**
 * Canvas documents (Epic 16, F1502 model, F1508 persistence).
 *
 * A canvas is an infinite 2-D surface of objects (note/entity/text/image/query/
 * shape/group cards). Objects carry a bounding box (x/y/width/height), a z-order,
 * rotation, lock state, an optional parent group, and a kind-specific JSON
 * payload. Stored relationally (not one big blob) so spatial bbox queries and
 * partial autosaves stay cheap at scale.
 */
export const migration028Canvas: Migration = {
  id: 28,
  name: 'canvas',
  sql: /* sql */ `
    CREATE TABLE canvases (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE canvas_objects (
      canvas_id  TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
      id         TEXT NOT NULL,
      kind       TEXT NOT NULL,
      x          REAL NOT NULL,
      y          REAL NOT NULL,
      width      REAL NOT NULL,
      height     REAL NOT NULL,
      z          INTEGER NOT NULL DEFAULT 0,
      rotation   REAL NOT NULL DEFAULT 0,
      locked     INTEGER NOT NULL DEFAULT 0,
      group_id   TEXT,
      data       TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (canvas_id, id)
    );

    CREATE INDEX idx_canvas_objects_canvas ON canvas_objects (canvas_id, z);
  `,
};
