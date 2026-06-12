import type {
  BlockNode,
  DivertNode,
  EntityRefNode,
  ExprNode,
  StoryNode,
  VarDeclNode,
} from './ast.js';
import { SPECIAL_TARGETS } from './ast.js';
import { DiagnosticBag } from './diagnostics.js';
import type { Diagnostic, SeverityConfig } from './diagnostics.js';
import { parse } from './parser.js';
import type { Span } from './span.js';
import { didYouMean } from './suggest.js';
import { walk } from './walker.js';

/**
 * Symbol resolution (F351–F359): two-pass — declare everything across all
 * included files, then resolve every reference.
 */

export type ForgeType = 'bool' | 'number' | 'string' | 'list' | 'unknown';

/** Schema for an entity from the knowledge base (F357/F369). */
export interface EntitySchema {
  readonly name: string;
  readonly fields: Record<string, ForgeType>;
}

/**
 * Injected knowledge-base resolver. The server wires the real notes/entities
 * database in here; tests use stubs. Compiling without one simply skips
 * binding validation.
 */
export interface KnowledgeResolver {
  resolveEntity(name: string): EntitySchema | null;
  resolveNote(title: string): boolean;
  /** Optional: names used for did-you-mean hints. */
  entityNames?(): string[];
}

/** Injected file access for INCLUDE (F309/F358). The library itself does no I/O. */
export interface FileProvider {
  resolve(path: string, fromFile: string | undefined): { fileName: string; source: string } | null;
}

export interface StoryUnit {
  readonly story: StoryNode;
  readonly source: string;
  readonly fileName?: string;
}

export interface TargetSymbol {
  readonly kind: 'knot' | 'stitch' | 'label';
  readonly name: string;
  readonly fullPath: string;
  /** Name of the knot this target lives in ('' for file-level). */
  readonly knot: string;
  readonly span: Span;
  readonly file?: string;
  references: number;
}

export interface GlobalSymbol {
  readonly name: string;
  readonly declKind: 'VAR' | 'CONST';
  readonly span: Span;
  readonly file?: string;
  readonly init: ExprNode;
  references: number;
}

export interface TempSymbol {
  readonly name: string;
  readonly span: Span;
  readonly file?: string;
  readonly init: ExprNode;
  references: number;
}

export interface TunnelCall {
  readonly target: string;
  readonly span: Span;
  readonly file?: string;
}

export interface SymbolTable {
  /** Fully-qualified divert targets: `knot`, `knot.stitch`, `knot.label`, `knot.stitch.label`. */
  readonly targets: Map<string, TargetSymbol>;
  readonly knots: Map<string, TargetSymbol>;
  readonly globals: Map<string, GlobalSymbol>;
  /** Temp variables keyed by their containing knot ('' = preamble). */
  readonly temps: Map<string, Map<string, TempSymbol>>;
  /** Entity schemas resolved for each `@` binding node. */
  readonly entities: Map<EntityRefNode, EntitySchema>;
  /** Entry story first, then includes in resolution order. */
  readonly units: StoryUnit[];
  /** Knot-level divert graph; '' is the entry/preamble. */
  readonly knotGraph: Map<string, Set<string>>;
  readonly tunnelCalls: TunnelCall[];
  /** Knot name → spans of `->->` returns inside it. */
  readonly tunnelReturns: Map<string, Span[]>;
}

export interface ResolveOptions {
  readonly files?: FileProvider;
  readonly knowledge?: KnowledgeResolver;
  readonly severityConfig?: SeverityConfig;
}

export interface ResolveResult {
  readonly symbols: SymbolTable;
  readonly diagnostics: readonly Diagnostic[];
}

/** Built-in functions callable from logic (F315/F325). */
export const BUILTIN_FUNCTIONS: Record<string, { params: ForgeType[]; result: ForgeType }> = {
  RANDOM: { params: ['number', 'number'], result: 'number' },
  FLOOR: { params: ['number'], result: 'number' },
  CEILING: { params: ['number'], result: 'number' },
  ABS: { params: ['number'], result: 'number' },
  MIN: { params: ['number', 'number'], result: 'number' },
  MAX: { params: ['number', 'number'], result: 'number' },
  COUNT: { params: ['list'], result: 'number' },
  TURNS: { params: [], result: 'number' },
};

