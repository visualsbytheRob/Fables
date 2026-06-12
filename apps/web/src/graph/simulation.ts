/**
 * Dependency-free force-directed layout (F241/F249/F250).
 *
 * Forces per tick: pairwise repulsion (grid-bucketed with a cutoff radius so
 * 5k nodes stay interactive), springs along edges toward `linkDistance`, and
 * centering gravity. Velocity-damped Euler integration with an alpha that
 * decays to zero — the simulation reports `settled` so the renderer can stop
 * its requestAnimationFrame loop and freeze.
 */

export interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Visual + mass weight (node degree). */
  degree: number;
  /** Pinned while the user drags it. */
  fixed: boolean;
}

export interface SimEdge {
  /** Index into nodes. */
  source: number;
  target: number;
  weight: number;
}

export interface LayoutSettings {
  /** Pull toward the origin (0..1-ish). */
  gravity: number;
  /** Spring rest length in world units. */
  linkDistance: number;
  /** Repulsion strength constant. */
  repulsion: number;
}

export const defaultLayout: LayoutSettings = {
  gravity: 0.06,
  linkDistance: 70,
  repulsion: 1500,
};

const DAMPING = 0.6;
const ALPHA_DECAY = 0.025;
const ALPHA_MIN = 0.003;
const MAX_SPEED = 40;
const SPRING_STRENGTH = 0.08;

export interface Simulation {
  nodes: SimNode[];
  edges: SimEdge[];
  settings: LayoutSettings;
  alpha: number;
  readonly settled: boolean;
  tick(): void;
  /** Restart cooling (after drags or setting changes). */
  reheat(alpha?: number): void;
}

/** Deterministic phyllotaxis spiral: distinct positions, no randomness, no NaN. */
export function initialPosition(index: number): { x: number; y: number } {
  const radius = 12 * Math.sqrt(index + 0.5);
  const angle = index * 2.399963229728653; // golden angle
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

export function createSimulation(
  nodeIds: { id: string; degree: number }[],
  rawEdges: { source: string; target: string; weight: number }[],
  settings: LayoutSettings = { ...defaultLayout },
): Simulation {
  const nodes: SimNode[] = nodeIds.map((n, i) => ({
    id: n.id,
    ...initialPosition(i),
    vx: 0,
    vy: 0,
    degree: n.degree,
    fixed: false,
  }));
  const indexOf = new Map(nodes.map((n, i) => [n.id, i]));
  const edges: SimEdge[] = [];
  for (const e of rawEdges) {
    const s = indexOf.get(e.source);
    const t = indexOf.get(e.target);
    if (s === undefined || t === undefined || s === t) continue;
    edges.push({ source: s, target: t, weight: e.weight });
  }

  let alpha = 1;

  const tick = (): void => {
    if (alpha < ALPHA_MIN) return;
    const { gravity, linkDistance, repulsion } = sim.settings;
    const n = nodes.length;
    const cutoff = Math.max(linkDistance * 2.5, 120);
    const cell = cutoff;

    // Grid-bucketed repulsion with a cutoff radius: O(n · local density).
    const grid = new Map<string, number[]>();
    for (let i = 0; i < n; i += 1) {
      const node = nodes[i]!;
      const key = `${Math.floor(node.x / cell)}:${Math.floor(node.y / cell)}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(i);
      else grid.set(key, [i]);
    }
    const cutoffSq = cutoff * cutoff;
    for (let i = 0; i < n; i += 1) {
      const a = nodes[i]!;
      const cx = Math.floor(a.x / cell);
      const cy = Math.floor(a.y / cell);
      let fx = 0;
      let fy = 0;
      for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
        for (let gy = cy - 1; gy <= cy + 1; gy += 1) {
          const bucket = grid.get(`${gx}:${gy}`);
          if (!bucket) continue;
          for (const j of bucket) {
            if (j === i) continue;
            const b = nodes[j]!;
            let dx = a.x - b.x;
            let dy = a.y - b.y;
            let distSq = dx * dx + dy * dy;
            if (distSq === 0) {
              // Deterministic separation for coincident nodes — never NaN.
              dx = ((i - j) % 7) * 0.1 + 0.05;
              dy = ((i + j) % 5) * 0.1 + 0.05;
              distSq = dx * dx + dy * dy;
            }
            if (distSq > cutoffSq) continue;
            const force = (repulsion / distSq) * alpha;
            const dist = Math.sqrt(distSq);
            fx += (dx / dist) * force;
            fy += (dy / dist) * force;
          }
        }
      }
      a.vx += fx;
      a.vy += fy;
    }

    // Springs along edges.
    for (const edge of edges) {
      const a = nodes[edge.source]!;
      const b = nodes[edge.target]!;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist === 0) {
        dx = 0.1;
        dy = 0.1;
        dist = Math.SQRT2 * 0.1;
      }
      const stretch = dist - linkDistance;
      const k = SPRING_STRENGTH * Math.min(edge.weight, 4) * alpha;
      const fx = (dx / dist) * stretch * k;
      const fy = (dy / dist) * stretch * k;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // Gravity + integration.
    for (const node of nodes) {
      node.vx += -node.x * gravity * alpha;
      node.vy += -node.y * gravity * alpha;
      node.vx *= DAMPING;
      node.vy *= DAMPING;
      const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
      if (speed > MAX_SPEED) {
        node.vx = (node.vx / speed) * MAX_SPEED;
        node.vy = (node.vy / speed) * MAX_SPEED;
      }
      if (!node.fixed) {
        node.x += node.vx;
        node.y += node.vy;
      }
    }

    alpha *= 1 - ALPHA_DECAY;
    sim.alpha = alpha;
  };

  const sim: Simulation = {
    nodes,
    edges,
    settings,
    alpha,
    get settled() {
      return alpha < ALPHA_MIN;
    },
    tick,
    reheat(next = 0.5) {
      alpha = Math.max(alpha, next);
      sim.alpha = alpha;
    },
  };
  return sim;
}

/** Total kinetic energy — used by tests to assert the layout converges. */
export function kineticEnergy(sim: Simulation): number {
  let e = 0;
  for (const n of sim.nodes) e += n.vx * n.vx + n.vy * n.vy;
  return e;
}
