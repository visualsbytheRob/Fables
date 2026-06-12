import type { Span } from './span.js';

/** Diagnostic severity. `hint` is informational and never fails a compile. */
export type Severity = 'error' | 'warning' | 'hint';

/** A span elsewhere in the source that relates to the primary diagnostic (F341). */
export interface RelatedSpan {
  readonly span: Span;
  readonly message: string;
  readonly file?: string;
}

export interface Diagnostic {
  readonly severity: Severity;
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly span: Span;
  readonly file?: string;
  readonly related?: readonly RelatedSpan[];
}

/**
 * Stable diagnostic catalog (F342). Codes are append-only: never renumber,
 * never reuse. FORGE0xx = lexical, FORGE1xx = syntax, FORGE2xx = resolution,
 * FORGE3xx = semantic.
 */
export const DIAGNOSTIC_CATALOG = {
  FORGE001: { severity: 'error', title: 'Invalid character' },
  FORGE002: { severity: 'error', title: 'Unterminated string literal' },
  FORGE003: { severity: 'error', title: 'Unterminated block comment' },
  FORGE004: { severity: 'error', title: 'Malformed number literal' },
  FORGE101: { severity: 'error', title: 'Unexpected token' },
  FORGE102: { severity: 'error', title: 'Invalid expression' },
  FORGE103: { severity: 'error', title: 'Invalid declaration' },
  FORGE104: { severity: 'error', title: 'Unterminated inline expression' },
  FORGE105: { severity: 'error', title: 'Invalid divert target' },
  FORGE106: { severity: 'error', title: 'Invalid knot or stitch header' },
  FORGE107: { severity: 'warning', title: 'Choice nesting depth skips a level' },
  FORGE108: { severity: 'error', title: 'Invalid knowledge binding' },
  FORGE109: { severity: 'error', title: 'Stitch outside of knot' },
  FORGE110: { severity: 'error', title: 'Invalid INCLUDE directive' },
  FORGE201: { severity: 'error', title: 'Duplicate declaration' },
  FORGE202: { severity: 'error', title: 'Unknown divert target' },
  FORGE203: { severity: 'error', title: 'Unknown variable' },
  FORGE204: { severity: 'error', title: 'Unknown entity' },
  FORGE205: { severity: 'warning', title: 'Unknown note' },
  FORGE206: { severity: 'error', title: 'Include cycle detected' },
  FORGE207: { severity: 'error', title: 'Included file not found' },
  FORGE208: { severity: 'warning', title: 'Unreachable knot' },
  FORGE209: { severity: 'warning', title: 'Unused variable' },
  FORGE301: { severity: 'error', title: 'Type mismatch' },
  FORGE302: { severity: 'error', title: 'Condition must be boolean' },
  FORGE303: { severity: 'error', title: 'Invalid list operation' },
  FORGE304: { severity: 'warning', title: 'Unreachable content after divert' },
  FORGE305: { severity: 'warning', title: 'Once-only choices may exhaust' },
  FORGE306: { severity: 'warning', title: 'Unbalanced tunnel call/return' },
  FORGE307: { severity: 'error', title: 'Cannot reassign constant' },
  FORGE308: { severity: 'error', title: 'Invalid interpolation expression' },
  FORGE309: { severity: 'error', title: 'Unknown entity field' },
  FORGE310: { severity: 'warning', title: 'Empty choice' },
} as const satisfies Record<string, { severity: Severity; title: string }>;

export type DiagnosticCode = keyof typeof DIAGNOSTIC_CATALOG;

export const ALL_DIAGNOSTIC_CODES = Object.keys(DIAGNOSTIC_CATALOG) as DiagnosticCode[];

/** Per-compile severity overrides (F349). `'off'` disables a code entirely. */
export type SeverityConfig = Partial<Record<DiagnosticCode, Severity | 'off'>>;

/**
 * Collects diagnostics across all compiler phases. Compilation never stops at
 * the first error (F345); phases keep going and report everything they can.
 */
export class DiagnosticBag {
  private readonly items: Diagnostic[] = [];
  /** line number -> codes suppressed on that line (or 'all'). */
  private suppressions: Map<number, Set<string>> = new Map();
  private severityConfig: SeverityConfig;
  private file: string | undefined;

  constructor(options: { severityConfig?: SeverityConfig; file?: string } = {}) {
    this.severityConfig = options.severityConfig ?? {};
    this.file = options.file;
  }

  /**
   * Parse `// forge-ignore FORGE123` suppression comments (F348). A suppression
   * comment silences matching diagnostics on its own line and the line below.
   * `// forge-ignore` with no code silences everything on those lines.
   */
  loadSuppressions(source: string): void {
    this.suppressions = parseSuppressions(source);
  }

  add(
    code: DiagnosticCode,
    span: Span,
    message: string,
    related?: readonly RelatedSpan[],
  ): void {
    const configured = this.severityConfig[code];
    if (configured === 'off') return;
    const severity = configured ?? DIAGNOSTIC_CATALOG[code].severity;
    const line = span.start.line;
    for (const checkLine of [line, line - 1]) {
      const codes = this.suppressions.get(checkLine);
      if (codes && (codes.has('all') || codes.has(code))) return;
    }
    const diag: Diagnostic = {
      severity,
      code,
      message,
      span,
      ...(this.file !== undefined ? { file: this.file } : {}),
      ...(related && related.length > 0 ? { related } : {}),
    };
    this.items.push(diag);
  }

  addAll(diags: readonly Diagnostic[]): void {
    this.items.push(...diags);
  }

  get all(): readonly Diagnostic[] {
    return this.items;
  }

  get errors(): readonly Diagnostic[] {
    return this.items.filter((d) => d.severity === 'error');
  }

  get hasErrors(): boolean {
    return this.items.some((d) => d.severity === 'error');
  }

  /** Diagnostics sorted by file position, errors first within a position. */
  sorted(): Diagnostic[] {
    const rank: Record<Severity, number> = { error: 0, warning: 1, hint: 2 };
    return [...this.items].sort(
      (a, b) =>
        a.span.start.offset - b.span.start.offset ||
        rank[a.severity] - rank[b.severity] ||
        a.code.localeCompare(b.code),
    );
  }
}

const SUPPRESSION_RE = /\/\/\s*forge-ignore\b([^\n]*)/g;

export function parseSuppressions(source: string): Map<number, Set<string>> {
  const map = new Map<number, Set<string>>();
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    SUPPRESSION_RE.lastIndex = 0;
    const m = SUPPRESSION_RE.exec(line);
    if (!m) continue;
    const codes = (m[1] ?? '').match(/FORGE\d{3}/g);
    const set = map.get(i + 1) ?? new Set<string>();
    if (codes && codes.length > 0) for (const c of codes) set.add(c);
    else set.add('all');
    map.set(i + 1, set);
  }
  return map;
}