export function resolve(
  entry: StoryUnit,
  options: ResolveOptions = {},
  sharedBag?: DiagnosticBag,
): ResolveResult {
  const bag = sharedBag ?? makeBag(entry, options);
  const symbols: SymbolTable = {
    targets: new Map(),
    knots: new Map(),
    globals: new Map(),
    temps: new Map(),
    entities: new Map(),
    units: [],
    knotGraph: new Map(),
    tunnelCalls: [],
    tunnelReturns: new Map(),
  };

  // ── include graph (F358) ──────────────────────────────────────────────────
  loadIncludes(entry, options, symbols.units, bag, new Set(), []);

  // ── pass 1: declare (F352) ────────────────────────────────────────────────
  for (const unit of symbols.units) declareUnit(unit, symbols, bag, options);

  // ── pass 2: resolve references ────────────────────────────────────────────
  for (const unit of symbols.units) resolveUnit(unit, symbols, bag, options);

  // ── post passes ───────────────────────────────────────────────────────────
  reportUnusedVariables(symbols, bag);
  reportDeadKnots(symbols, bag);

  return { symbols, diagnostics: bag.all };
}

function makeBag(unit: StoryUnit, options: ResolveOptions): DiagnosticBag {
  const bag = new DiagnosticBag({
    ...(options.severityConfig !== undefined ? { severityConfig: options.severityConfig } : {}),
    ...(unit.fileName !== undefined ? { file: unit.fileName } : {}),
  });
  bag.loadSuppressions(unit.source);
  return bag;
}

// ── includes ─────────────────────────────────────────────────────────────────

function loadIncludes(
  unit: StoryUnit,
  options: ResolveOptions,
  units: StoryUnit[],
  bag: DiagnosticBag,
  visited: Set<string>,
  chain: string[],
): void {
  const key = unit.fileName ?? '<entry>';
  if (chain.includes(key)) {
    // The include node that closed the cycle reported below by caller.
    return;
  }
  if (visited.has(key)) return;
  visited.add(key);
  units.push(unit);

  for (const inc of unit.story.includes) {
    if (options.files === undefined) {
      bag.add('FORGE207', inc.span, `cannot resolve INCLUDE "${inc.path}": no file provider was supplied`);
      continue;
    }
    const file = options.files.resolve(inc.path, unit.fileName);
    if (file === null) {
      bag.add('FORGE207', inc.span, `included file "${inc.path}" was not found`);
      continue;
    }
    if (chain.includes(file.fileName) || file.fileName === key) {
      bag.add(
        'FORGE206',
        inc.span,
        `including "${inc.path}" creates a cycle: ${[...chain, key, file.fileName].join(' -> ')}`,
      );
      continue;
    }
    if (visited.has(file.fileName)) continue;
    const subBag = new DiagnosticBag({ file: file.fileName });
    subBag.loadSuppressions(file.source);
    const { story } = parse(file.source, { fileName: file.fileName, bag: subBag });
    bag.addAll(subBag.all);
    loadIncludes(
      { story, source: file.source, fileName: file.fileName },
      options,
      units,
      bag,
      visited,
      [...chain, key],
    );
  }
}

// ── pass 1: declarations ─────────────────────────────────────────────────────

function declareUnit(unit: StoryUnit, symbols: SymbolTable, bag: DiagnosticBag, _options: ResolveOptions): void {
  const file = unit.fileName;
  const declareTarget = (sym: TargetSymbol): void => {
    const existing = symbols.targets.get(sym.fullPath);
    if (existing !== undefined) {
      bag.add('FORGE201', sym.span, `duplicate ${sym.kind} "${sym.fullPath}"`, [
        {
          span: existing.span,
          message: `first declared here`,
          ...(existing.file !== undefined ? { file: existing.file } : {}),
        },
      ]);
      return;
    }
    symbols.targets.set(sym.fullPath, sym);
    if (sym.kind === 'knot') symbols.knots.set(sym.name, sym);
  };

  for (const decl of unit.story.declarations) declareGlobal(decl, symbols, bag, file);

  declareLabels(unit.story.preamble, '', '', declareTarget, file);

  for (const knot of unit.story.knots) {
    declareTarget({
      kind: 'knot',
      name: knot.name.name,
      fullPath: knot.name.name,
      knot: knot.name.name,
      span: knot.name.span,
      ...(file !== undefined ? { file } : {}),
      references: 0,
    });
    declareLabels(knot.body, knot.name.name, knot.name.name, declareTarget, file);
    for (const stitch of knot.stitches) {
      const fullPath = `${knot.name.name}.${stitch.name.name}`;
      declareTarget({
        kind: 'stitch',
        name: stitch.name.name,
        fullPath,
        knot: knot.name.name,
        span: stitch.name.span,
        ...(file !== undefined ? { file } : {}),
        references: 0,
      });
      declareLabels(stitch.body, knot.name.name, fullPath, declareTarget, file);
    }
  }
}

