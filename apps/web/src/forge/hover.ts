/**
 * Hover info (F386): variable type and initializer, knot summaries for divert
 * targets, and binding descriptions. The lookup is a pure function over the
 * compile result; the extension renders it through view hoverTooltip.
 */
import { hoverTooltip } from '@uiw/react-codemirror';
import type { EditorView, Extension } from '@uiw/react-codemirror';
import {
  findAll,
  nodeAtPosition,
  printExpr,
  type CompileResult,
  type ExprNode,
  type ForgeType,
  type KnotNode,
  BUILTIN_FUNCTIONS,
} from '@fables/forge-dsl';
import { forgeCompileField } from './compileField.js';
import { knotAt } from './completion.js';
import { resolveTargetPath } from './definition.js';

export interface HoverInfo {
  readonly from: number;
  readonly to: number;
  /** Plain-text lines; the first is the headline. */
  readonly lines: string[];
}

/** Best-effort static type of an initializer expression. */
export function simpleTypeOf(expr: ExprNode): ForgeType {
  switch (expr.kind) {
    case 'Literal':
      return typeof expr.value === 'boolean'
        ? 'bool'
        : typeof expr.value === 'number'
          ? 'number'
          : 'string';
    case 'ListLit':
      return 'list';
    case 'Unary':
      return expr.op === '-' ? 'number' : 'bool';
    case 'Binary': {
      switch (expr.op) {
        case '+': {
          const left = simpleTypeOf(expr.left);
          return left === 'list' ? 'list' : left === 'string' ? 'string' : 'number';
        }
        case '-':
          return simpleTypeOf(expr.left) === 'list' ? 'list' : 'number';
        case '*':
        case '/':
        case '%':
          return 'number';
        default:
          return 'bool'; // comparisons, logic, has/hasnt
      }
    }
    case 'Ternary': {
      const whenTrue = simpleTypeOf(expr.whenTrue);
      return whenTrue !== 'unknown' ? whenTrue : simpleTypeOf(expr.whenFalse);
    }
    case 'Call':
      return BUILTIN_FUNCTIONS[expr.callee.name]?.result ?? 'unknown';
    default:
      return 'unknown';
  }
}

function firstProseLine(knot: KnotNode): string | undefined {
  for (const item of knot.body.items) {
    if (item.kind !== 'TextLine') continue;
    const text = item.segments
      .map((s) => (s.kind === 'Text' ? s.text : ''))
      .join('')
      .trim();
    if (text !== '') return text.length > 80 ? `${text.slice(0, 77)}…` : text;
  }
  return undefined;
}

function knotSummary(result: CompileResult, knotName: string): string[] | undefined {
  const knot = result.ast.knots.find((k) => k.name.name === knotName);
  if (knot === undefined) return undefined;
  const choices = findAll(knot, 'Choice').length;
  const diverts = findAll(knot, 'Divert').length;
  const lines = [
    `=== ${knot.name.name} ===`,
    `${knot.stitches.length} stitch${knot.stitches.length === 1 ? '' : 'es'}, ${choices} choice${choices === 1 ? '' : 's'}, ${diverts} divert${diverts === 1 ? '' : 's'}`,
  ];
  const prose = firstProseLine(knot);
  if (prose !== undefined) lines.push(prose);
  return lines;
}

/** Hover payload for the symbol at `offset`, or null over plain prose. */
export function hoverInfoAt(result: CompileResult, offset: number): HoverInfo | null {
  const node = nodeAtPosition(result.ast, { line: 0, col: 0, offset });
  if (node === undefined) return null;
  const span = { from: node.span.start.offset, to: node.span.end.offset };

  if (node.kind === 'Divert') {
    if (
      node.targetPath.length === 1 &&
      (node.targetPath[0] === 'END' || node.targetPath[0] === 'DONE')
    ) {
      return { ...span, lines: [`-> ${node.targetPath[0]}`, 'ends this flow'] };
    }
    const target = resolveTargetPath(result, node.targetPath, offset);
    if (target === undefined) return null;
    if (target.kind === 'knot') {
      const summary = knotSummary(result, target.name);
      if (summary !== undefined) return { ...span, lines: summary };
    }
    return { ...span, lines: [`${target.kind} ${target.fullPath}`] };
  }

  if (node.kind === 'EntityRef') {
    const headline = node.field !== undefined ? `@${node.name}.${node.field}` : `@${node.name}`;
    const schema = result.symbols.entities.get(node);
    const lines = [headline, 'knowledge binding (entity)'];
    if (schema !== undefined && node.field !== undefined) {
      lines.push(`type: ${schema.fields[node.field] ?? 'unknown'}`);
    }
    return { ...span, lines };
  }

  if (node.kind === 'NoteRef') {
    return { ...span, lines: [`[[${node.title}]]`, 'knowledge binding (note)'] };
  }

  const name =
    node.kind === 'VarRef' && node.path.length === 1
      ? (node.path[0] as string)
      : node.kind === 'Identifier'
        ? node.name
        : null;
  if (name !== null) {
    const knot = knotAt(result.ast, offset);
    const temp = result.symbols.temps.get(`::${knot?.name.name ?? ''}`)?.get(name);
    if (temp !== undefined) {
      return {
        ...span,
        lines: [`temp ${name}: ${simpleTypeOf(temp.init)}`, `= ${printExpr(temp.init)}`],
      };
    }
    const global = result.symbols.globals.get(name);
    if (global !== undefined) {
      return {
        ...span,
        lines: [
          `${global.declKind} ${name}: ${simpleTypeOf(global.init)}`,
          `= ${printExpr(global.init)}`,
        ],
      };
    }
  }

  // Read counts: knot/stitch/label used as a value.
  if (node.kind === 'VarRef' || node.kind === 'Identifier') {
    const path = node.kind === 'VarRef' ? node.path : [node.name];
    const target = resolveTargetPath(result, path, offset);
    if (target !== undefined) {
      if (target.kind === 'knot') {
        const summary = knotSummary(result, target.name);
        if (summary !== undefined) {
          return { ...span, lines: [...summary, 'used here as a read count (number)'] };
        }
      }
      return { ...span, lines: [`${target.kind} ${target.fullPath}`, 'read count (number)'] };
    }
  }
  return null;
}

export function forgeHover(): Extension {
  return hoverTooltip((view: EditorView, pos: number) => {
    const result = view.state.field(forgeCompileField, false);
    if (result === undefined) return null;
    const info = hoverInfoAt(result, pos);
    if (info === null) return null;
    return {
      pos: Math.min(info.from, view.state.doc.length),
      end: Math.min(info.to, view.state.doc.length),
      above: true,
      create() {
        const dom = document.createElement('div');
        dom.className = 'cm-forge-hover';
        info.lines.forEach((line, i) => {
          const el = document.createElement('div');
          el.className = i === 0 ? 'cm-forge-hover-headline' : 'cm-forge-hover-line';
          el.textContent = line;
          dom.appendChild(el);
        });
        return { dom };
      },
    };
  });
}
