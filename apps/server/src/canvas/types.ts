/**
 * Canvas domain types (Epic 16, F1502).
 *
 * A canvas object is a positioned card on the infinite surface: a bounding box,
 * a z-order, rotation, lock state, an optional parent group, and a kind-specific
 * JSON payload (which note it shows, its text, color, the FQL of a query card, …).
 */

import type { BBox } from './spatial-index.js';

export type CanvasObjectKind =
  | 'note' // live note card
  | 'entity' // entity card with fields
  | 'text' // canvas-native text label
  | 'sticky' // sticky note
  | 'image' // image/media
  | 'query' // live FQL result card
  | 'embed' // clipped web page
  | 'shape' // rect/ellipse/line/arrow
  | 'knot' // story knot (compiler-synced)
  | 'group'; // grouping container

export interface CanvasObject {
  id: string;
  kind: CanvasObjectKind;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  rotation: number;
  locked: boolean;
  /** Parent group object id, or null when top-level (F1506). */
  groupId: string | null;
  /** Kind-specific payload (noteId, text, color, fql, …). */
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Canvas {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** Axis-aligned bounding box of an object (rotation ignored for indexing). */
export function objectBBox(o: Pick<CanvasObject, 'x' | 'y' | 'width' | 'height'>): BBox {
  return { minX: o.x, minY: o.y, maxX: o.x + o.width, maxY: o.y + o.height };
}
