/**
 * @fables/forge-dsl — the Forge language compiler front-end.
 *
 * Pipeline: tokenize → parse → resolve → check. Everything is pure; file
 * access and knowledge-base lookups are injected interfaces.
 */

// Spans & source positions
export * from './span.js';

// Tokens & lexer
export * from './token.js';
export { tokenize } from './lexer.js';
export type { LexResult } from './lexer.js';

// AST & parser
export * from './ast.js';
export { parse, BINARY_PRECEDENCE } from './parser.js';
export type { ParseResult, ParseOptions } from './parser.js';

// AST infrastructure
export { walk, attachParents, ancestors, childrenOf } from './walker.js';
export type { WalkHooks } from './walker.js';
export {
  findAll,
  findAllWhere,
  findAllDiverts,
  findAllBindings,
  findAllChoices,
  findAllVarRefs,
  findKnot,
  nodeAtPosition,
} from './query.js';
export { serializeAst, astToPlainObject, AST_JSON_VERSION } from './serialize.js';
export { f } from './factory.js';
export { checkInvariants, assertInvariants } from './invariants.js';
export type { InvariantViolation } from './invariants.js';

// Printer & formatter
export { printStory, printExpr, printSegments, printDivert, escapeText } from './printer.js';
export type { PrintOptions } from './printer.js';
export { format, formatRange, checkFormatted } from './formatter.js';
export type { FormatConfig, FormatResult, FormatRange } from './formatter.js';

// Diagnostics
export {
  DiagnosticBag,
  DIAGNOSTIC_CATALOG,
  ALL_DIAGNOSTIC_CODES,
  parseSuppressions,
} from './diagnostics.js';
export type {
  Diagnostic,
  DiagnosticCode,
  Severity,
  SeverityConfig,
  RelatedSpan,
} from './diagnostics.js';
export {
  renderDiagnostic,
  renderDiagnostics,
  diagnosticToJson,
  diagnosticsToJson,
} from './render.js';
export type { RenderOptions, DiagnosticJson } from './render.js';
export { editDistance, suggestName, didYouMean } from './suggest.js';

// Symbols & semantics
export { resolve, reachableKnots, BUILTIN_FUNCTIONS } from './symbols.js';
export type {
  ForgeType,
  EntitySchema,
  KnowledgeResolver,
  FileProvider,
  StoryUnit,
  SymbolTable,
  TargetSymbol,
  GlobalSymbol,
  TempSymbol,
  TunnelCall,
  ResolveOptions,
  ResolveResult,
} from './symbols.js';
export { check, allBlocks } from './checker.js';
export type { CheckResult } from './checker.js';

// Top-level API (F399)
export { compile } from './compile.js';
export type { CompileOptions, CompileResult } from './compile.js';
