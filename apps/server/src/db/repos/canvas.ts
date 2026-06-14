/**
 * Canvas repository (Epic 16, F1502 model, F1508 persistence).
 *
 * Canvases and their objects. `replaceObjects` is the autosave path (snapshot the
 * whole object set in one transaction); `objectsInRegion` is the DB-level bbox
 * query that backs viewport culling before the in-memory spatial index refines it.
 */

import { nowIso } from '@fables/core';
import type { Db } from '../connection.js';
import type { BBox } from '../../canvas/spatial-index.js';
import type { Canvas, CanvasObject, CanvasObjectKind } from '../../canvas/types.js';

interface CanvasRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface ObjectRow {
  id: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  rotation: number;
  locked: number;
  group_id: string | null;
  data: string;
  created_at: string;
  updated_at: string;
}

const toCanvas = (r: CanvasRow): Canvas => ({
  id: r.id,
  name: r.name,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toObject = (r: ObjectRow): CanvasObject => ({
  id: r.id,
  kind: r.kind as CanvasObjectKind,
  x: r.x,
  y: r.y,
  width: r.width,
  height: r.height,
  z: r.z,
  rotation: r.rotation,
  locked: r.locked === 1,
  groupId: r.group_id,
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

const newCanvasId = (): string => `cnv_${crypto.randomUUID()}`;

export interface ObjectInput {
  id?: string | undefined;
  kind: CanvasObjectKind;
  x: number;
  y: number;
  width: number;
  height: number;
  z?: number | undefined;
  rotation?: number | undefined;
  locked?: boolean | undefined;
  groupId?: string | null | undefined;
  data?: Record<string, unknown> | undefined;
}

export function canvasRepo(db: Db) {
  return {
    create(name: string): Canvas {
      const now = nowIso();
      const canvas: Canvas = { id: newCanvasId(), name, createdAt: now, updatedAt: now };
      db.prepare('INSERT INTO canvases (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
        canvas.id,
        canvas.name,
        canvas.createdAt,
        canvas.updatedAt,
      );
      return canvas;
    },

    get(id: string): Canvas | null {
      const row = db.prepare('SELECT * FROM canvases WHERE id = ?').get(id) as
        | CanvasRow
        | undefined;
      return row ? toCanvas(row) : null;
    },

    list(): Canvas[] {
      return (
        db.prepare('SELECT * FROM canvases ORDER BY updated_at DESC').all() as CanvasRow[]
      ).map(toCanvas);
    },

    rename(id: string, name: string): void {
      db.prepare('UPDATE canvases SET name = ?, updated_at = ? WHERE id = ?').run(
        name,
        nowIso(),
        id,
      );
    },

    remove(id: string): boolean {
      return db.prepare('DELETE FROM canvases WHERE id = ?').run(id).changes > 0;
    },

    listObjects(canvasId: string): CanvasObject[] {
      return (
        db
          .prepare('SELECT * FROM canvas_objects WHERE canvas_id = ? ORDER BY z')
          .all(canvasId) as ObjectRow[]
      ).map(toObject);
    },

    /** Objects whose bbox intersects a viewport region (DB-level cull, F1503). */
    objectsInRegion(canvasId: string, region: BBox): CanvasObject[] {
      return (
        db
          .prepare(
            `SELECT * FROM canvas_objects
             WHERE canvas_id = ?
               AND x <= ? AND (x + width) >= ?
               AND y <= ? AND (y + height) >= ?
             ORDER BY z`,
          )
          .all(canvasId, region.maxX, region.minX, region.maxY, region.minY) as ObjectRow[]
      ).map(toObject);
    },

    /** Snapshot the full object set in one transaction — the autosave path (F1508). */
    replaceObjects(canvasId: string, objects: ObjectInput[]): number {
      const now = nowIso();
      const del = db.prepare('DELETE FROM canvas_objects WHERE canvas_id = ?');
      const ins = db.prepare(
        `INSERT INTO canvas_objects
           (canvas_id, id, kind, x, y, width, height, z, rotation, locked, group_id, data, created_at, updated_at)
         VALUES (@canvas_id, @id, @kind, @x, @y, @width, @height, @z, @rotation, @locked, @group_id, @data, @created_at, @updated_at)`,
      );
      const tx = db.transaction((rows: ObjectInput[]) => {
        del.run(canvasId);
        for (const o of rows) {
          ins.run({
            canvas_id: canvasId,
            id: o.id ?? `obj_${crypto.randomUUID()}`,
            kind: o.kind,
            x: o.x,
            y: o.y,
            width: o.width,
            height: o.height,
            z: o.z ?? 0,
            rotation: o.rotation ?? 0,
            locked: o.locked ? 1 : 0,
            group_id: o.groupId ?? null,
            data: JSON.stringify(o.data ?? {}),
            created_at: now,
            updated_at: now,
          });
        }
        db.prepare('UPDATE canvases SET updated_at = ? WHERE id = ?').run(now, canvasId);
      });
      tx(objects);
      return objects.length;
    },
  };
}

export type CanvasRepo = ReturnType<typeof canvasRepo>;
