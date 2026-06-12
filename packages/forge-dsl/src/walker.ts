import type { AnyNode } from './ast.js';

/**
 * AST traversal (F332, F336): a single `childrenOf` defines the tree shape,
 * and the walker, parent pass, and invariant checker all share it.
 */

/** All direct child nodes of `node`, in source order. */
export function childrenOf(node: AnyNode): AnyNode[] {
  switch (node.kind) {
    case 'Story':
      return [
        ...node.headerTags,
        ...node.includes,
        ...node.declarations,
        ...node.preamble.items,
        ...node.knots,
      ];
    case 'Include':
      return [];
    case 'VarDecl':
      return [node.name, node.init];
    case 'Knot':
      return [node.name, ...node.tags, node.body, ...node.stitches];
    case 'Stitch':
      return [node.name, node.body];
    case 'Block':
      return [...node.items];
    case 'TextLine':
      return [...node.segments, ...node.tags];
    case 'Choice':
      return [
        ...(node.label ? [node.label] : []),
        ...node.conditions,
        ...node.prefix,
        ...(node.choiceOnly ?? []),
        ...node.outputOnly,
        ...node.tags,
        node.body,
      ];
    case 'Gather':
      return [...(node.label ? [node.label] : []), ...node.segments, ...node.tags];
    case 'LogicLine':
      return [node.stmt];
    case 'DivertLine':
      return [node.divert];
    case 'Divert':
    case 'TunnelReturn':
    case 'Text':
    case 'Glue':
    case 'EntityRef':
    case 'NoteRef':
    case 'Tag':
    case 'Identifier':
    case 'Literal':
    case 'VarRef':
    case 'ErrorExpr':
      return [];
    case 'Interpolation':
      return [node.expr];
    case 'InlineConditional':
      return [node.condition, node.thenBranch, ...(node.elseBranch ? [node.elseBranch] : [])];
    case 'Alternative':
      return [...node.branches];
    case 'Branch':
      return [...node.segments];
    case 'TempDecl':
      return [node.name, node.init];
    case 'Assign':
      return [node.target, node.value];
    case 'ExprStmt':
      return [node.expr];
    case 'ListLit':
      return [...node.elements];
    case 'Unary':
      return [node.operand];
    case 'Binary':
      return [node.left, node.right];
    case 'Ternary':
      return [node.condition, node.whenTrue, node.whenFalse];
    case 'Call':
      return [node.callee, ...node.args];
  }
}

export interface WalkHooks {
  /** Return `false` to skip this node's children. */
  enter?: (node: AnyNode, parent: AnyNode | undefined) => boolean | void;
  exit?: (node: AnyNode, parent: AnyNode | undefined) => void;
}

/** Depth-first walk with enter/exit hooks (F332). Iterative — fuzz-safe on deep trees. */
export function walk(root: AnyNode, hooks: WalkHooks): void {
  type Frame = { node: AnyNode; parent: AnyNode | undefined; entered: boolean };
  const stack: Frame[] = [{ node: root, parent: undefined, entered: false }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1] as Frame;
    if (!frame.entered) {
      frame.entered = true;
      const descend = hooks.enter?.(frame.node, frame.parent);
      if (descend === false) {
        stack.pop();
        hooks.exit?.(frame.node, frame.parent);
        continue;
      }
      const children = childrenOf(frame.node);
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ node: children[i] as AnyNode, parent: frame.node, entered: false });
      }
      if (children.length === 0) {
        stack.pop();
        hooks.exit?.(frame.node, frame.parent);
      }
    } else {
      stack.pop();
      hooks.exit?.(frame.node, frame.parent);
    }
  }
}

/** Attach `parent` pointers to every node for upward traversal (F336). */
export function attachParents(root: AnyNode): void {
  walk(root, {
    enter(node, parent) {
      node.parent = parent;
    },
  });
}

/** Walk upward from a node to the root using parent pointers. */
export function ancestors(node: AnyNode): AnyNode[] {
  const out: AnyNode[] = [];
  let cur = node.parent;
  while (cur !== undefined) {
    out.push(cur);
    cur = cur.parent;
  }
  return out;
}
