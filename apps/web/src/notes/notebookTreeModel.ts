/**
 * Pure helpers behind the notebook tree (F142/F149/F150): flattening with
 * expand state, descendant collection for cycle-safe move targets.
 */
import type { Notebook, NotebookTreeNode } from '../api/client.js';

export interface FlatRow {
  node: NotebookTreeNode;
  depth: number;
  hasChildren: boolean;
}

/** Depth-first visible rows given the expanded id set. */
export function flattenTree(roots: NotebookTreeNode[], expanded: Set<string>): FlatRow[] {
  const rows: FlatRow[] = [];
  const visit = (node: NotebookTreeNode, depth: number) => {
    rows.push({ node, depth, hasChildren: node.children.length > 0 });
    if (expanded.has(node.id)) {
      for (const child of node.children) visit(child, depth + 1);
    }
  };
  for (const root of roots) visit(root, 0);
  return rows;
}

/** All ids in the subtree rooted at `node` (including itself). */
export function subtreeIds(node: NotebookTreeNode): Set<string> {
  const ids = new Set<string>();
  const visit = (n: NotebookTreeNode) => {
    ids.add(n.id);
    for (const child of n.children) visit(child);
  };
  visit(node);
  return ids;
}

export function findNode(roots: NotebookTreeNode[], id: string): NotebookTreeNode | null {
  for (const root of roots) {
    if (root.id === id) return root;
    const found = findNode(root.children, id);
    if (found) return found;
  }
  return null;
}

/** Every node, depth-first, regardless of expand state. */
export function allNodes(roots: NotebookTreeNode[]): NotebookTreeNode[] {
  const out: NotebookTreeNode[] = [];
  const visit = (n: NotebookTreeNode) => {
    out.push(n);
    n.children.forEach(visit);
  };
  roots.forEach(visit);
  return out;
}

/**
 * Valid re-parent targets for `id`: anywhere except itself or its own
 * descendants (cycle prevention, F150). `null` means "move to root".
 */
export function validParents(roots: NotebookTreeNode[], id: string): NotebookTreeNode[] {
  const node = findNode(roots, id);
  const forbidden = node ? subtreeIds(node) : new Set<string>();
  return allNodes(roots).filter((n) => !forbidden.has(n.id));
}

/** Ancestor chain (root → … → node) for breadcrumbs (F148). */
export function breadcrumb(roots: NotebookTreeNode[], id: string): Notebook[] {
  const path: Notebook[] = [];
  const visit = (nodes: NotebookTreeNode[], trail: Notebook[]): boolean => {
    for (const n of nodes) {
      const next = [...trail, n];
      if (n.id === id) {
        path.push(...next);
        return true;
      }
      if (visit(n.children, next)) return true;
    }
    return false;
  };
  visit(roots, []);
  return path;
}
