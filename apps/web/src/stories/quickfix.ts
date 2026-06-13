/**
 * Quick fixes for FORGE diagnostics with obvious mechanical repairs (F515).
 * Each fix is a single text edit against the file the diagnostic lives in:
 *
 * - FORGE202 unknown divert target  → append a `=== name ===` knot stub
 * - FORGE304 unreachable content    → delete the unreachable line range
 * - FORGE209 unused variable        → delete the declaration line
 */
import type { Diagnostic } from '@fables/forge-dsl';

export interface QuickFix {
  readonly title: string;
  /** Replace [from, to) with `insert` in the diagnostic's file. */
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

/** Extend [from, to) to cover whole lines, eating the trailing newline. */
function fullLines(source: string, from: number, to: number): { from: number; to: number } {
  let start = source.lastIndexOf('\n', Math.max(0, from - 1)) + 1;
  let end = source.indexOf('\n', Math.max(from, to - 1));
  end = end === -1 ? source.length : end + 1;
  if (start > end) start = end;
  return { from: start, to: end };
}

const quoted = /"([^"]+)"/;

export function quickFixesFor(diagnostic: Diagnostic, source: string): QuickFix[] {
  switch (diagnostic.code) {
    case 'FORGE202': {
      const name = quoted.exec(diagnostic.message)?.[1];
      if (name === undefined) return [];
      const knot = name.split('.')[0] ?? name;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(knot)) return [];
      const lead = source.endsWith('\n') ? '\n' : '\n\n';
      return [
        {
          title: `Create knot "${knot}"`,
          from: source.length,
          to: source.length,
          insert: `${lead}=== ${knot} ===\nTODO: write ${knot}.\n-> END\n`,
        },
      ];
    }
    case 'FORGE304': {
      const range = fullLines(source, diagnostic.span.start.offset, diagnostic.span.end.offset);
      return [{ title: 'Remove unreachable content', ...range, insert: '' }];
    }
    case 'FORGE209': {
      const range = fullLines(source, diagnostic.span.start.offset, diagnostic.span.end.offset);
      const line = source.slice(range.from, range.to);
      // Only whole declaration lines are safe to delete mechanically.
      if (!/^\s*(VAR|CONST|~\s*temp)\b/.test(line)) return [];
      return [{ title: 'Remove unused declaration', ...range, insert: '' }];
    }
    default:
      return [];
  }
}

export function applyQuickFix(source: string, fix: QuickFix): string {
  return source.slice(0, fix.from) + fix.insert + source.slice(fix.to);
}
