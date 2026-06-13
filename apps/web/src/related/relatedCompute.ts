/**
 * Pure functions for computing related-note suggestions (F751–F760).
 * These are intentionally dependency-free so they're easy to unit-test.
 */
import type { GraphData, GraphEdge } from '../api/client.js';

export interface RelatedNote {
  id: string;
  title: string;
  sharedLinks: number;
  sharedTags: number;
  score: number;
}

/**
 * From the local graph data (2-hop neighborhood), compute related note scores.
 * A node is "related" if it shares a link neighbour with the focal note.
 * Score = sharedLinks * 2 + sharedTags (tags not in graph edges currently,
 * so we just use link overlap).
 */
export function computeRelatedNotes(
  focalId: string,
  graphData: GraphData,
  limit = 10,
): RelatedNote[] {
  if (!graphData) return [];

  // Build adjacency: noteId → set of neighbor ids
  const adj = new Map<string, Set<string>>();
  const addEdge = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };
  for (const edge of graphData.edges) {
    addEdge(edge.source, edge.target);
  }

  const focalNeighbors = adj.get(focalId) ?? new Set<string>();
  const titleMap = new Map(graphData.nodes.map((n) => [n.id, n.title]));

  // Score candidates: 2-hop nodes that are not the focal
  const scores = new Map<string, number>();
  for (const neighbor of focalNeighbors) {
    for (const twoHop of adj.get(neighbor) ?? []) {
      if (twoHop === focalId || focalNeighbors.has(twoHop)) continue;
      scores.set(twoHop, (scores.get(twoHop) ?? 0) + 1);
    }
    // Direct neighbors are highly related
    scores.set(neighbor, (scores.get(neighbor) ?? 0) + 2);
  }

  const results: RelatedNote[] = [];
  for (const [id, score] of scores.entries()) {
    if (id === focalId) continue;
    results.push({
      id,
      title: titleMap.get(id) ?? 'Untitled',
      sharedLinks: score,
      sharedTags: 0,
      score,
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Pure: split edges into backlinks and forward links relative to focalId. */
export function partitionEdges(
  focalId: string,
  edges: GraphEdge[],
): { backlinks: GraphEdge[]; forwardLinks: GraphEdge[] } {
  const backlinks = edges.filter((e) => e.target === focalId);
  const forwardLinks = edges.filter((e) => e.source === focalId);
  return { backlinks, forwardLinks };
}
