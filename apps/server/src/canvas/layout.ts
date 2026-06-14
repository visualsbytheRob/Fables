/**
 * Canvas graph auto-layout algorithms (F1524).
 *
 * Pure, dependency-free, deterministic layout algorithms for arranging nodes
 * on the canvas: grid packing, layered tree layout, and force-directed layout.
 * All functions are side-effect-free and return a Map<nodeId, {x, y}>.
 */

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

export interface Pos {
  x: number;
  y: number;
}

/** node id → top-left position */
export type Layout = Map<string, Pos>;

export interface LayoutOptions {
  gap?: number;
  seed?: number;
}

// ---------------------------------------------------------------------------
// gridLayout
// ---------------------------------------------------------------------------

/**
 * Pack nodes into a grid (left-to-right, top-to-bottom).
 * Default columns = ceil(sqrt(n)).  Column x advances by max width + gap;
 * row y advances by max height in that row + gap.
 */
export function gridLayout(
  nodes: LayoutNode[],
  opts?: LayoutOptions & { columns?: number },
): Layout {
  const gap = opts?.gap ?? 24;
  const cols = opts?.columns ?? Math.ceil(Math.sqrt(nodes.length));
  const result: Layout = new Map();

  if (nodes.length === 0) return result;

  // Compute max width per column and max height per row.
  const numRows = Math.ceil(nodes.length / (cols === 0 ? 1 : cols));
  const colWidths = new Array<number>(cols).fill(0);
  const rowHeights = new Array<number>(numRows).fill(0);

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const col = i % cols;
    const row = Math.floor(i / cols);
    if (node.width > colWidths[col]!) colWidths[col] = node.width;
    if (node.height > rowHeights[row]!) rowHeights[row] = node.height;
  }

  // Prefix sums for column x and row y positions.
  const colX = new Array<number>(cols).fill(0);
  for (let c = 1; c < cols; c++) {
    colX[c] = colX[c - 1]! + colWidths[c - 1]! + gap;
  }
  const rowY = new Array<number>(numRows).fill(0);
  for (let r = 1; r < numRows; r++) {
    rowY[r] = rowY[r - 1]! + rowHeights[r - 1]! + gap;
  }

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const col = i % cols;
    const row = Math.floor(i / cols);
    result.set(node.id, { x: colX[col]!, y: rowY[row]! });
  }

  return result;
}

// ---------------------------------------------------------------------------
// treeLayout
// ---------------------------------------------------------------------------

/**
 * Layered top-down tree layout.
 * Assigns each node a depth = longest path from any root (nodes with no
 * incoming edge). Handles forests and ignores back-edges / cycles.
 * Parents are centered over their children; simple left-to-right ordering
 * within each layer otherwise.
 */
