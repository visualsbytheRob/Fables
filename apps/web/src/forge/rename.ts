/**
 * Rename refactor (F388): AST-position-based text edits for knots, stitches,
 * labels, globals and temps. Pure planning function + a view command that
 * prompts for the new name and dispatches the edits.
 */
import { keymap } from '@uiw/react-codemirror';
import type { EditorView } from '@uiw/react-codemirror';
import type { Extension } from '@uiw/react-codemirror';
import {
  findAll,
  nodeAtPosition,
  type CompileResult,
  type GlobalSymbol,
  type KnotNode,
  type Span,
  type TargetSymbol,
  type TempSymbol,
} from '@fables/forge-dsl';
import { forgeCompileField } from './compileField.js';
import { knotAt } from './completion.js';
import { resolveTargetPath } from './definition.js';

export interface RenameEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export type RenameOutcome =
  | {
      readonly ok: true;
      readonly kind: 'knot' | 'stitch' | 'label' | 'variable' | 'temp';
      readonly oldName: string;
      readonly newName: string;
      readonly edits: RenameEdit[];
    }
  | { readonly ok: false; readonly reason: string };

const IDENT = /^[A-Za-z_]\w*$/;
const IDENT_SCAN = /[A-Za-z_]\w*/g;

/**
 * The source range of the `index`-th identifier inside `span`. Divert and
 * VarRef spans contain exactly their path segments as identifiers, so this is
 * robust to spacing like `-> den . door`.
 */
export function identifierInSpan(source: string, span: Span, index: number): RenameEdit | null {
  const text = source.slice(span.start.offset, span.end.offset);
  IDENT_SCAN.lastIndex = 0;
  let i = 0;
  for (let m = IDENT_SCAN.exec(text); m !== null; m = IDENT_SCAN.exec(text)) {
    if (i === index) {
      return {
        from: span.start.offset + m.index,
        to: span.start.offset + m.index + m[0].length,
        insert: '',
      };
    }
    i++;
  }
  return null;
}

interface FoundSymbol {
  readonly kind: 'target' | 'global' | 'temp';
  readonly target?: TargetSymbol;
  readonly global?: GlobalSymbol;
  readonly temp?: TempSymbol;
  readonly tempKnot?: KnotNode;
}

function symbolAt(result: CompileResult, offset: number): FoundSymbol | undefined {
  const within = (span: Span): boolean => offset >= span.start.offset && offset <= span.end.offset;

  // Declaration sites first: target spans are exactly the name identifiers.
  for (const target of result.symbols.targets.values()) {
    if (within(target.span)) return { kind: 'target', target };
  }
  for (const global of result.symbols.globals.values()) {
    if (within(global.span)) return { kind: 'global', global };
  }
  for (const [key, temps] of result.symbols.temps) {
    for (const temp of temps.values()) {
      if (within(temp.span)) {
        const knotName = key.slice(key.indexOf('::') + 2);
        const tempKnot = result.ast.knots.find((k) => k.name.name === knotName);
        return { kind: 'temp', temp, ...(tempKnot !== undefined ? { tempKnot } : {}) };
      }
    }
  }

  // Reference sites.
  const node = nodeAtPosition(result.ast, { line: 0, col: 0, offset });
  if (node === undefined) return undefined;
  if (node.kind === 'Divert') {
    const target = resolveTargetPath(result, node.targetPath, offset);
    return target !== undefined ? { kind: 'target', target } : undefined;
  }
  const name =
    node.kind === 'VarRef'
      ? node.path.length === 1
        ? (node.path[0] as string)
        : null
      : node.kind === 'Identifier'
        ? node.name
        : null;
  if (node.kind === 'VarRef' && name === null) {
    const target = resolveTargetPath(result, node.path, offset);
    return target !== undefined ? { kind: 'target', target } : undefined;
  }
  if (name === null) return undefined;
  const knot = knotAt(result.ast, offset);
  const temp = result.symbols.temps.get(`::${knot?.name.name ?? ''}`)?.get(name);
  if (temp !== undefined) {
    return { kind: 'temp', temp, ...(knot !== undefined ? { tempKnot: knot } : {}) };
  }
  const global = result.symbols.globals.get(name);
  if (global !== undefined) return { kind: 'global', global };
  const target = resolveTargetPath(result, [name], offset);
  return target !== undefined ? { kind: 'target', target } : undefined;
}

function targetEdits(
  result: CompileResult,
  source: string,
  target: TargetSymbol,
  newName: string,
): RenameEdit[] {
  const fullSegs = target.fullPath.split('.');
  const renamedIdx = fullSegs.length - 1; // a target renames its own last segment
  const edits: RenameEdit[] = [
    { from: target.span.start.offset, to: target.span.end.offset, insert: newName },
  ];

  const refEdit = (span: Span, writtenPath: readonly string[], offset: number): void => {
    const resolved = resolveTargetPath(result, writtenPath, offset);
    if (resolved === undefined) return;
    const resolvedSegs = resolved.fullPath.split('.');
    // Does this reference pass through the renamed symbol?
    const passesThrough =
      resolved.fullPath === target.fullPath ||
      (target.kind !== 'label' && resolved.fullPath.startsWith(`${target.fullPath}.`));
    if (!passesThrough) return;
    // Written paths are suffixes of the resolved path (relative addressing).
    const writtenIdx = renamedIdx - (resolvedSegs.length - writtenPath.length);
    if (writtenIdx < 0) return; // written relatively, renamed segment not spelled out
    const seg = identifierInSpan(source, span, writtenIdx);
    if (seg !== null) edits.push({ ...seg, insert: newName });
  };

  for (const divert of findAll(result.ast, 'Divert')) {
    if (divert.targetPath.length === 0) continue;
    refEdit(divert.span, divert.targetPath, divert.span.start.offset);
  }
  for (const ref of findAll(result.ast, 'VarRef')) {
    // Skip plain variables — only read counts resolve to targets.
    if (ref.path.length === 1) {
      const name = ref.path[0] as string;
      const knot = knotAt(result.ast, ref.span.start.offset);
      if (result.symbols.temps.get(`::${knot?.name.name ?? ''}`)?.has(name) === true) continue;
      if (result.symbols.globals.has(name)) continue;
    }
    refEdit(ref.span, ref.path, ref.span.start.offset);
  }
  return edits;
}

