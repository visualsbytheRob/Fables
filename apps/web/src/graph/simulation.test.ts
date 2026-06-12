import { describe, expect, it } from 'vitest';
import { createSimulation, defaultLayout, initialPosition, kineticEnergy } from './simulation.js';

const ring = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    source: `n${i}`,
    target: `n${(i + 1) % n}`,
    weight: 1,
  }));

describe('force simulation (F241/F250)', () => {
  it('seeds distinct, finite initial positions', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const { x, y } = initialPosition(i);
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      seen.add(`${x.toFixed(3)}:${y.toFixed(3)}`);
    }
    expect(seen.size).toBe(500);
  });

  it('survives 10 ticks at 5k synthetic nodes with no NaN (perf fixture)', () => {
    const n = 5000;
    const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, degree: (i % 7) + 1 }));
    // Ring + chords: every node has edges, communities overlap.
    const edges = [
      ...ring(n),
      ...Array.from({ length: n / 2 }, (_, i) => ({
        source: `n${i}`,
        target: `n${(i * 13 + 7) % n}`,
        weight: 2,
      })),
    ];
    const sim = createSimulation(nodes, edges);
    const startedAt = Date.now();
    for (let i = 0; i < 10; i += 1) sim.tick();
    const elapsed = Date.now() - startedAt;
    for (const node of sim.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(Number.isFinite(node.vx)).toBe(true);
      expect(Number.isFinite(node.vy)).toBe(true);
    }
    // Sanity perf bound — generous so CI noise never flakes it.
    expect(elapsed).toBeLessThan(10_000);
  });

  it('converges: alpha decays to settled and energy dies down', () => {
    const nodes = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, degree: 2 }));
    const sim = createSimulation(nodes, ring(30));
    let ticks = 0;
    while (!sim.settled && ticks < 1000) {
      sim.tick();
      ticks += 1;
    }
    expect(sim.settled).toBe(true);
    expect(ticks).toBeLessThan(1000);
    expect(kineticEnergy(sim)).toBeLessThan(1);
    // tick() after settle is a no-op freeze.
    const before = sim.nodes.map((n) => [n.x, n.y]);
    sim.tick();
    expect(sim.nodes.map((n) => [n.x, n.y])).toEqual(before);
  });

  it('handles coincident nodes and self/unknown edges without NaN', () => {
    const sim = createSimulation(
      [
        { id: 'a', degree: 1 },
        { id: 'b', degree: 1 },
      ],
      [
        { source: 'a', target: 'a', weight: 1 },
        { source: 'a', target: 'ghost', weight: 1 },
        { source: 'a', target: 'b', weight: 3 },
      ],
    );
    // Force both nodes onto the same point.
    sim.nodes[0]!.x = sim.nodes[1]!.x = 5;
    sim.nodes[0]!.y = sim.nodes[1]!.y = 5;
    for (let i = 0; i < 50; i += 1) sim.tick();
    for (const node of sim.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
    expect(sim.edges).toHaveLength(1); // self + unknown edges dropped
  });

  it('reheat restarts cooling and respects fixed nodes during drag', () => {
    const sim = createSimulation(
      [
        { id: 'a', degree: 1 },
        { id: 'b', degree: 1 },
      ],
      [{ source: 'a', target: 'b', weight: 1 }],
    );
    while (!sim.settled) sim.tick();
    sim.reheat();
    expect(sim.settled).toBe(false);
    const a = sim.nodes[0]!;
    a.fixed = true;
    a.x = 123;
    a.y = -45;
    sim.tick();
    expect(a.x).toBe(123);
    expect(a.y).toBe(-45);
  });

  it('respects layout settings handed in (gravity pulls toward origin)', () => {
    const sim = createSimulation([{ id: 'a', degree: 0 }], [], {
      ...defaultLayout,
      gravity: 0.5,
    });
    sim.nodes[0]!.x = 400;
    sim.nodes[0]!.y = 0;
    sim.tick();
    expect(sim.nodes[0]!.x).toBeLessThan(400);
  });
});
