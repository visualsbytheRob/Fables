/**
 * Scene graph (F521–F530): knots as nodes, diverts as edges, computed
 * entirely client-side from the compiler's symbol table and AST — no server,
 * no layout dependency. Layout is simple longest-path layering over the
 * divert DAG (back edges from cycles are ignored for layering only).
 */
import { findAllChoices, findAllDiverts, reachableKnots } from '@fables/forge-dsl';
import type { CompileResult, KnotNode } from '@fables/forge-dsl';

export const START_NODE = ''; // the entry/preamble, as in symbols.knotGraph

export interface SceneNode {
  /** Knot name; '' is the story entry. */
  readonly id: string;
  readonly label: string;
  readonly file: string | undefined;
  /** Offset of the knot header in its file (click-to-open, F524). */
  readonly offset: number;
  readonly line: number;
  readonly choices: number;
  readonly words: number;
  /** Contains a divert to END/DONE. */
  readonly ending: boolean;
  readonly reachable: boolean;
  /** Reachable but with no route to any ending knot (F526). */
  readonly deadEnd: boolean;
  readonly layer: number;
  readonly row: number;
}

export interface SceneEdge {
  readonly from: string;
  readonly to: string;
}

export interface SceneStats {
  readonly knots: number;
  readonly words: number;
  readonly endings: number;
  /** Mean out-degree across knots that have any exits (F528). */
  readonly branchFactor: number;
  readonly maxDepth: number;
  readonly unreachable: number;
  readonly deadEnds: number;
}

export interface SceneGraph {
  readonly nodes: readonly SceneNode[];
  readonly edges: readonly SceneEdge[];
  readonly stats: SceneStats;
}

/** Rough prose word count for a knot: flow lines minus markup/logic lines. */
export function knotWordCount(source: string, knot: KnotNode): number {
  const text = source.slice(knot.span.start.offset, knot.span.end.offset);
  let words = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (/^(===|=|~|VAR\b|CONST\b|INCLUDE\b|\/\/|->)/.test(line)) continue;
    const prose = line
      .replace(/^[*+\-\s]+/, '') // choice/gather markers
      .replace(/\{[^}]*\}/g, ' ') // inline logic
      .replace(/#.*$/, '') // tags
      .replace(/->.*$/, ''); // trailing diverts
    words += (prose.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length;
  }
  return words;
}

const isEndingDivert = (target: string | undefined): boolean =>
  target === 'END' || target === 'DONE';

interface KnotInfo {
  readonly choices: number;
  readonly words: number;
  readonly ending: boolean;
  readonly file: string | undefined;
}

function collectKnotInfo(result: CompileResult): Map<string, KnotInfo> {
  const info = new Map<string, KnotInfo>();
  for (const unit of result.symbols.units) {
    for (const knot of unit.story.knots) {
      info.set(knot.name.name, {
        choices: findAllChoices(knot).length,
        words: knotWordCount(unit.source, knot),
        ending: findAllDiverts(knot).some((d) => isEndingDivert(d.targetPath[0])),
        file: unit.fileName,
      });
    }
  }
  return info;
}

/** Longest-path layering from the given roots, ignoring DFS back edges. */
function layerNodes(
  ids: readonly string[],
  edges: ReadonlyMap<string, ReadonlySet<string>>,
  roots: readonly string[],
): Map<string, number> {
  const layers = new Map<string, number>();
  const onStack = new Set<string>();

  const visit = (id: string, depth: number): void => {
    if (onStack.has(id)) return; // back edge — cycle, skip for layering
    const known = layers.get(id);
    if (known !== undefined && known >= depth) return;
    layers.set(id, depth);
    onStack.add(id);
    for (const next of edges.get(id) ?? []) if (next !== id) visit(next, depth + 1);
    onStack.delete(id);
  };

  for (const root of roots) visit(root, 0);
  // Anything untouched (unreachable islands): treat each as its own root.
  for (const id of ids) if (!layers.has(id)) visit(id, (maxLayer(layers) ?? -1) + 1);
  return layers;
}

