import { describe, expect, it } from 'vitest';
import type { NotebookTreeNode } from '../api/client.js';
import {
  allNodes,
  breadcrumb,
  findNode,
  flattenTree,
  subtreeIds,
  validParents,
} from './notebookTreeModel.js';

const node = (
  id: string,
  children: NotebookTreeNode[] = [],
  parentId: string | null = null,
): NotebookTreeNode => ({
  id,
  parentId,
  name: id,
  icon: null,
  color: null,
  archived: false,
  createdAt: '2026-06-12T00:00:00Z',
  updatedAt: '2026-06-12T00:00:00Z',
  noteCount: 1,
  children,
});

// a ── b ── c
//  └─ d
const tree = [node('a', [node('b', [node('c', [], 'b')], 'a'), node('d', [], 'a')])];

describe('notebook tree model (F142/F148/F150)', () => {
  it('flattens only expanded branches with depths', () => {
    expect(flattenTree(tree, new Set()).map((r) => r.node.id)).toEqual(['a']);
    const rows = flattenTree(tree, new Set(['a', 'b']));
    expect(rows.map((r) => [r.node.id, r.depth])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
      ['d', 1],
    ]);
  });

  it('collects subtree ids and finds nodes', () => {
    expect([...subtreeIds(findNode(tree, 'b')!)]).toEqual(['b', 'c']);
    expect(findNode(tree, 'missing')).toBeNull();
    expect(allNodes(tree).map((n) => n.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('excludes self and descendants from move targets (cycle prevention)', () => {
    expect(validParents(tree, 'b').map((n) => n.id)).toEqual(['a', 'd']);
    expect(validParents(tree, 'a').map((n) => n.id)).toEqual([]);
  });

  it('builds breadcrumbs root → node', () => {
    expect(breadcrumb(tree, 'c').map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(breadcrumb(tree, 'missing')).toEqual([]);
  });
});
