/**
 * IR-level optimizations (F409): constant folding and dead-branch pruning.
 *
 * Folding happens on the AST expression tree just before emission, so the
 * lowering pass can also prune inline-conditional/ternary branches whose
 * condition folded to a literal. Folding is conservative: anything stateful
 * (RANDOM, host calls, read counts) or type-suspect is left alone, and `&&` /
 * `||` only fold when both sides are literal (the VM evaluates eagerly, so
 * dropping an unevaluated side could change PRNG consumption).
 */

import type { ExprNode, LiteralExprNode } from '@fables/forge-dsl';

export type ConstGlobals = ReadonlyMap<string, LiteralExprNode>;

export function isLiteral(e: ExprNode): e is LiteralExprNode {
  return e.kind === 'Literal';
}

function lit(template: ExprNode, value: boolean | number | string): LiteralExprNode {
  return { kind: 'Literal', span: template.span, value };
}

function truthy(v: boolean | number | string): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return v.length > 0;
}

/** Fold an expression tree. Returns the same node when nothing folded. */
export function foldExpr(expr: ExprNode, consts: ConstGlobals): ExprNode {
  switch (expr.kind) {
    case 'Literal':
    case 'ErrorExpr':
    case 'EntityRef':
      return expr;
    case 'VarRef': {
      if (expr.path.length === 1) {
        const c = consts.get(expr.path[0] as string);
        if (c !== undefined) return lit(expr, c.value);
      }
      return expr;
    }
    case 'ListLit': {
      const elements = expr.elements.map((e) => foldExpr(e, consts));
      return elements.some((e, i) => e !== expr.elements[i]) ? { ...expr, elements } : expr;
    }
    case 'Unary': {
      const operand = foldExpr(expr.operand, consts);
      if (isLiteral(operand)) {
        if (expr.op === '-' && typeof operand.value === 'number') return lit(expr, -operand.value);
        if (expr.op === '!') return lit(expr, !truthy(operand.value));
      }
      return operand !== expr.operand ? { ...expr, operand } : expr;
    }
    case 'Binary': {
      const left = foldExpr(expr.left, consts);
      const right = foldExpr(expr.right, consts);
      if (isLiteral(left) && isLiteral(right)) {
        const folded = foldBinary(expr.op, left.value, right.value);
        if (folded !== null) return lit(expr, folded);
      }
      return left !== expr.left || right !== expr.right ? { ...expr, left, right } : expr;
    }
    case 'Ternary': {
      const condition = foldExpr(expr.condition, consts);
      if (isLiteral(condition)) {
        // Dead-branch pruning: only the taken arm survives.
        return foldExpr(truthy(condition.value) ? expr.whenTrue : expr.whenFalse, consts);
      }
      const whenTrue = foldExpr(expr.whenTrue, consts);
      const whenFalse = foldExpr(expr.whenFalse, consts);
      return condition !== expr.condition || whenTrue !== expr.whenTrue || whenFalse !== expr.whenFalse
        ? { ...expr, condition, whenTrue, whenFalse }
        : expr;
    }
    case 'Call': {
      const args = expr.args.map((a) => foldExpr(a, consts));
      return args.some((a, i) => a !== expr.args[i]) ? { ...expr, args } : expr;
    }
  }
}

type Lit = boolean | number | string;

function foldBinary(op: string, a: Lit, b: Lit): Lit | null {
  if (typeof a === 'number' && typeof b === 'number') {
    switch (op) {
      case '+':
        return a + b;
      case '-':
        return a - b;
      case '*':
        return a * b;
      case '/':
        return b === 0 ? null : a / b;
      case '%':
        return b === 0 ? null : a % b;
      case '<':
        return a < b;
      case '<=':
        return a <= b;
      case '>':
        return a > b;
      case '>=':
        return a >= b;
    }
  }
  if (typeof a === 'string' && typeof b === 'string' && op === '+') return a + b;
  if (op === '==' && typeof a === typeof b) return a === b;
  if (op === '!=' && typeof a === typeof b) return a !== b;
  if (op === '&&') return truthy(a) && truthy(b);
  if (op === '||') return truthy(a) || truthy(b);
  return null;
}
