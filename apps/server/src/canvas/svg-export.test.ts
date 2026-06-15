import { describe, it, expect } from 'vitest';
import { exportCanvasSvg, type ObjectDraft, type EdgeDraft } from './svg-export.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRect(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  kind = 'shape',
  data?: Record<string, unknown>,
): ObjectDraft {
  return { id, kind, x, y, width: w, height: h, ...(data !== undefined ? { data } : {}) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('exportCanvasSvg', () => {
  it('returns a minimal valid SVG for empty input', () => {
    const svg = exportCanvasSvg([], []);
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toMatch(/<\/svg>$/);
  });

  it('produces two <rect> elements for two objects', () => {
    const objects: ObjectDraft[] = [makeRect('a', 0, 0, 100, 60), makeRect('b', 200, 0, 100, 60)];
    const svg = exportCanvasSvg(objects, []);
    const rectMatches = svg.match(/<rect /g) ?? [];
    expect(rectMatches).toHaveLength(2);
  });

  it('produces one <line> element for one edge', () => {
    const objects: ObjectDraft[] = [makeRect('a', 0, 0, 100, 60), makeRect('b', 200, 0, 100, 60)];
    const edges: EdgeDraft[] = [{ fromId: 'a', toId: 'b', kind: 'line' }];
    const svg = exportCanvasSvg(objects, edges);
    const lineMatches = svg.match(/<line /g) ?? [];
    expect(lineMatches).toHaveLength(1);
  });

  it('connects edge to object centers', () => {
    const objects: ObjectDraft[] = [makeRect('a', 0, 0, 100, 60), makeRect('b', 200, 40, 100, 60)];
    const edges: EdgeDraft[] = [{ fromId: 'a', toId: 'b' }];
    const svg = exportCanvasSvg(objects, edges);
    // center of a: (50, 30); center of b: (250, 70)
    expect(svg).toContain('x1="50"');
    expect(svg).toContain('y1="30"');
    expect(svg).toContain('x2="250"');
    expect(svg).toContain('y2="70"');
  });

  it('includes a label <text> element when data.text is set', () => {
    const objects: ObjectDraft[] = [makeRect('a', 0, 0, 100, 60, 'text', { text: 'Hello' })];
    const svg = exportCanvasSvg(objects, []);
    expect(svg).toContain('<text ');
    expect(svg).toContain('Hello');
  });

  it('HTML-escapes special chars in labels', () => {
    const objects: ObjectDraft[] = [
      makeRect('a', 0, 0, 100, 60, 'text', { text: '<b> & "quote" \'apos\'' }),
    ];
    const svg = exportCanvasSvg(objects, []);
    expect(svg).toContain('&lt;b&gt;');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&quot;quote&quot;');
    expect(svg).toContain('&apos;apos&apos;');
    // raw chars must not appear
    expect(svg).not.toContain('<b>');
    expect(svg).not.toContain(' & ');
  });

  it('produces a sensible viewBox based on object positions', () => {
    const objects: ObjectDraft[] = [makeRect('a', 10, 20, 100, 50)];
    const svg = exportCanvasSvg(objects, [], { padding: 10 });
    // viewBox should be x=0, y=10, w=120, h=70 (10-10=0, 20-10=10, 100+20=120, 50+20=70)
    expect(svg).toContain('viewBox="0 10 120 70"');
  });

  it('uses default padding of 20 when opts omitted', () => {
    const objects: ObjectDraft[] = [makeRect('a', 0, 0, 100, 50)];
    const svg = exportCanvasSvg(objects, []);
    // viewBox x = 0-20 = -20, y = 0-20 = -20, w=140, h=90
    expect(svg).toContain('viewBox="-20 -20 140 90"');
  });

  it('skips edges whose endpoints are not in the object list', () => {
    const objects: ObjectDraft[] = [makeRect('a', 0, 0, 100, 60)];
    const edges: EdgeDraft[] = [{ fromId: 'a', toId: 'missing' }];
    const svg = exportCanvasSvg(objects, edges);
    expect(svg).not.toContain('<line');
  });

  it('applies different fills for different kinds', () => {
    const objects: ObjectDraft[] = [
      makeRect('a', 0, 0, 100, 60, 'note'),
      makeRect('b', 200, 0, 100, 60, 'sticky'),
    ];
    const svg = exportCanvasSvg(objects, []);
    // Both should have fill attributes (not necessarily the same)
    const fills = [...svg.matchAll(/fill="(#[0-9a-f]+)"/gi)].map((m) => m[1]);
    expect(fills.length).toBeGreaterThanOrEqual(2);
  });

  it('renders data.knot as label', () => {
    const objects: ObjectDraft[] = [makeRect('k1', 0, 0, 200, 90, 'knot', { knot: 'intro' })];
    const svg = exportCanvasSvg(objects, []);
    expect(svg).toContain('intro');
  });

  it('well-formed: starts with <svg and ends with </svg>', () => {
    const svg = exportCanvasSvg([makeRect('x', 0, 0, 50, 50)], []);
    expect(svg.trimStart()).toMatch(/^<svg /);
    expect(svg.trimEnd()).toMatch(/<\/svg>$/);
  });
});