export function treeLayout(nodes: LayoutNode[], edges: LayoutEdge[], opts?: LayoutOptions): Layout {
  const gap = opts?.gap ?? 24;
  const result: Layout = new Map();

  if (nodes.length === 0) return result;

  const nodeMap = new Map<string, LayoutNode>(nodes.map((n) => [n.id, n]));
  const nodeIds = new Set(nodeMap.keys());

  // Build adjacency (only edges between known nodes).
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const id of nodeIds) {
    children.set(id, []);
    parents.set(id, []);
  }
  for (const e of edges) {
    if (nodeIds.has(e.from) && nodeIds.has(e.to)) {
      children.get(e.from)!.push(e.to);
      parents.get(e.to)!.push(e.from);
    }
  }

  // Assign depths via iterative BFS / longest-path from each root.
  // To handle cycles, we use a visited set and break revisits.
  const depth = new Map<string, number>();
  const roots = nodes.filter((n) => parents.get(n.id)!.length === 0).map((n) => n.id);

  // If all nodes have parents (pure cycle), treat all as roots.
  const startSet = roots.length > 0 ? roots : nodes.map((n) => n.id);

  // Iterative longest-path BFS using a simple topological relaxation
  // with cycle protection.
  for (const id of nodeIds) depth.set(id, -1);
  const queue: string[] = [...startSet];
  for (const r of startSet) depth.set(r, 0);

  const visiting = new Set<string>();
  function assignDepth(id: string, d: number): void {
    if (visiting.has(id)) return; // back-edge / cycle — skip
    visiting.add(id);
    if (d > depth.get(id)!) {
      depth.set(id, d);
    }
    for (const child of children.get(id) ?? []) {
      assignDepth(child, depth.get(id)! + 1);
    }
    visiting.delete(id);
  }
  void queue; // not using BFS queue — using DFS above instead
  for (const r of startSet) {
    assignDepth(r, 0);
  }

  // Nodes that were never reached (isolated in cycles that aren't roots).
  for (const id of nodeIds) {
    if (depth.get(id) === -1) depth.set(id, 0);
  }

  // Group nodes by layer.
  const maxDepth = Math.max(...depth.values());
  const layers: string[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const id of nodeIds) {
    layers[depth.get(id)!]!.push(id);
  }

  // Compute row height per layer and cumulative y.
  const layerHeight = layers.map((layer) =>
    layer.reduce((max, id) => Math.max(max, nodeMap.get(id)!.height), 0),
  );
  const layerY: number[] = [0];
  for (let i = 1; i <= maxDepth; i++) {
    layerY[i] = layerY[i - 1]! + layerHeight[i - 1]! + gap;
  }

  // Assign x positions within each layer: spread nodes with gap.
  // First pass: simple left-to-right.
  for (const layer of layers) {
    let x = 0;
    for (const id of layer) {
      const node = nodeMap.get(id)!;
      result.set(id, { x, y: layerY[depth.get(id)!]! });
      x += node.width + gap;
    }
  }

  // Second pass: center parents over children (single bottom-up sweep).
  for (let d = maxDepth - 1; d >= 0; d--) {
    for (const id of layers[d]!) {
      const kids = (children.get(id) ?? []).filter((c) => depth.get(c)! > d);
      if (kids.length === 0) continue;
      const leftX = result.get(kids[0]!)!.x;
      const lastKid = kids[kids.length - 1]!;
      const rightX = result.get(lastKid)!.x + nodeMap.get(lastKid)!.width;
      const node = nodeMap.get(id)!;
      const centerX = (leftX + rightX) / 2 - node.width / 2;
      result.set(id, { x: centerX, y: result.get(id)!.y });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// forceLayout
// ---------------------------------------------------------------------------

/** Simple seeded linear congruential generator (LCG). */
function makeLcg(seed: number): () => number {
  // Parameters from Numerical Recipes (modulus 2^32).
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Force-directed layout using repulsion (inverse-square, all pairs) +
 * attraction (spring on edges) + linear cooling. Deterministic via seed.
 * Guaranteed to terminate and never produce NaN / Infinity.
 */
export function forceLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts?: LayoutOptions & { iterations?: number },
): Layout {
  const gap = opts?.gap ?? 24;
  const iterations = opts?.iterations ?? 100;
  const seed = opts?.seed ?? 42;

  const result: Layout = new Map();
  if (nodes.length === 0) return result;

  const rand = makeLcg(seed);

  // Initial positions: random spread proportional to sqrt(n).
  const spread = Math.sqrt(nodes.length) * 200;
  const pos: { x: number; y: number }[] = nodes.map(() => ({
    x: (rand() - 0.5) * spread,
    y: (rand() - 0.5) * spread,
  }));

  const nodeIds = nodes.map((n) => n.id);
  const idxOf = new Map<string, number>(nodeIds.map((id, i) => [id, i]));

  // Build edge index (only valid edges).
  const edgePairs: [number, number][] = [];
  for (const e of edges) {
    const fi = idxOf.get(e.from);
    const ti = idxOf.get(e.to);
    if (fi !== undefined && ti !== undefined && fi !== ti) {
      edgePairs.push([fi, ti]);
    }
  }

  // Force parameters.
  const repulseStrength = 5000;
  const springStrength = 0.05;
  // Desired spring length: rough size of nodes + gap.
  const springLen =
    nodes.reduce((s, n) => s + Math.sqrt(n.width * n.width + n.height * n.height), 0) /
      nodes.length +
    gap;
  const maxRepulse = 300;

  for (let iter = 0; iter < iterations; iter++) {
    const cooling = 1 - iter / iterations; // 1 → 0
    const step = (50 + gap) * cooling + 1;

    const fx = new Array<number>(nodes.length).fill(0);
    const fy = new Array<number>(nodes.length).fill(0);

    // Repulsion: all pairs.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = pos[i]!.x - pos[j]!.x;
        const dy = pos[i]!.y - pos[j]!.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) distSq = 1; // avoid division by zero
        const dist = Math.sqrt(distSq);
        let force = repulseStrength / distSq;
        if (force > maxRepulse) force = maxRepulse;
        const nx = dx / dist;
        const ny = dy / dist;
        fx[i]! += nx * force;
        fy[i]! += ny * force;
        fx[j]! -= nx * force;
        fy[j]! -= ny * force;
      }
    }

    // Attraction: spring on edges.
    for (const [fi, ti] of edgePairs) {
      const dx = pos[ti]!.x - pos[fi]!.x;
      const dy = pos[ti]!.y - pos[fi]!.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = springStrength * (dist - springLen);
      const nx = dx / dist;
      const ny = dy / dist;
      fx[fi]! += nx * force;
      fy[fi]! += ny * force;
      fx[ti]! -= nx * force;
      fy[ti]! -= ny * force;
    }

    // Apply forces with cooling step.
    for (let i = 0; i < nodes.length; i++) {
      const mag = Math.sqrt(fx[i]! * fx[i]! + fy[i]! * fy[i]!) || 1;
      const capped = Math.min(mag, step);
      pos[i]!.x += (fx[i]! / mag) * capped;
      pos[i]!.y += (fy[i]! / mag) * capped;
    }
  }

  // Shift so top-left of bounding box is at (0, 0).
  let minX = Infinity;
  let minY = Infinity;
  for (const p of pos) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
  }

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const p = pos[i]!;
    result.set(node.id, {
      x: isFinite(p.x - minX) ? p.x - minX : 0,
      y: isFinite(p.y - minY) ? p.y - minY : 0,
    });
  }

  return result;
}