function declareGlobal(decl: VarDeclNode, symbols: SymbolTable, bag: DiagnosticBag, file: string | undefined): void {
  const existing = symbols.globals.get(decl.name.name);
  if (existing !== undefined) {
    bag.add('FORGE201', decl.name.span, `duplicate declaration of "${decl.name.name}"`, [
      {
        span: existing.span,
        message: 'first declared here',
        ...(existing.file !== undefined ? { file: existing.file } : {}),
      },
    ]);
    return;
  }
  symbols.globals.set(decl.name.name, {
    name: decl.name.name,
    declKind: decl.declKind,
    span: decl.name.span,
    ...(file !== undefined ? { file } : {}),
    init: decl.init,
    references: 0,
  });
}

/** Choice/gather labels are addressable: `knot.label` or `knot.stitch.label` (F351/F354). */
function declareLabels(
  block: BlockNode,
  knot: string,
  containerPath: string,
  declareTarget: (sym: TargetSymbol) => void,
  file: string | undefined,
): void {
  walk(block, {
    enter(node) {
      if ((node.kind === 'Choice' || node.kind === 'Gather') && node.label !== undefined) {
        const fullPath = containerPath === '' ? node.label.name : `${containerPath}.${node.label.name}`;
        declareTarget({
          kind: 'label',
          name: node.label.name,
          fullPath,
          knot,
          span: node.label.span,
          ...(file !== undefined ? { file } : {}),
          references: 0,
        });
      }
    },
  });
}

// ── pass 2: references ───────────────────────────────────────────────────────

interface Scope {
  readonly file: string | undefined;
  readonly knot: string;
  readonly containerPath: string;
}

function resolveUnit(unit: StoryUnit, symbols: SymbolTable, bag: DiagnosticBag, options: ResolveOptions): void {
  const file = unit.fileName;
  resolveBlock(unit.story.preamble, { file, knot: '', containerPath: '' }, symbols, bag, options);
  for (const decl of unit.story.declarations) {
    resolveExpr(decl.init, { file, knot: '', containerPath: '' }, symbols, bag, options);
  }
  for (const knot of unit.story.knots) {
    const scope: Scope = { file, knot: knot.name.name, containerPath: knot.name.name };
    resolveBlock(knot.body, scope, symbols, bag, options);
    for (const stitch of knot.stitches) {
      resolveBlock(
        stitch.body,
        { file, knot: knot.name.name, containerPath: `${knot.name.name}.${stitch.name.name}` },
        symbols,
        bag,
        options,
      );
    }
  }
}

function tempScope(symbols: SymbolTable, scope: Scope): Map<string, TempSymbol> {
  const key = `${scope.file ?? ''}::${scope.knot}`;
  let map = symbols.temps.get(key);
  if (map === undefined) {
    map = new Map();
    symbols.temps.set(key, map);
  }
  return map;
}

