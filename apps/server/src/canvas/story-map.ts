/**
 * Story map generation (F1541).
 *
 * Turns a Forge story's source into a canvas: one **knot card** per knot, and a
 * **connector** for every divert between knots (the choices and `-> target` jumps
 * that wire the narrative together). Knots are arranged with the tree layout so
 * the story's shape reads at a glance. This is the bridge between the Fable Forge
 * compiler and Epic 16's spatial canvas — author the branch structure visually.
 */

import { parse, type BlockNode } from '@fables/forge-dsl';
import { treeLayout, type LayoutEdge, type LayoutNode } from './layout.js';
import type { ObjectInput } from '../db/repos/canvas.js';
import type { EdgeInput } from '../db/repos/canvas-edges.js';

const KNOT_WIDTH = 200;
const KNOT_HEIGHT = 90;

/** Special divert targets that aren't real knots. */
const SPECIAL_TARGETS = new Set(['END', 'DONE', 'RETURN']);

export interface StoryMap {
  objects: ObjectInput[];
  edges: EdgeInput[];
}

/** Build a canvas (knot cards + divert connectors) from Forge source (F1541). */
export function buildStoryMap(source: string): StoryMap {
  const { story } = parse(source);
  const knotNames = story.knots.map((k) => k.name.name);
  const known = new Set(knotNames);

  // Collect divert edges between knots.
  const rawEdges: { from: string; to: string }[] = [];
  for (const knot of story.knots) {
    const from = knot.name.name;
    for (const target of divertTargets(knot.body)) {
      if (target !== from && known.has(target)) rawEdges.push({ from, to: target });
    }
  }

  // Lay the knots out as a tree following the divert edges.
  const nodes: LayoutNode[] = knotNames.map((id) => ({
    id,
    width: KNOT_WIDTH,
    height: KNOT_HEIGHT,
  }));
  const layoutEdges: LayoutEdge[] = rawEdges.map((e) => ({ from: e.from, to: e.to }));
  const positions = treeLayout(nodes, layoutEdges, { gap: 48 });

  const objects: ObjectInput[] = knotNames.map((name) => {
    const pos = positions.get(name) ?? { x: 0, y: 0 };
    return {
      id: `knot:${name}`,
      kind: 'knot',
      x: pos.x,
      y: pos.y,
      width: KNOT_WIDTH,
      height: KNOT_HEIGHT,
      data: { knot: name },
    };
  });

  // De-duplicate parallel edges between the same pair.
  const seen = new Set<string>();
  const edges: EdgeInput[] = [];
  for (const e of rawEdges) {
    const key = `${e.from}->${e.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      fromId: `knot:${e.from}`,
      toId: `knot:${e.to}`,
      kind: 'divert',
      style: 'orthogonal',
    });
  }

  return { objects, edges };
}

/** All knot-level divert targets reachable from a block (recurses into choices). */
function divertTargets(block: BlockNode): string[] {
  const targets: string[] = [];
  walk(block, targets);
  return targets;
}

function walk(block: BlockNode, out: string[]): void {
  for (const item of block.items) {
    if (item.kind === 'DivertLine') {
      const divert = item.divert;
      if (divert.kind === 'Divert') {
        const head = divert.targetPath[0];
        if (head !== undefined && !SPECIAL_TARGETS.has(head)) out.push(head);
      }
    } else if (item.kind === 'Choice') {
      walk(item.body, out);
    }
  }
}

/** A knot card belongs to which knot (for two-way sync, F1542). */
export function knotOfObject(o: Pick<ObjectInput, 'data'>): string | null {
  const k = o.data?.['knot'];
  return typeof k === 'string' ? k : null;
}
