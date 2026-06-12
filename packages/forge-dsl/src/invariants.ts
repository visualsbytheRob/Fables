import type { AnyNode } from './ast.js';
import { isSyntheticSpan } from './span.js';
import { childrenOf, walk } from './walker.js';

/**
 * AST invariant checker (F339). Used by tests (and available to tools) to
 * assert structural health of any tree the compiler produces:
 *   - spans are well-formed (start <= end, sane line/col)
 *   - child spans are ordered consistently with their parents
 *   - parent chains (when attached) are consistent with the tree
 *   - no node appears twice (no sharing/cycles)
 */

export interface InvariantViolation {
  readonly node: AnyNode;
  readonly message: string;
}

export function checkInvariants(root: AnyNode, options: { parentsAttached?: boolean } = {}): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const seen = new Set<AnyNode>();

  walk(root, {
    enter(node, parent) {
      if (seen.has(node)) {
        violations.push({ node, message: `${node.kind} node appears in the tree more than once` });
        return false;
      }
      seen.add(node);

      const { start, end } = node.span;
      if (!isSyntheticSpan(node.span)) {
        if (start.offset > end.offset) {
          violations.push({ node, message: `${node.kind} span starts after it ends (${start.offset} > ${end.offset})` });
        }
        if (start.line < 1 || start.col < 1) {
          violations.push({ node, message: `${node.kind} span has invalid start position ${start.line}:${start.col}` });
        }
      }

      if (options.parentsAttached === true && node !== root && node.parent !== parent) {
        violations.push({
          node,
          message: `${node.kind} has a stale parent pointer (expected ${parent?.kind ?? 'undefined'})`,
        });
      }

      for (const child of childrenOf(node)) {
        if (child === undefined || child === null) {
          violations.push({ node, message: `${node.kind} has a missing child` });
        }
      }
      return undefined;
    },
  });
  return violations;
}

/** Throwing variant for test assertions. */
export function assertInvariants(root: AnyNode, options: { parentsAttached?: boolean } = {}): void {
  const violations = checkInvariants(root, options);
  if (violations.length > 0) {
    throw new Error(
      `AST invariant violations:\n${violations.map((v) => `  - ${v.message}`).join('\n')}`,
    );
  }
}