function resolveBlock(block: BlockNode, scope: Scope, symbols: SymbolTable, bag: DiagnosticBag, options: ResolveOptions): void {
  walk(block, {
    enter: (node) => {
      switch (node.kind) {
        case 'TempDecl': {
          const temps = tempScope(symbols, scope);
          const existing = temps.get(node.name.name) ?? symbols.globals.get(node.name.name);
          if (existing !== undefined) {
            bag.add('FORGE201', node.name.span, `duplicate declaration of "${node.name.name}"`, [
              {
                span: existing.span,
                message: 'first declared here',
                ...(existing.file !== undefined ? { file: existing.file } : {}),
              },
            ]);
          } else {
            temps.set(node.name.name, {
              name: node.name.name,
              span: node.name.span,
              ...(scope.file !== undefined ? { file: scope.file } : {}),
              init: node.init,
              references: 0,
            });
          }
          return;
        }
        case 'Assign': {
          const name = node.target.name;
          const temp = tempScope(symbols, scope).get(name);
          if (temp !== undefined) return;
          const global = symbols.globals.get(name);
          if (global !== undefined) {
            global.references++;
            return;
          }
          bag.add(
            'FORGE203',
            node.target.span,
            `cannot assign to unknown variable "${name}"${didYouMean(name, variableCandidates(symbols, scope))}`,
          );
          return;
        }
        case 'VarRef': {
          resolveVarRef(node.path, node.span, scope, symbols, bag);
          return;
        }
        case 'Call': {
          if (!(node.callee.name in BUILTIN_FUNCTIONS)) {
            bag.add(
              'FORGE203',
              node.callee.span,
              `unknown function "${node.callee.name}"${didYouMean(node.callee.name, Object.keys(BUILTIN_FUNCTIONS))}`,
            );
          }
          return;
        }
        case 'Divert': {
          resolveDivert(node, scope, symbols, bag);
          return;
        }
        case 'TunnelReturn': {
          const spans = symbols.tunnelReturns.get(scope.knot) ?? [];
          spans.push(node.span);
          symbols.tunnelReturns.set(scope.knot, spans);
          return;
        }
        case 'EntityRef': {
          resolveEntityRef(node, symbols, bag, options);
          return;
        }
        case 'NoteRef': {
          if (options.knowledge !== undefined && !options.knowledge.resolveNote(node.title)) {
            bag.add('FORGE205', node.span, `note "[[${node.title}]]" does not exist in the knowledge base`);
          }
          return;
        }
        default:
          return;
      }
    },
  });
}

function resolveExpr(expr: ExprNode, scope: Scope, symbols: SymbolTable, bag: DiagnosticBag, options: ResolveOptions): void {
  walk(expr, {
    enter(node) {
      if (node.kind === 'VarRef') resolveVarRef(node.path, node.span, scope, symbols, bag);
      else if (node.kind === 'EntityRef') resolveEntityRef(node, symbols, bag, options);
      else if (node.kind === 'Call' && !(node.callee.name in BUILTIN_FUNCTIONS)) {
        bag.add(
          'FORGE203',
          node.callee.span,
          `unknown function "${node.callee.name}"${didYouMean(node.callee.name, Object.keys(BUILTIN_FUNCTIONS))}`,
        );
      }
    },
  });
}

function resolveVarRef(path: string[], span: Span, scope: Scope, symbols: SymbolTable, bag: DiagnosticBag): void {
  const name = path.join('.');
  if (path.length === 1) {
    const simple = path[0] as string;
    const temp = tempScope(symbols, scope).get(simple);
    if (temp !== undefined) {
      temp.references++;
      return;
    }
    const global = symbols.globals.get(simple);
    if (global !== undefined) {
      global.references++;
      return;
    }
  }
  // Read counts: a knot/stitch/label used as a value (F354).
  const target = lookupTarget(path, scope, symbols);
  if (target !== undefined) {
    target.references++;
    return;
  }
  bag.add(
    'FORGE203',
    span,
    `unknown variable "${name}"${didYouMean(name, variableCandidates(symbols, scope))}`,
  );
}

function resolveDivert(node: DivertNode, scope: Scope, symbols: SymbolTable, bag: DiagnosticBag): void {
  if (node.targetPath.length === 0) return; // parse error already reported
  const joined = node.targetPath.join('.');
  const fromKnot = scope.knot;
  if (node.targetPath.length === 1 && SPECIAL_TARGETS.has(joined)) {
    return;
  }
  const target = lookupTarget(node.targetPath, scope, symbols);
  if (target === undefined) {
    bag.add(
      'FORGE202',
      node.span,
      `unknown divert target "${joined}"${didYouMean(joined, targetCandidates(symbols, scope))}`,
    );
    return;
  }
  target.references++;
  addEdge(symbols.knotGraph, fromKnot, target.knot);
  if (node.tunnel) {
    symbols.tunnelCalls.push({
      target: target.knot,
      span: node.span,
      ...(scope.file !== undefined ? { file: scope.file } : {}),
    });
  }
}

