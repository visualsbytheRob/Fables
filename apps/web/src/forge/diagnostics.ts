/**
 * Live diagnostics (F383): FORGE diagnostics from the shared compile field are
 * mapped to squiggle decorations and gutter markers. No @codemirror/lint
 * dependency — the mapping is a pure function (tested directly) and the
 * rendering uses plain view decorations.
 */
import { Decoration, EditorView, GutterMarker, gutter } from '@uiw/react-codemirror';
import type { DecorationSet, EditorState, Extension } from '@uiw/react-codemirror';
import { RangeSetBuilder } from '@uiw/react-codemirror';
import type { CompileResult, Diagnostic, Severity } from '@fables/forge-dsl';
import { forgeCompileField } from './compileField.js';

export interface MappedDiagnostic {
  readonly from: number;
  readonly to: number;
  readonly severity: Severity;
  readonly code: Diagnostic['code'];
  readonly message: string;
  /** 1-based line of the diagnostic start, for the gutter. */
  readonly line: number;
}

/**
 * Clamp compiler spans onto the current document. Zero-width spans (EOF,
 * synthetic nodes) are widened to one character so the squiggle is visible;
 * spans from a stale compile (during the idle debounce) are clamped into
 * range rather than dropped.
 */
export function mapDiagnostics(result: CompileResult, docLength: number): MappedDiagnostic[] {
  const out: MappedDiagnostic[] = [];
  for (const d of result.diagnostics) {
    let from = Math.max(0, Math.min(d.span.start.offset, docLength));
    let to = Math.max(from, Math.min(d.span.end.offset, docLength));
    if (to === from) {
      if (to < docLength) to = from + 1;
      else if (from > 0) from = to - 1;
      else continue; // empty document — nothing to underline
    }
    out.push({
      from,
      to,
      severity: d.severity,
      code: d.code,
      message: d.message,
      line: d.span.start.line,
    });
  }
  return out;
}

function severityClass(severity: Severity): string {
  return `cm-forge-diagnostic-${severity}`;
}

function buildDiagnosticDecorations(state: EditorState): DecorationSet {
  const result = state.field(forgeCompileField, false);
  if (result === undefined) return Decoration.none;
  const mapped = mapDiagnostics(result, state.doc.length).sort(
    (a, b) => a.from - b.from || a.to - b.to,
  );
  const builder = new RangeSetBuilder<Decoration>();
  for (const d of mapped) {
    builder.add(
      d.from,
      d.to,
      Decoration.mark({
        class: severityClass(d.severity),
        attributes: { title: `${d.code}: ${d.message}` },
      }),
    );
  }
  return builder.finish();
}

class DiagnosticGutterMarker extends GutterMarker {
  constructor(
    private readonly severity: Severity,
    private readonly messages: string[],
  ) {
    super();
  }

  override toDOM(): Node {
    const el = document.createElement('span');
    el.className = `cm-forge-gutter-marker cm-forge-gutter-${this.severity}`;
    el.title = this.messages.join('\n');
    el.textContent = this.severity === 'error' ? '●' : this.severity === 'warning' ? '▲' : '·';
    return el;
  }

  override eq(other: GutterMarker): boolean {
    return (
      other instanceof DiagnosticGutterMarker &&
      other.severity === this.severity &&
      other.messages.join('\n') === this.messages.join('\n')
    );
  }
}

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, hint: 2 };

/** Worst severity + all messages per 1-based line. */
export function diagnosticsByLine(
  result: CompileResult,
  docLength: number,
): Map<number, { severity: Severity; messages: string[] }> {
  const byLine = new Map<number, { severity: Severity; messages: string[] }>();
  for (const d of mapDiagnostics(result, docLength)) {
    const entry = byLine.get(d.line);
    if (entry === undefined) {
      byLine.set(d.line, { severity: d.severity, messages: [`${d.code}: ${d.message}`] });
    } else {
      entry.messages.push(`${d.code}: ${d.message}`);
      if (SEVERITY_RANK[d.severity] < SEVERITY_RANK[entry.severity]) {
        entry.severity = d.severity;
      }
    }
  }
  return byLine;
}

export function forgeDiagnostics(): Extension {
  return [
    EditorView.decorations.compute(['doc', forgeCompileField], buildDiagnosticDecorations),
    gutter({
      class: 'cm-forge-diagnostic-gutter',
      lineMarker(view, line) {
        const result = view.state.field(forgeCompileField, false);
        if (result === undefined) return null;
        const lineNumber = view.state.doc.lineAt(line.from).number;
        const entry = diagnosticsByLine(result, view.state.doc.length).get(lineNumber);
        if (entry === undefined) return null;
        return new DiagnosticGutterMarker(entry.severity, entry.messages);
      },
      lineMarkerChange: (update) =>
        update.docChanged ||
        update.startState.field(forgeCompileField, false) !==
          update.state.field(forgeCompileField, false),
    }),
  ];
}