function maxLayer(layers: ReadonlyMap<string, number>): number | null {
  let max: number | null = null;
  for (const v of layers.values()) if (max === null || v > max) max = v;
  return max;
}

export function buildSceneGraph(result: CompileResult): SceneGraph {
  const { symbols } = result;
  const info = collectKnotInfo(result);
  const reachable = reachableKnots(symbols);

  const ids = [START_NODE, ...symbols.knots.keys()];
  const edgeMap = new Map<string, Set<string>>();
  const edges: SceneEdge[] = [];
  for (const [from, targets] of symbols.knotGraph) {
    for (const to of targets) {
      if (!edgeMap.has(from)) edgeMap.set(from, new Set());
      const set = edgeMap.get(from) as Set<string>;
      if (set.has(to)) continue;
      set.add(to);
      edges.push({ from, to });
    }
  }

  // Dead ends (F526): co-reachability to any ending knot over the divert graph.
  const endingIds = new Set(
    [...info.entries()].filter(([, i]) => i.ending).map(([name]) => name),
  );
  const reverse = new Map<string, Set<string>>();
  for (const { from, to } of edges) {
    if (!reverse.has(to)) reverse.set(to, new Set());
    (reverse.get(to) as Set<string>).add(from);
  }
  const reachesEnd = new Set<string>(endingIds);
  const queue = [...endingIds];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const prev of reverse.get(cur) ?? []) {
      if (!reachesEnd.has(prev)) {
        reachesEnd.add(prev);
        queue.push(prev);
      }
    }
  }

  const layers = layerNodes(ids, edgeMap, [START_NODE]);
  const rowCounters = new Map<number, number>();
  const nodes: SceneNode[] = ids.map((id) => {
    const sym = symbols.knots.get(id);
    const i = info.get(id);
    const layer = layers.get(id) ?? 0;
    const row = rowCounters.get(layer) ?? 0;
    rowCounters.set(layer, row + 1);
    const isReachable = id === START_NODE || reachable.has(id);
    const ending = i?.ending ?? false;
    return {
      id,
      label: id === START_NODE ? '(start)' : id,
      file: sym?.file ?? i?.file,
      offset: sym?.span.start.offset ?? 0,
      line: sym?.span.start.line ?? 1,
      choices: i?.choices ?? 0,
      words: i?.words ?? 0,
      ending,
      reachable: isReachable,
      deadEnd: isReachable && !ending && !reachesEnd.has(id),
      layer,
      row,
    };
  });

  const out = [...edgeMap.values()];
  const branching = out.filter((s) => s.size > 0);
  const stats: SceneStats = {
    knots: symbols.knots.size,
    words: nodes.reduce((sum, n) => sum + n.words, 0),
    endings: endingIds.size,
    branchFactor:
      branching.length === 0
        ? 0
        : Math.round((branching.reduce((s, set) => s + set.size, 0) / branching.length) * 100) /
          100,
    maxDepth: maxLayer(layers) ?? 0,
    unreachable: nodes.filter((n) => !n.reachable).length,
    deadEnds: nodes.filter((n) => n.deadEnd).length,
  };

  return { nodes, edges, stats };
}

/** Nodes and edges on any route from `from` to `to` (F527). */
export function pathsBetween(
  graph: SceneGraph,
  from: string,
  to: string,
): { nodes: ReadonlySet<string>; edges: ReadonlySet<string> } {
  const fwd = new Map<string, Set<string>>();
  const rev = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (!fwd.has(e.from)) fwd.set(e.from, new Set());
    (fwd.get(e.from) as Set<string>).add(e.to);
    if (!rev.has(e.to)) rev.set(e.to, new Set());
    (rev.get(e.to) as Set<string>).add(e.from);
  }
  const flood = (start: string, adj: ReadonlyMap<string, ReadonlySet<string>>): Set<string> => {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length > 0) {
      const cur = queue.shift() as string;
      for (const next of adj.get(cur) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen;
  };
  const fromSet = flood(from, fwd);
  const toSet = flood(to, rev);
  const nodes = new Set<string>();
  for (const id of fromSet) if (toSet.has(id)) nodes.add(id);
  const edges = new Set<string>();
  for (const e of graph.edges) {
    if (nodes.has(e.from) && nodes.has(e.to)) edges.add(edgeKey(e));
  }
  return { nodes, edges };
}

