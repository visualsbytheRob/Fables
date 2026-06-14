/**
 * Story-map generation tests (F1541) — Forge source → knot cards + divert edges.
 */

import { describe, expect, it } from 'vitest';
import { buildStoryMap, knotOfObject } from './story-map.js';

const STORY = `=== start ===
You are at the start.
+ [Go to the forest]
  -> forest
+ [Go home]
  -> home

=== forest ===
A dark forest.
-> home

=== home ===
You are home.
-> END
`;

describe('buildStoryMap (F1541)', () => {
  it('creates a knot card per knot and a connector per divert', () => {
    const map = buildStoryMap(STORY);

    // One 'knot' object per knot, positioned (tree layout).
    expect(map.objects.map((o) => o.data?.['knot']).sort()).toEqual(['forest', 'home', 'start']);
    expect(map.objects.every((o) => o.kind === 'knot')).toBe(true);
    expect(map.objects.every((o) => Number.isFinite(o.x) && Number.isFinite(o.y))).toBe(true);

    // Edges: start→forest, start→home, forest→home (END is not a knot).
    const pairs = map.edges.map((e) => `${e.fromId}=>${e.toId}`).sort();
    expect(pairs).toEqual([
      'knot:forest=>knot:home',
      'knot:start=>knot:forest',
      'knot:start=>knot:home',
    ]);
    expect(map.edges.every((e) => e.kind === 'divert')).toBe(true);
  });

  it('ignores special targets and unknown knots, and dedupes parallel diverts', () => {
    const map = buildStoryMap(`=== a ===
-> b
-> b
-> END
-> nowhere

=== b ===
-> END
`);
    // a→b once (deduped), no edge to END or the undefined "nowhere".
    expect(map.edges).toHaveLength(1);
    expect(map.edges[0]!.toId).toBe('knot:b');
  });

  it('knotOfObject reads the knot name back', () => {
    const [obj] = buildStoryMap('=== solo ===\n-> END\n').objects;
    expect(knotOfObject(obj!)).toBe('solo');
  });
});
