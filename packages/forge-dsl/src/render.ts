import type { Diagnostic } from './diagnostics.js';
import { spanExcerpt } from './span.js';

/**
 * Diagnostic rendering: pretty terminal frames with caret underlines (F343)
 * and a stable JSON shape for editor integration (F344).
 */

export interface RenderOptions {
  /** ANSI colors. Default false (safe for logs and snapshots). */
  readonly color?: boolean;
  /** Context lines around the offending line. Default 1. */
  readonly contextLines?: number;
}

const COLORS = {
  error: '[31m',
  warning: '[33m',
  hint: '[36m',
  bold: '[1m',
  dim: '[2m',
  reset: '[0m',
};

/** Render one diagnostic as a source-frame block. */
export function renderDiagnostic(diag: Diagnostic, source: string, options: RenderOptions = {}): string {
  const color = options.color === true;
  const paint = (text: string, code: string): string => (color ? `${code}${text}${COLORS.reset}` : text);
  const sevColor = COLORS[diag.severity];

  const lines: string[] = [];
  const location = `${diag.file ?? '<source>'}:${diag.span.start.line}:${diag.span.start.col}`;
  lines.push(
    `${paint(`${diag.severity}[${diag.code}]`, sevColor + COLORS.bold)}: ${diag.message}`,
  );
  lines.push(`  ${paint('-->', COLORS.dim)} ${location}`);

  const excerpt = spanExcerpt(source, diag.span, options.contextLines ?? 1);
  const gutterWidth = String(excerpt[excerpt.length - 1]?.line ?? 1).length;
  lines.push(`${' '.repeat(gutterWidth + 1)}${paint('|', COLORS.dim)}`);
  for (const ex of excerpt) {
    const gutter = String(ex.line).padStart(gutterWidth);
    lines.push(`${paint(`${gutter} |`, COLORS.dim)} ${ex.text}`);
    if (ex.underlineStart > 0) {
      const caret = ' '.repeat(ex.underlineStart - 1) + '^'.repeat(ex.underlineLength);
      lines.push(`${' '.repeat(gutterWidth)} ${paint('|', COLORS.dim)} ${paint(caret, sevColor)}`);
    }
  }
  for (const rel of diag.related ?? []) {
    lines.push(
      `  ${paint('=', COLORS.dim)} ${rel.message} (${rel.file ?? diag.file ?? '<source>'}:${rel.span.start.line}:${rel.span.start.col})`,
    );
  }
  return lines.join('\n');
}

/** Render a batch of diagnostics with a trailing summary line. */
export function renderDiagnostics(diags: readonly Diagnostic[], source: string, options: RenderOptions = {}): string {
  if (diags.length === 0) return 'No problems found.';
  const blocks = diags.map((d) => renderDiagnostic(d, source, options));
  const errors = diags.filter((d) => d.severity === 'error').length;
  const warnings = diags.filter((d) => d.severity === 'warning').length;
  const hints = diags.length - errors - warnings;
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  if (hints > 0) parts.push(`${hints} hint${hints === 1 ? '' : 's'}`);
  return `${blocks.join('\n\n')}\n\n${parts.join(', ')}.`;
}

/** Stable JSON shape for editors and CI (F344). */
export interface DiagnosticJson {
  readonly severity: string;
  readonly code: string;
  readonly message: string;
  readonly file: string | null;
  readonly range: {
    readonly start: { readonly line: number; readonly col: number; readonly offset: number };
    readonly end: { readonly line: number; readonly col: number; readonly offset: number };
  };
  readonly related: {
    readonly message: string;
    readonly file: string | null;
    readonly range: DiagnosticJson['range'];
  }[];
}

export function diagnosticToJson(diag: Diagnostic): DiagnosticJson {
  return {
    severity: diag.severity,
    code: diag.code,
    message: diag.message,
    file: diag.file ?? null,
    range: { start: diag.span.start, end: diag.span.end },
    related: (diag.related ?? []).map((r) => ({
      message: r.message,
      file: r.file ?? diag.file ?? null,
      range: { start: r.span.start, end: r.span.end },
    })),
  };
}

export function diagnosticsToJson(diags: readonly Diagnostic[]): string {
  return JSON.stringify(diags.map(diagnosticToJson), null, 2);
}
