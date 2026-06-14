/**
 * Tests for canvas graph auto-layout algorithms (F1524).
 */

import { describe, it, expect } from 'vitest';
import {
  gridLayout,
  treeLayout,
  forceLayout,
  type LayoutNode,
  type LayoutEdge,
  type Layout,
} from './layout.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Assert that no two node rectangles overlap (axis-aligned). */
function assertNoOverlaps(nodes: LayoutNode[], layout: Layout): void {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      const pa = layout.get(a.id)!;
      const pb = layout.get(b.id)!;
      const aRight = pa.x + a.width;
      const bRight = pb.x + b.width;
      const aBottom = pa.y + a.height;
      const bBottom = pb.y + b.height;
      const overlaps = pa.x < bRight && aRight > pb.x && pa.y < bBottom && aBottom > pb.y;
      if (overlaps) {
        throw new Error(
          `Nodes ${a.id} and ${b.id} overlap: ` +
            `[${pa.x},${pa.y},${aRight},${aBottom}] vs [${pb.x},${pb.y},${bRight},${bBottom}]`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// gridLayout
// ---------------------------------------------------------------------------

describe('gridLayout', () => {
  const nodes: LayoutNode[] = [
    { id: 'a', width: 100, height: 60 },
    { id: 'b', width: 100, height: 60 },
    { id: 'c', width: 100, height: 60 },
    { id: 'd', width: 100, height: 60 },
  ];

  it('produces a 2x2 arrangement with correct gaps', () => {
    const layout = gridLayout(nodes, { columns: 2, gap: 20 });

    // Row 0
    expect(layout.get('a')).toEqual({ x: 0, y: 0 });
    expect(layout.get('b')).toEqual({ x: 120, y: 0 }); // 100 + 20
    // Row 1
    expect(layout.get('c')).toEqual({ x: 0, y: 80 }); // 60 + 20
    expect(layout.get('d')).toEqual({ x: 120, y: 80 });
  });

  it('has no overlapping rectangles', () => {
    const layout = gridLayout(nodes, { columns: 2, gap: 20 });
    assertNoOverlaps(nodes, layout);
  });

  it('defaults columns to ceil(sqrt(n))', () => {
    // 4 nodes → 2 columns
    const layout = gridLayout(nodes);
    const posA = layout.get('a')!;
    const posB = layout.get('b')!;
    const posC = layout.get('c')!;
    // a and b should be in the same row (same y)
    expect(posA.y).toBe(posB.y);
    // c should be in a different row
    expect(posC.y).toBeGreaterThan(posA.y);
  });

  it('handles mixed-size nodes without overlap', () => {
    const mixed: LayoutNode[] = [
      { id: 'x', width: 80, height: 40 },
      { id: 'y', width: 120, height: 80 },
      { id: 'z', width: 60, height: 50 },
      { id: 'w', width: 100, height: 30 },
    ];
    const layout = gridLayout(mixed, { columns: 2, gap: 16 });
    assertNoOverlaps(mixed, layout);
  });

  it('handles empty input', () => {
    expect(gridLayout([])).toEqual(new Map());
  });

  it('handles a single node', () => {
    const layout = gridLayout([{ id: 'solo', width: 50, height: 50 }]);
    expect(layout.get('solo')).toEqual({ x: 0, y: 0 });
  });
});

// ---------------------------------------------------------------------------
// treeLayout
// ---------------------------------------------------------------------------

describe('treeLayout', () => {
  it('places root above its children', () => {
    const nodes: LayoutNode[] = [
      { id: 'a', width: 80, height: 40 },
      { id: 'b', width: 80, height: 40 },
      { id: 'c', width: 80, height: 40 },
    ];
    const edges: LayoutEdge[] = [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
    ];
    const layout = treeLayout(nodes, edges);
    const ya = layout.get('a')!.y;
    const yb = layout.get('b')!.y;
    const yc = layout.get('c')!.y;
    expect(ya).toBeLessThan(yb);
    expect(ya).toBeLessThan(yc);
    expect(yb).toBe(yc); // siblings at same depth
  });

  it('handles a→b, a→c, b→d: deeper nodes have larger y', () => {
    const nodes: LayoutNode[] = [
      { id: 'a', width: 80, height: 40 },
      { id: 'b', width: 80, height: 40 },
      { id: 'c', width: 80, height: 40 },
      { id: 'd', width: 80, height: 40 },
    ];
    const edges: LayoutEdge[] = [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
      { from: 'b', to: 'd' },
    ];
    const layout = treeLayout(nodes, edges);
    const ya = layout.get('a')!.y;
    const yb = layout.get('b')!.y;
    const yc = layout.get('c')!.y;
    const yd = layout.get('d')!.y;
    // a < b = c < d
    expect(ya).toBeLessThan(yb);
    expect(yb).toBe(yc);
    expect(yb).toBeLessThan(yd);
    // d is below b
    expect(yd).toBeGreaterThan(yb);
  });

  it('does not hang on a cycle (a→b→a)', () => {
    const nodes: LayoutNode[] = [
      { id: 'a', width: 80, height: 40 },
      { id: 'b', width: 80, height: 40 },
    ];
    const edges: LayoutEdge[] = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' },
    ];
    // Should return without hanging and produce positions for all nodes.
    const layout = treeLayout(nodes, edges);
    expect(layout.size).toBe(2);
    for (const node of nodes) {
      const p = layout.get(node.id)!;
      expect(isFinite(p.x)).toBe(true);
      expect(isFinite(p.y)).toBe(true);
    }
  });

  it('handles a forest (two separate trees)', () => {
    const nodes: LayoutNode[] = [
      { id: 'r1', width: 80, height: 40 },
      { id: 'c1', width: 80, height: 40 },
      { id: 'r2', width: 80, height: 40 },
      { id: 'c2', width: 80, height: 40 },
    ];
    const edges: LayoutEdge[] = [
      { from: 'r1', to: 'c1' },
      { from: 'r2', to: 'c2' },
    ];
    const layout = treeLayout(nodes, edges);
    expect(layout.get('r1')!.y).toBeLessThan(layout.get('c1')!.y);
    expect(layout.get('r2')!.y).toBeLessThan(layout.get('c2')!.y);
    // Roots should be at same depth
    expect(layout.get('r1')!.y).toBe(layout.get('r2')!.y);
  });

  it('handles empty nodes', () => {
    expect(treeLayout([], [])).toEqual(new Map());
  });
});

// ---------------------------------------------------------------------------
// forceLayout
// ---------------------------------------------------------------------------

describe('forceLayout', () => {
  const makeNodes = (ids: string[]): LayoutNode[] =>
    ids.map((id) => ({ id, width: 80, height: 60 }));

  it('returns a finite position for every node (no NaN)', () => {
    const nodes = makeNodes(['a', 'b', 'c', 'd', 'e']);
    const edges: LayoutEdge[] = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd' },
    ];
    const layout = forceLayout(nodes, edges, { seed: 1 });
    expect(layout.size).toBe(nodes.length);
    for (const node of nodes) {
      const p = layout.get(node.id)!;
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Number.isNaN(p.x)).toBe(false);
      expect(Number.isNaN(p.y)).toBe(false);
    }
  });

  it('is deterministic across two runs with the same seed', () => {
    const nodes = makeNodes(['a', 'b', 'c', 'd']);
    const edges: LayoutEdge[] = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ];
    const layout1 = forceLayout(nodes, edges, { seed: 99 });
    const layout2 = forceLayout(nodes, edges, { seed: 99 });
    for (const node of nodes) {
      expect(layout1.get(node.id)).toEqual(layout2.get(node.id));
    }
  });

  it('different seeds produce different layouts', () => {
    const nodes = makeNodes(['a', 'b', 'c']);
    const edges: LayoutEdge[] = [{ from: 'a', to: 'b' }];
    const layout1 = forceLayout(nodes, edges, { seed: 1 });
    const layout2 = forceLayout(nodes, edges, { seed: 2 });
    // At least one position should differ.
    const somesDiffer = nodes.some(
      (n) =>
        layout1.get(n.id)!.x !== layout2.get(n.id)!.x ||
        layout1.get(n.id)!.y !== layout2.get(n.id)!.y,
    );
    expect(somesDiffer).toBe(true);
  });

  it('connected nodes end up closer than clearly disconnected pair on average', () => {
    // a-b connected, c is isolated
    const nodes = makeNodes(['a', 'b', 'c']);
    const edges: LayoutEdge[] = [{ from: 'a', to: 'b' }];

    // Run multiple seeds and average distances.
    const seeds = [1, 2, 3, 4, 5, 7, 11, 13, 17, 19];
    let sumConnected = 0;
    let sumDisconnected = 0;

    for (const seed of seeds) {
      const layout = forceLayout(nodes, edges, { seed, iterations: 200 });
      const pa = layout.get('a')!;
      const pb = layout.get('b')!;
      const pc = layout.get('c')!;
      const dab = Math.sqrt((pa.x - pb.x) ** 2 + (pa.y - pb.y) ** 2);
      const dac = Math.sqrt((pa.x - pc.x) ** 2 + (pa.y - pc.y) ** 2);
      const dbc = Math.sqrt((pb.x - pc.x) ** 2 + (pb.y - pc.y) ** 2);
      sumConnected += dab;
      sumDisconnected += (dac + dbc) / 2;
    }

    const avgConnected = sumConnected / seeds.length;
    const avgDisconnected = sumDisconnected / seeds.length;
    // Connected pair should be closer than disconnected on average.
    expect(avgConnected).toBeLessThan(avgDisconnected);
  });

  it('handles empty input', () => {
    expect(forceLayout([], [])).toEqual(new Map());
  });

  it('handles a single node', () => {
    const layout = forceLayout([{ id: 'x', width: 80, height: 60 }], []);
    const p = layout.get('x')!;
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });
});
