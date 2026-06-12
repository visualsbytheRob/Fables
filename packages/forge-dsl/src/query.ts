import type {
  AnyNode,
  ChoiceNode,
  DivertNode,
  EntityRefNode,
  KnotNode,
  NodeKind,
  NoteRefNode,
  StoryNode,
  VarRefExprNode,
} from './ast.js';
import type { Position } from './span.js';
import { walk } from './walker.js';

/** AST query helpers (F335). */

export function findAll<K extends NodeKind>(
  root: AnyNode,
  kind: K,
): Extract<AnyNode, { kind: K }>[] {
  const out: Extract<AnyNode, { kind: K }>[] = [];
  walk(root, {
    enter(node) {
      if (node.kind === kind) out.push(node as Extract<AnyNode, { kind: K }>);
    },
  });
  return out;
}

export function findAllWhere(root: AnyNode, predicate: (node: AnyNode) => boolean): AnyNode[] {
  const out: AnyNode[] = [];
  walk(root, {
    enter(node) {
      if (predicate(node)) out.push(node);
    },
  });
  return out;
}

/** Every divert in the story, including inline and tunnel diverts. */
export function findAllDiverts(root: AnyNode): DivertNode[] {
  return findAll(root, 'Divert');
}

/** Every knowledge binding: `@entity` references and `[[note]]` references. */
export function findAllBindings(root: AnyNode): (EntityRefNode | NoteRefNode)[] {
  return [...findAll(root, 'EntityRef'), ...findAll(root, 'NoteRef')].sort(
    (a, b) => a.span.start.offset - b.span.start.offset,
  );
}

export function findAllChoices(root: AnyNode): ChoiceNode[] {
  return findAll(root, 'Choice');
}

export function findAllVarRefs(root: AnyNode): VarRefExprNode[] {
  return findAll(root, 'VarRef');
}

export function findKnot(story: StoryNode, name: string): KnotNode | undefined {
  return story.knots.find((k) => k.name.name === name);
}

/** Innermost node whose span contains the given position. */
export function nodeAtPosition(root: AnyNode, position: Position): AnyNode | undefined {
  let best: AnyNode | undefined;
  walk(root, {
    enter(node) {
      const { start, end } = node.span;
      if (position.offset < start.offset || position.offset > end.offset) return false;
      if (
        best === undefined ||
        node.span.end.offset - node.span.start.offset <=
          best.span.end.offset - best.span.start.offset
      ) {
        best = node;
      }
      return undefined;
    },
  });
  return best;
}
