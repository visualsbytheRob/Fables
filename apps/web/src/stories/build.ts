/**
 * Client-side project compilation (F513/F514): compile the open buffers with
 * the real @fables/forge-dsl front-end, no server involved. The entry file is
 * compiled with a FileProvider over the in-memory project so INCLUDE works;
 * files the entry does not pull in are compiled standalone so every buffer
 * gets diagnostics.
 */
import { compile, computeLineStarts, offsetToPosition } from '@fables/forge-dsl';
import type { CompileResult, Diagnostic, FileProvider, Span } from '@fables/forge-dsl';

/** A diagnostic attributed to a project file (panel rows, F514). */
export interface ProjectProblem {
  readonly file: string;
  readonly diagnostic: Diagnostic;
}

export interface ProjectBuild {
  readonly entryPath: string;
  /** Compile result per entry-compiled file (entry + non-included files). */
  readonly results: ReadonlyMap<string, CompileResult>;
  /** Every diagnostic across the project, attributed to its file. */
  readonly problems: readonly ProjectProblem[];
  readonly errors: number;
  readonly warnings: number;
  /** The entry file's compile result (AST + symbols drive graph/playtest). */
  readonly entry: CompileResult | null;
  readonly ok: boolean;
}

/** Resolve INCLUDE paths against the in-memory buffers (exact, then basename). */
export function fileProviderFor(files: ReadonlyMap<string, string>): FileProvider {
  return {
    resolve(path) {
      const exact = files.get(path);
      if (exact !== undefined) return { fileName: path, source: exact };
      const base = path.split('/').pop() ?? path;
      for (const [name, source] of files) {
        if (name === base || name.split('/').pop() === base) return { fileName: name, source };
      }
      return null;
    },
  };
}

/** Pick the entry buffer: the configured one, else main.fable, else the first. */
export function pickEntryPath(files: ReadonlyMap<string, string>, preferred?: string): string {
  if (preferred !== undefined && files.has(preferred)) return preferred;
  if (files.has('main.fable')) return 'main.fable';
  const first = [...files.keys()].sort()[0];
  return first ?? 'main.fable';
}

export function buildProject(
  files: ReadonlyMap<string, string>,
  preferredEntry?: string,
): ProjectBuild {
  const entryPath = pickEntryPath(files, preferredEntry);
  const provider = fileProviderFor(files);
  const results = new Map<string, CompileResult>();
  const problems: ProjectProblem[] = [];
  const covered = new Set<string>();

  // The resolver stamps every shared-bag diagnostic with the *entry* file
  // name, even for spans inside INCLUDEd units. Recover real attribution by
  // matching the span's recorded line/col against each unit's line starts.
  const lineStarts = new Map<string, number[]>();
  const startsFor = (path: string): number[] | null => {
    const cached = lineStarts.get(path);
    if (cached !== undefined) return cached;
    const source = files.get(path);
    if (source === undefined) return null;
    const starts = computeLineStarts(source);
    lineStarts.set(path, starts);
    return starts;
  };
  const positionMatches = (path: string, span: Span): boolean => {
    const starts = startsFor(path);
    const source = files.get(path);
    if (starts === null || source === undefined || span.end.offset > source.length) return false;
    const pos = offsetToPosition(span.start.offset, starts);
    return pos.line === span.start.line && pos.col === span.start.col;
  };
  const attribute = (d: Diagnostic, defaultPath: string, unitPaths: readonly string[]): string => {
    const candidates = [d.file, defaultPath, ...unitPaths];
    for (const candidate of candidates) {
      if (candidate !== undefined && positionMatches(candidate, d.span)) return candidate;
    }
    return d.file ?? defaultPath;
  };

  const collect = (path: string, result: CompileResult): void => {
    results.set(path, result);
    const unitPaths = result.symbols.units
      .map((u) => u.fileName)
      .filter((f): f is string => f !== undefined);
    for (const f of unitPaths) covered.add(f);
    covered.add(path);
    for (const d of result.diagnostics) {
      problems.push({ file: attribute(d, path, unitPaths), diagnostic: d });
    }
  };

  const entrySource = files.get(entryPath);
  let entry: CompileResult | null = null;
  if (entrySource !== undefined) {
    entry = compile(entrySource, { fileName: entryPath, files: provider });
    collect(entryPath, entry);
  }

  // Files the entry never reached: compile each standalone so they still get
  // squiggle-grade diagnostics in the problems panel.
  for (const [path, source] of files) {
    if (covered.has(path)) continue;
    collect(path, compile(source, { fileName: path, files: provider }));
  }

  problems.sort(
    (a, b) =>
      (a.file === b.file ? 0 : a.file < b.file ? -1 : 1) ||
      a.diagnostic.span.start.offset - b.diagnostic.span.start.offset,
  );
  const errors = problems.filter((p) => p.diagnostic.severity === 'error').length;
  const warnings = problems.filter((p) => p.diagnostic.severity === 'warning').length;
  return { entryPath, results, problems, errors, warnings, entry, ok: errors === 0 };
}

/** The first problem in severity-then-position order (status-bar jump, F513). */
export function firstProblem(build: ProjectBuild): ProjectProblem | null {
  const error = build.problems.find((p) => p.diagnostic.severity === 'error');
  return error ?? build.problems[0] ?? null;
}
