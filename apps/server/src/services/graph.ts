import { notFound, type NotebookId, type NoteId } from '@fables/core';
import type { Db } from '../db/connection.js';
import { linksRepo, type LinkKind } from '../db/repos/links.js';
import { notesRepo } from '../db/repos/notes.js';
import { tagsRepo } from '../db/repos/tags.js';

/**
 * Graph API (F231–F239): nodes are live notes (typed for future entities and
 * stories), edges are resolved links collapsed per (source, target, kind)
 * with link-count weights. Degree, orphan flags, and label-propagation
 * communities are computed server-side; responses are cached per filter and
 * invalidated on any link or note write.
 */

export const GRAPH_KINDS: LinkKind[] = ['wikilink', 'mention', 'binding', 'relation'];

export interface GraphNode {
  id: string;
  type: 'note';
  title: string;
  notebookId: string;
  degree: number;
  /** True when no edges touch the node (F236). */
  orphan: boolean;
  /** Label-propagation community index, stable for a given graph (F239). */
  community: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: LinkKind;
  weight: number;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: { nodes: number; edges: number; orphans: number; communities: number };
}

export interface GraphFilter {
  notebookId?: NotebookId;
  /** Tag name; an unknown tag yields an empty graph. */
  tag?: string;
  /** Edge kinds to include; defaults to explicit wikilinks. */
  kinds?: LinkKind[];
  /** Only notes updated at/after this ISO timestamp. */
  since?: string;
}

const LABEL_PROPAGATION_MAX_ITERATIONS = 20;

/**
 * Deterministic label propagation: labels start as node ids, nodes update in
 * sorted-id order to the neighbour label with the greatest total edge weight
 * (lexicographically smallest label wins ties), capped at 20 iterations.
 * Communities are then renumbered 0..k in sorted-node order.
 */