function lookupTarget(path: string[], scope: Scope, symbols: SymbolTable): TargetSymbol | undefined {
  const joined = path.join('.');
  const direct = symbols.targets.get(joined);
  if (direct !== undefined) return direct;
  if (scope.knot !== '') {
    // Relative to the current knot: stitch or label.
    const inKnot = symbols.targets.get(`${scope.knot}.${joined}`);
    if (inKnot !== undefined) return inKnot;
    // Relative to the current stitch: label.
    if (scope.containerPath !== scope.knot) {
      const inStitch = symbols.targets.get(`${scope.containerPath}.${joined}`);
      if (inStitch !== undefined) return inStitch;
    }
  } else {
    const inPreamble = symbols.targets.get(joined);
    if (inPreamble !== undefined) return inPreamble;
  }
  return undefined;
}

function variableCandidates(symbols: SymbolTable, scope: Scope): string[] {
  return [
    ...tempScopeNames(symbols, scope),
    ...symbols.globals.keys(),
    ...symbols.knots.keys(),
  ];
}

function tempScopeNames(symbols: SymbolTable, scope: Scope): string[] {
  const key = `${scope.file ?? ''}::${scope.knot}`;
  return [...(symbols.temps.get(key)?.keys() ?? [])];
}

function targetCandidates(symbols: SymbolTable, scope: Scope): string[] {
  const out: string[] = ['END', 'DONE'];
  for (const t of symbols.targets.values()) {
    out.push(t.fullPath);
    if (t.knot === scope.knot && t.kind !== 'knot') out.push(t.name);
  }
  return out;
}

function addEdge(graph: Map<string, Set<string>>, from: string, to: string): void {
  const set = graph.get(from) ?? new Set<string>();
  set.add(to);
  graph.set(from, set);
}

// ── post passes ──────────────────────────────────────────────────────────────

function reportUnusedVariables(symbols: SymbolTable, bag: DiagnosticBag): void {
  for (const sym of symbols.globals.values()) {
    if (sym.references === 0) {
      bag.add('FORGE209', sym.span, `${sym.declKind === 'CONST' ? 'constant' : 'variable'} "${sym.name}" is never used`);
    }
  }
  for (const temps of symbols.temps.values()) {
    for (const sym of temps.values()) {
      if (sym.references === 0) {
        bag.add('FORGE209', sym.span, `temporary "${sym.name}" is never used`);
      }
    }
  }
}

/** Dead-knot detection (F359): BFS over the knot graph from the entry point. */
export function reachableKnots(symbols: SymbolTable): Set<string> {
  const reachable = new Set<string>(['']);
  const queue = [''];
  const entryStory = symbols.units[0]?.story;
  // When the preamble has no content the story starts at the first knot.
  if (entryStory !== undefined && entryStory.preamble.items.length === 0) {
    const first = entryStory.knots[0];
    if (first !== undefined) {
      reachable.add(first.name.name);
      queue.push(first.name.name);
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const next of symbols.knotGraph.get(cur) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }
  return reachable;
}

function reportDeadKnots(symbols: SymbolTable, bag: DiagnosticBag): void {
  if (symbols.knots.size === 0) return;
  const reachable = reachableKnots(symbols);
  for (const knot of symbols.knots.values()) {
    if (!reachable.has(knot.name)) {
      bag.add('FORGE208', knot.span, `knot "${knot.name}" is unreachable from the story entry point`);
    }
  }
}

function resolveEntityRef(
  node: EntityRefNode,
  symbols: SymbolTable,
  bag: DiagnosticBag,
  options: ResolveOptions,
): void {
  if (options.knowledge === undefined) return;
  const lookupName = node.displayName ?? node.name;
  const schema = options.knowledge.resolveEntity(lookupName);
  if (schema === null) {
    const candidates = options.knowledge.entityNames?.() ?? [];
    bag.add(
      'FORGE204',
      node.span,
      `unknown entity "${lookupName}"${didYouMean(lookupName, candidates)}`,
    );
    return;
  }
  symbols.entities.set(node, schema);
}
