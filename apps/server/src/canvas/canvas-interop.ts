/**
 * Foreign canvas import (F1594).
 *
 * Converts Obsidian Canvas (.canvas) and Excalidraw JSON into Fables
 * ObjectDraft / EdgeDraft arrays. Pure — no FS, no DB.
 */

export interface ObjectDraft {
  id?: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z?: number;
  data?: Record<string, unknown>;
}

export interface EdgeDraft {
  fromId: string;
  toId: string;
  kind?: string;
  label?: string;
}

// ---------------------------------------------------------------------------
// Obsidian Canvas
// ---------------------------------------------------------------------------

interface ObsidianNode {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  file?: string;
  url?: string;
  label?: string;
}

interface ObsidianEdge {
  id: string;
  fromNode: string;
  toNode: string;
  label?: string;
}

interface ObsidianCanvas {
  nodes: ObsidianNode[];
  edges?: ObsidianEdge[];
}

/**
 * Parse an Obsidian `.canvas` JSON string into Fables objects and edges.
 * Throws on invalid JSON or missing `nodes`.
 */
export function importObsidianCanvas(json: string): {
  objects: ObjectDraft[];
  edges: EdgeDraft[];
} {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('importObsidianCanvas: invalid JSON');
  }

  if (
    raw === null ||
    typeof raw !== 'object' ||
    !('nodes' in raw) ||
    !Array.isArray((raw as Record<string, unknown>)['nodes'])
  ) {
    throw new Error('importObsidianCanvas: missing or invalid "nodes" array');
  }

  const doc = raw as ObsidianCanvas;

  const objects: ObjectDraft[] = doc.nodes.map((node) => {
    let kind: string;
    const data: Record<string, unknown> = {};

    switch (node.type) {
      case 'text':
        kind = 'text';
        if (node.text !== undefined) data['text'] = node.text;
        break;
      case 'file':
        kind = 'note';
        if (node.file !== undefined) data['file'] = node.file;
        break;
      case 'link':
        kind = 'embed';
        if (node.url !== undefined) data['url'] = node.url;
        break;
      case 'group':
        kind = 'group';
        if (node.label !== undefined) data['label'] = node.label;
        break;
      default:
        kind = 'text';
    }

    const obj: ObjectDraft = {
      id: node.id,
      kind,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    };
    if (Object.keys(data).length > 0) obj.data = data;
    return obj;
  });

  const edges: EdgeDraft[] = (doc.edges ?? []).map((e) => {
    const edge: EdgeDraft = {
      fromId: e.fromNode,
      toId: e.toNode,
      kind: 'line',
    };
    if (e.label !== undefined) edge.label = e.label;
    return edge;
  });

  return { objects, edges };
}

// ---------------------------------------------------------------------------
// Excalidraw
// ---------------------------------------------------------------------------

interface ExcalidrawElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  isDeleted?: boolean;
  startBinding?: { elementId: string };
  endBinding?: { elementId: string };
}

interface ExcalidrawDoc {
  type: string;
  elements: ExcalidrawElement[];
}

/**
 * Parse an Excalidraw JSON string into Fables objects and edges.
 * Throws on invalid JSON or missing `type`/`elements`.
 */
export function importExcalidraw(json: string): {
  objects: ObjectDraft[];
  edges: EdgeDraft[];
} {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('importExcalidraw: invalid JSON');
  }

  if (
    raw === null ||
    typeof raw !== 'object' ||
    !('elements' in raw) ||
    !Array.isArray((raw as Record<string, unknown>)['elements'])
  ) {
    throw new Error('importExcalidraw: missing or invalid "elements" array');
  }

  const doc = raw as ExcalidrawDoc;

  const objects: ObjectDraft[] = [];
  const edges: EdgeDraft[] = [];

  for (const el of doc.elements) {
    // Skip deleted elements
    if (el.isDeleted === true) continue;

    // Normalize possibly-negative width/height from Excalidraw
    let x = el.x;
    let y = el.y;
    let width = el.width;
    let height = el.height;
    if (width < 0) {
      x = x + width;
      width = -width;
    }
    if (height < 0) {
      y = y + height;
      height = -height;
    }

    const type = el.type;

    // Arrow/line with bindings → EdgeDraft
    if (type === 'arrow' || type === 'line') {
      const fromId = el.startBinding?.elementId;
      const toId = el.endBinding?.elementId;
      if (fromId !== undefined && toId !== undefined) {
        edges.push({ fromId, toId, kind: 'line' });
      }
      // Skip as object regardless (bound arrows don't appear as canvas objects)
      continue;
    }

    // Shape elements
    let kind: string;
    const data: Record<string, unknown> = {};

    switch (type) {
      case 'rectangle':
      case 'ellipse':
      case 'diamond':
        kind = 'shape';
        data['shape'] = type;
        break;
      case 'text':
        kind = 'text';
        if (el.text !== undefined) data['text'] = el.text;
        break;
      case 'image':
        kind = 'image';
        break;
      default:
        // Unknown element types are imported as shape
        kind = 'shape';
        data['shape'] = type;
    }

    const obj: ObjectDraft = { id: el.id, kind, x, y, width, height };
    if (Object.keys(data).length > 0) obj.data = data;
    objects.push(obj);
  }

  return { objects, edges };
}