function detectCommunities(nodeIds: string[], edges: GraphEdge[]): Map<string, number> {
  const ordered = [...nodeIds].sort();
  const neighbours = new Map<string, { id: string; weight: number }[]>();
  for (const id of ordered) neighbours.set(id, []);
  for (const edge of edges) {
    neighbours.get(edge.source)?.push({ id: edge.target, weight: edge.weight });
    if (edge.source !== edge.target) {
      neighbours.get(edge.target)?.push({ id: edge.source, weight: edge.weight });
    }
  }

  const label = new Map<string, string>(ordered.map((id) => [id, id]));
  for (let i = 0; i < LABEL_PROPAGATION_MAX_ITERATIONS; i += 1) {
    let changed = false;
    for (const id of ordered) {
      const tally = new Map<string, number>();
      for (const n of neighbours.get(id)!) {
        const l = label.get(n.id)!;
        tally.set(l, (tally.get(l) ?? 0) + n.weight);
      }
      if (tally.size === 0) continue;
      let best = label.get(id)!;
      let bestWeight = -1;
      for (const [l, w] of tally) {
        if (w > bestWeight || (w === bestWeight && l < best)) {
          best = l;
          bestWeight = w;
        }
      }
      if (best !== label.get(id)) {
        label.set(id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const numbered = new Map<string, number>();
  const communities = new Map<string, number>();
  for (const id of ordered) {
    const l = label.get(id)!;
    if (!numbered.has(l)) numbered.set(l, numbered.size);
    communities.set(id, numbered.get(l)!);
  }
  return communities;
}

function computeGraph(db: Db, filter: GraphFilter): Graph {
  const kinds = filter.kinds ?? ['wikilink'];

  let tagId: string | undefined;
  if (filter.tag !== undefined) {
    const tag = tagsRepo(db).getByName(filter.tag);
    if (!tag)
      return { nodes: [], edges: [], stats: { nodes: 0, edges: 0, orphans: 0, communities: 0 } };
    tagId = tag.id;
  }
  const metas = notesRepo(db).listGraphMeta({
    ...(filter.notebookId !== undefined ? { notebookId: filter.notebookId } : {}),
    ...(filter.since !== undefined ? { since: filter.since } : {}),
    ...(tagId !== undefined ? { tagId } : {}),
  });
  const nodeIds = new Set(metas.map((m) => m.id as string));

  const edges: GraphEdge[] = linksRepo(db)
    .graphEdges(kinds)
    .filter((e) => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId))
    .map((e) => ({ source: e.sourceId, target: e.targetId, kind: e.kind, weight: e.weight }));

  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    if (edge.source !== edge.target) degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const communities = detectCommunities([...nodeIds], edges);

  const nodes: GraphNode[] = metas.map((m) => ({
    id: m.id,
    type: 'note',
    title: m.title,
    notebookId: m.notebookId,
    degree: degree.get(m.id) ?? 0,
    orphan: (degree.get(m.id) ?? 0) === 0,
    community: communities.get(m.id) ?? 0,
  }));

  return {
    nodes,
    edges,
    stats: {
      nodes: nodes.length,
      edges: edges.length,
      orphans: nodes.filter((n) => n.orphan).length,
      communities: new Set(nodes.map((n) => n.community)).size,
    },
  };
}

/* Per-database response cache (F235), invalidated on any link/note write. */
const CACHE_MAX_ENTRIES = 32;
const cache = new WeakMap<Db, Map<string, Graph>>();

const cacheKey = (filter: GraphFilter): string =>
  JSON.stringify([
    filter.notebookId ?? null,
    filter.tag ?? null,
    [...(filter.kinds ?? ['wikilink'])].sort(),
    filter.since ?? null,
  ]);

export function invalidateGraphCache(db: Db): void {
  cache.get(db)?.clear();
}

export function buildGraph(db: Db, filter: GraphFilter = {}): Graph {
  let entries = cache.get(db);
  if (!entries) {
    entries = new Map();
    cache.set(db, entries);
  }
  const key = cacheKey(filter);
  const hit = entries.get(key);
  if (hit) return hit;
  const graph = computeGraph(db, filter);
  if (entries.size >= CACHE_MAX_ENTRIES) entries.clear();
  entries.set(key, graph);
  return graph;
}

export const LOCAL_GRAPH_MAX_HOPS = 3;

/** BFS neighbourhood around one note over the (undirected) filtered graph (F233). */
export function localGraph(
  db: Db,
  noteId: NoteId,
  hops: number,
  filter: GraphFilter = {},
): Graph & { center: string } {
  const note = notesRepo(db).get(noteId);
  if (!note || note.trashedAt !== null) throw notFound('Note', noteId);
  const capped = Math.max(1, Math.min(hops, LOCAL_GRAPH_MAX_HOPS));

  const full = buildGraph(db, filter);
  const adjacency = new Map<string, string[]>();
  for (const edge of full.edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, []);
    adjacency.get(edge.source)!.push(edge.target);
    adjacency.get(edge.target)!.push(edge.source);
  }

  const reached = new Set<string>([noteId]);
  let frontier: string[] = [noteId];
  for (let hop = 0; hop < capped && frontier.length > 0; hop += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbour of adjacency.get(id) ?? []) {
        if (reached.has(neighbour)) continue;
        reached.add(neighbour);
        next.push(neighbour);
      }
    }
    frontier = next;
  }

  const nodes = full.nodes.filter((n) => reached.has(n.id));
  const edges = full.edges.filter((e) => reached.has(e.source) && reached.has(e.target));
  return {
    center: noteId,
    nodes,
    edges,
    stats: {
      nodes: nodes.length,
      edges: edges.length,
      orphans: nodes.filter((n) => n.orphan).length,
      communities: new Set(nodes.map((n) => n.community)).size,
    },
  };
}

const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** GraphML serialization for the export endpoint (F238). */
export function toGraphML(graph: Graph): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="title" for="node" attr.name="title" attr.type="string"/>',
    '  <key id="type" for="node" attr.name="type" attr.type="string"/>',
    '  <key id="community" for="node" attr.name="community" attr.type="int"/>',
    '  <key id="kind" for="edge" attr.name="kind" attr.type="string"/>',
    '  <key id="weight" for="edge" attr.name="weight" attr.type="int"/>',
    '  <graph id="fables" edgedefault="directed">',
  ];
  for (const node of graph.nodes) {
    lines.push(
      `    <node id="${xmlEscape(node.id)}">`,
      `      <data key="title">${xmlEscape(node.title)}</data>`,
      `      <data key="type">${node.type}</data>`,
      `      <data key="community">${node.community}</data>`,
      '    </node>',
    );
  }
  graph.edges.forEach((edge, i) => {
    lines.push(
      `    <edge id="e${i}" source="${xmlEscape(edge.source)}" target="${xmlEscape(edge.target)}">`,
      `      <data key="kind">${edge.kind}</data>`,
      `      <data key="weight">${edge.weight}</data>`,
      '    </edge>',
    );
  });
  lines.push('  </graph>', '</graphml>', '');
  return lines.join('\n');
}