export const edgeKey = (e: SceneEdge): string => `${e.from}→${e.to}`;

// ── SVG rendering (shared by the view and the export, F529) ─────────────────

export interface SvgLayout {
  readonly nodeWidth: number;
  readonly nodeHeight: number;
  readonly gapX: number;
  readonly gapY: number;
  readonly padding: number;
}

export const DEFAULT_LAYOUT: SvgLayout = {
  nodeWidth: 148,
  nodeHeight: 54,
  gapX: 70,
  gapY: 24,
  padding: 24,
};

export interface NodePosition {
  readonly x: number;
  readonly y: number;
}

export function nodePositions(
  graph: SceneGraph,
  layout: SvgLayout = DEFAULT_LAYOUT,
): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>();
  for (const node of graph.nodes) {
    positions.set(node.id, {
      x: layout.padding + node.layer * (layout.nodeWidth + layout.gapX),
      y: layout.padding + node.row * (layout.nodeHeight + layout.gapY),
    });
  }
  return positions;
}

export function svgSize(
  graph: SceneGraph,
  layout: SvgLayout = DEFAULT_LAYOUT,
): { width: number; height: number } {
  const layers = graph.nodes.reduce((m, n) => Math.max(m, n.layer), 0) + 1;
  const rows = graph.nodes.reduce((m, n) => Math.max(m, n.row), 0) + 1;
  return {
    width: layers * layout.nodeWidth + (layers - 1) * layout.gapX + layout.padding * 2,
    height: rows * layout.nodeHeight + (rows - 1) * layout.gapY + layout.padding * 2,
  };
}

const xmlEscape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Standalone SVG export of the graph (F529) — self-contained styling so the
 * file works in planning docs outside the app.
 */
export function graphToSvg(graph: SceneGraph, layout: SvgLayout = DEFAULT_LAYOUT): string {
  const positions = nodePositions(graph, layout);
  const { width, height } = svgSize(graph, layout);
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, sans-serif" font-size="12">`,
    `<defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#8b8b94"/></marker></defs>`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
  );
  for (const edge of graph.edges) {
    const a = positions.get(edge.from);
    const b = positions.get(edge.to);
    if (a === undefined || b === undefined) continue;
    const x1 = a.x + layout.nodeWidth;
    const y1 = a.y + layout.nodeHeight / 2;
    const x2 = b.x;
    const y2 = b.y + layout.nodeHeight / 2;
    const mid = (x1 + x2) / 2;
    parts.push(
      `<path d="M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}" fill="none" stroke="#8b8b94" stroke-width="1.5" marker-end="url(#arrow)"/>`,
    );
  }
  for (const node of graph.nodes) {
    const p = positions.get(node.id) as NodePosition;
    const stroke = !node.reachable ? '#e5484d' : node.deadEnd ? '#f5a623' : '#5b5bd6';
    parts.push(
      `<g>`,
      `<rect x="${p.x}" y="${p.y}" width="${layout.nodeWidth}" height="${layout.nodeHeight}" rx="8" fill="#f7f7fb" stroke="${stroke}" stroke-width="${node.reachable ? 1.5 : 2}"/>`,
      `<text x="${p.x + 10}" y="${p.y + 20}" font-weight="600" fill="#26262b">${xmlEscape(node.label)}</text>`,
      `<text x="${p.x + 10}" y="${p.y + 38}" fill="#6f6f78">${node.choices} ch · ${node.words} w${node.ending ? ' · END' : ''}</text>`,
      `</g>`,
    );
  }
  parts.push('</svg>');
  return parts.join('');
}
