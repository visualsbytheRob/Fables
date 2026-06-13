// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { computeRelatedNotes, partitionEdges } from './relatedCompute.js';
import type { GraphData } from '../api/client.js';

const makeGraph = (): GraphData => ({
  nodes: [
    { id: 'focal', type: 'note', title: 'Focal Note', notebookId: 'nb1', degree: 3, orphan: false, community: 0 },
    { id: 'a', type: 'note', title: 'Note A', notebookId: 'nb1', degree: 2, orphan: false, community: 0 },
    { id: 'b', type: 'note', title: 'Note B', notebookId: 'nb1', degree: 2, orphan: false, community: 0 },
    { id: 'c', type: 'note', title: 'Note C', notebookId: 'nb1', degree: 1, orphan: false, community: 0 },
    { id: 'd', type: 'note', title: 'Note D', notebookId: 'nb1', degree: 1, orphan: false, community: 1 },
  ],
  edges: [
    { source: 'focal', target: 'a', kind: 'wikilink', weight: 1 },
    { source: 'focal', target: 'b', kind: 'wikilink', weight: 1 },
    { source: 'a', target: 'c', kind: 'wikilink', weight: 1 },
    { source: 'b', target: 'c', kind: 'wikilink', weight: 1 },
    { source: 'b', target: 'd', kind: 'wikilink', weight: 1 },
  ],
  stats: { nodes: 5, edges: 5, orphans: 0, communities: 2 },
});

describe('computeRelatedNotes', () => {
  it('returns scored related notes', () => {
    const result = computeRelatedNotes('focal', makeGraph(), 10);
    expect(result.length).toBeGreaterThan(0);
    // All returned IDs should not be the focal
    expect(result.map((r) => r.id)).not.toContain('focal');
  });

  it('includes direct neighbors with high score', () => {
    const result = computeRelatedNotes('focal', makeGraph(), 10);
    const ids = result.map((r) => r.id);
    // a and b are direct neighbors — they should appear
    expect(ids).toContain('a');
    expect(ids).toContain('b');
  });

  it('scores note shared by multiple links higher', () => {
    const result = computeRelatedNotes('focal', makeGraph(), 10);
    // c is shared by both a and b (2-hop); d is only from b
    const cNote = result.find((r) => r.id === 'c');
    const dNote = result.find((r) => r.id === 'd');
    if (cNote && dNote) {
      expect(cNote.score).toBeGreaterThanOrEqual(dNote.score);
    }
  });

  it('respects the limit', () => {
    const result = computeRelatedNotes('focal', makeGraph(), 2);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('returns empty array when graphData is empty', () => {
    const empty: GraphData = { nodes: [], edges: [], stats: { nodes: 0, edges: 0, orphans: 0, communities: 0 } };
    expect(computeRelatedNotes('focal', empty, 10)).toEqual([]);
  });
});

describe('partitionEdges', () => {
  it('correctly splits backlinks and forward links', () => {
    const edges = makeGraph().edges;
    const { backlinks, forwardLinks } = partitionEdges('a', edges);
    expect(forwardLinks.every((e) => e.source === 'a')).toBe(true);
    expect(backlinks.every((e) => e.target === 'a')).toBe(true);
  });
});
