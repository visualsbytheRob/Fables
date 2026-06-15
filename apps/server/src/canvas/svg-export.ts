/**
 * SVG export for canvas objects and edges (F1593).
 *
 * Produces a standalone, well-formed SVG string from a set of ObjectDraft
 * items and EdgeDraft connectors. Pure — no FS, no DB.
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
// Colour palette per kind
// ---------------------------------------------------------------------------

const KIND_FILL: Record<string, string> = {
  note: '#fffde7',
  entity: '#e8f5e9',
  text: '#f5f5f5',
  sticky: '#fff9c4',
  image: '#e3f2fd',
  query: '#fce4ec',
  embed: '#e8eaf6',
  shape: '#f3e5f5',
  knot: '#e0f7fa',
  group: '#fafafa',
};

const DEFAULT_FILL = '#ffffff';
const STROKE_COLOR = '#555555';
const EDGE_COLOR = '#888888';
const TEXT_COLOR = '#222222';
const CORNER_RADIUS = 6;
const FONT_SIZE = 12;
const FONT_FAMILY = 'sans-serif';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** HTML-escape a string so it is safe to embed in XML text content or attributes. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Extract a human-readable label from an object's data payload. */
function objectLabel(obj: ObjectDraft): string | null {
  const d = obj.data;
  if (d === undefined) return null;
  for (const key of ['text', 'knot', 'file', 'label', 'url']) {
    const v = d[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Render a Fables canvas as a standalone SVG string (F1593).
 *
 * @param objects  Canvas objects to draw.
 * @param edges    Connectors between objects (looked up by id).
 * @param opts     Optional rendering options.
 */
export function exportCanvasSvg(
  objects: ObjectDraft[],
  edges: EdgeDraft[],
  opts?: { padding?: number },
): string {
  const padding = opts?.padding ?? 20;

  // Empty input → minimal valid SVG
  if (objects.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" viewBox="0 0 0 0"></svg>`;
  }

  // Compute bounding box
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const o of objects) {
    if (o.x < minX) minX = o.x;
    if (o.y < minY) minY = o.y;
    if (o.x + o.width > maxX) maxX = o.x + o.width;
    if (o.y + o.height > maxY) maxY = o.y + o.height;
  }

  const vx = minX - padding;
  const vy = minY - padding;
  const vw = maxX - minX + padding * 2;
  const vh = maxY - minY + padding * 2;

  // Index objects by id for edge lookup
  const byId = new Map<string, ObjectDraft>();
  for (const o of objects) {
    if (o.id !== undefined) byId.set(o.id, o);
  }

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}" viewBox="${vx} ${vy} ${vw} ${vh}">`,
  );

  // Draw edges first (behind objects)
  for (const edge of edges) {
    const from = byId.get(edge.fromId);
    const to = byId.get(edge.toId);
    if (from === undefined || to === undefined) continue;

    const x1 = from.x + from.width / 2;
    const y1 = from.y + from.height / 2;
    const x2 = to.x + to.width / 2;
    const y2 = to.y + to.height / 2;

    parts.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${EDGE_COLOR}" stroke-width="1.5" stroke-dasharray="4 2"/>`,
    );
  }

  // Draw objects
  for (const obj of objects) {
    const fill = KIND_FILL[obj.kind] ?? DEFAULT_FILL;
    parts.push(
      `<rect x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" rx="${CORNER_RADIUS}" ry="${CORNER_RADIUS}" fill="${fill}" stroke="${STROKE_COLOR}" stroke-width="1"/>`,
    );

    const label = objectLabel(obj);
    if (label !== null) {
      const cx = obj.x + obj.width / 2;
      const cy = obj.y + obj.height / 2;
      parts.push(
        `<text x="${cx}" y="${cy}" dominant-baseline="middle" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE}" fill="${TEXT_COLOR}">${escapeXml(label)}</text>`,
      );
    }
  }

  parts.push('</svg>');
  return parts.join('\n');
}
