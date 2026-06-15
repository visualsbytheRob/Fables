export * from './ast.js';
export { FqlError, tokenize, type Token } from './tokenize.js';
export { parseFql } from './parse.js';
export { compileFql, escapeLike, type CompiledQuery } from './compile.js';
// FQL v2 (Epic 20, F1961–F1968)
export { extractVariables, substituteVariables, type SubstituteResult } from './variables.js';
export {
  aggregate,
  withComputed,
  type AggFn,
  type Metric,
  type AggregateSpec,
  type AggregateResult,
  type ComputedColumn,
} from './aggregate.js';
export {
  parseExpr,
  evaluateExpr,
  evalExpr,
  ExprError,
  type ExprNode,
  type ExprValue,
  type Row,
} from './expr.js';
export { explainQuery, type QueryPlan, type ExplainStep } from './explain.js';
export { lintQuery, type LintFinding, type LintSeverity } from './lint.js';