function variableEdits(
  result: CompileResult,
  source: string,
  name: string,
  newName: string,
  declSpan: Span,
  scope: KnotNode | undefined, // undefined = global
): RenameEdit[] {
  const within = (span: Span): boolean =>
    scope === undefined ||
    (span.start.offset >= scope.span.start.offset && span.end.offset <= scope.span.end.offset);
  const edits: RenameEdit[] = [
    { from: declSpan.start.offset, to: declSpan.end.offset, insert: newName },
  ];
  for (const ref of findAll(result.ast, 'VarRef')) {
    if (ref.path.length !== 1 || ref.path[0] !== name || !within(ref.span)) continue;
    if (scope === undefined) {
      // Don't touch references that actually hit a temp shadow of the name.
      const knot = knotAt(result.ast, ref.span.start.offset);
      if (result.symbols.temps.get(`::${knot?.name.name ?? ''}`)?.has(name) === true) continue;
    }
    const seg = identifierInSpan(source, ref.span, 0);
    if (seg !== null) edits.push({ ...seg, insert: newName });
  }
  for (const assign of findAll(result.ast, 'Assign')) {
    if (assign.target.name !== name || !within(assign.target.span)) continue;
    edits.push({
      from: assign.target.span.start.offset,
      to: assign.target.span.end.offset,
      insert: newName,
    });
  }
  return edits;
}

/** Plan the rename of the symbol at `offset` to `newName`. */
export function renameAt(
  result: CompileResult,
  source: string,
  offset: number,
  newName: string,
): RenameOutcome {
  if (!IDENT.test(newName)) {
    return { ok: false, reason: `"${newName}" is not a valid Forge identifier` };
  }
  const found = symbolAt(result, offset);
  if (found === undefined) {
    return { ok: false, reason: 'no renameable symbol at the cursor' };
  }

  if (found.kind === 'target' && found.target !== undefined) {
    const target = found.target;
    const newPath = [...target.fullPath.split('.').slice(0, -1), newName].join('.');
    if (result.symbols.targets.has(newPath)) {
      return {
        ok: false,
        reason: `a ${result.symbols.targets.get(newPath)?.kind} named "${newPath}" already exists`,
      };
    }
    return {
      ok: true,
      kind: target.kind,
      oldName: target.name,
      newName,
      edits: sortEdits(targetEdits(result, source, target, newName)),
    };
  }

  if (found.kind === 'global' && found.global !== undefined) {
    const tempCollision = [...result.symbols.temps.values()].some((m) => m.has(newName));
    if (result.symbols.globals.has(newName) || tempCollision) {
      return { ok: false, reason: `a variable named "${newName}" already exists` };
    }
    return {
      ok: true,
      kind: 'variable',
      oldName: found.global.name,
      newName,
      edits: sortEdits(
        variableEdits(result, source, found.global.name, newName, found.global.span, undefined),
      ),
    };
  }

  if (found.kind === 'temp' && found.temp !== undefined) {
    const scopeKey = `::${found.tempKnot?.name.name ?? ''}`;
    if (
      result.symbols.globals.has(newName) ||
      result.symbols.temps.get(scopeKey)?.has(newName) === true
    ) {
      return { ok: false, reason: `a variable named "${newName}" already exists in this scope` };
    }
    return {
      ok: true,
      kind: 'temp',
      oldName: found.temp.name,
      newName,
      edits: sortEdits(
        variableEdits(result, source, found.temp.name, newName, found.temp.span, found.tempKnot),
      ),
    };
  }
  return { ok: false, reason: 'no renameable symbol at the cursor' };
}

function sortEdits(edits: RenameEdit[]): RenameEdit[] {
  const sorted = [...edits].sort((a, b) => a.from - b.from);
  return sorted.filter((e, i) => i === 0 || e.from !== sorted[i - 1]?.from);
}

/** Prompt-driven rename command, bound to F2. */
export function renameSymbol(view: EditorView): boolean {
  const result = view.state.field(forgeCompileField, false);
  if (result === undefined) return false;
  const source = view.state.doc.toString();
  const offset = view.state.selection.main.head;
  const probe = symbolProbeName(result, offset);
  if (probe === undefined) return false;
  const input = window.prompt(`Rename ${probe} to:`, probe);
  if (input === null || input.trim() === '' || input === probe) return true;
  const outcome = renameAt(result, source, offset, input.trim());
  if (!outcome.ok) {
    window.alert(`Cannot rename: ${outcome.reason}`);
    return true;
  }
  view.dispatch({ changes: outcome.edits.map(({ from, to, insert }) => ({ from, to, insert })) });
  return true;
}

function symbolProbeName(result: CompileResult, offset: number): string | undefined {
  const found = symbolAt(result, offset);
  if (found === undefined) return undefined;
  return found.target?.name ?? found.global?.name ?? found.temp?.name;
}

export function forgeRename(): Extension {
  return keymap.of([{ key: 'F2', run: renameSymbol }]);
}
