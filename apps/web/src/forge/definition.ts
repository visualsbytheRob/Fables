/**
 * Go-to-definition (F385): resolves the symbol under a position to its
 * declaration span using the compile result. Wired as an F12 keymap command
 * and a Cmd/Ctrl-click handler.
 */
import { EditorSelection, EditorView, keymap } from '@uiw/react-codemirror';
import type { Extension } from '@uiw/react-codemirror';
import {
  nodeAtPosition,
  type CompileResult,
  type Span,
  type TargetSymbol,
} from '@fables/forge-dsl';
import { forgeCompileField } from './compileField.js';
import { knotAt } from './completion.js';

export interface DefinitionTarget {
  readonly name: string;
  readonly kind: 'knot' | 'stitch' | 'label' | 'variable' | 'temp';
  readonly span: Span;
}

function at(offset: number): { line: number; col: number; offset: number } {
  return { line: 0, col: 0, offset }; // nodeAtPosition only inspects .offset
}

/**
 * Resolve a dotted target path the way the compiler does: absolute first,
 * then relative to the knot (and stitch) containing `offset`.
 */
export function resolveTargetPath(
  result: CompileResult,
  path: readonly string[],
  offset: number,
): TargetSymbol | undefined {
  const joined = path.join('.');
  const direct = result.symbols.targets.get(joined);
  if (direct !== undefined) return direct;
  const knot = knotAt(result.ast, offset);
  if (knot === undefined) return undefined;
  const inKnot = result.symbols.targets.get(`${knot.name.name}.${joined}`);
  if (inKnot !== undefined) return inKnot;
  const stitch = knot.stitches.find(
    (s) => offset >= s.span.start.offset && offset <= s.span.end.offset,
  );
  if (stitch !== undefined) {
    return result.symbols.targets.get(`${knot.name.name}.${stitch.name.name}.${joined}`);
  }
  return undefined;
}

/** The declaration site for the divert target / variable reference at `offset`. */
export function definitionAt(result: CompileResult, offset: number): DefinitionTarget | undefined {
  const node = nodeAtPosition(result.ast, at(offset));
  if (node === undefined) return undefined;

  if (node.kind === 'Divert') {
    const target = resolveTargetPath(result, node.targetPath, offset);
    if (target === undefined) return undefined;
    return { name: target.fullPath, kind: target.kind, span: target.span };
  }

  const name =
    node.kind === 'VarRef' ? node.path.join('.') : node.kind === 'Identifier' ? node.name : null;
  if (name === null) return undefined;

  // Temps are scoped per knot; the editor compiles a single unnamed file.
  const knot = knotAt(result.ast, offset);
  const temp = result.symbols.temps.get(`::${knot?.name.name ?? ''}`)?.get(name);
  if (temp !== undefined) return { name, kind: 'temp', span: temp.span };

  const global = result.symbols.globals.get(name);
  if (global !== undefined) return { name, kind: 'variable', span: global.span };

  // Read counts and bare identifiers naming knots/stitches/labels.
  const path = node.kind === 'VarRef' ? node.path : [name];
  const target = resolveTargetPath(result, path, offset);
  if (target !== undefined) {
    return { name: target.fullPath, kind: target.kind, span: target.span };
  }
  return undefined;
}

/** Jump the selection to the definition of the symbol under the cursor. */
export function goToDefinition(view: EditorView): boolean {
  const result = view.state.field(forgeCompileField, false);
  if (result === undefined) return false;
  const def = definitionAt(result, view.state.selection.main.head);
  if (def === undefined) return false;
  const anchor = Math.min(def.span.start.offset, view.state.doc.length);
  const head = Math.min(def.span.end.offset, view.state.doc.length);
  view.dispatch({
    selection: EditorSelection.range(anchor, head),
    effects: EditorView.scrollIntoView(anchor, { y: 'center' }),
  });
  view.focus();
  return true;
}

export function forgeGoToDefinition(): Extension {
  return [
    keymap.of([{ key: 'F12', run: goToDefinition }]),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!event.metaKey && !event.ctrlKey) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        view.dispatch({ selection: EditorSelection.cursor(pos) });
        return goToDefinition(view);
      },
    }),
  ];
}
