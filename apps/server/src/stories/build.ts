import path from 'node:path';
import { compile, parse } from '@fables/forge-dsl';
import type { FileProvider, Severity } from '@fables/forge-dsl';

/**
 * Compile-on-save pipeline (F504/F505) and INCLUDE-path integrity (F503).
 * Pure functions over an in-memory `path → source` map; the repos own the SQL
 * and the routes own the transactions.
 */

export interface StoredSpanPosition {
  line: number;
  col: number;
  offset: number;
}

/** A persisted diagnostic: forge-dsl diagnostics flattened to plain JSON. */
export interface StoredDiagnostic {
  severity: Severity;
  code: string;
  message: string;
  /** Project-relative path of the file the diagnostic points at. */
  file: string;
  span: { start: StoredSpanPosition; end: StoredSpanPosition };
}

export interface BuildOutcome {
  status: 'valid' | 'broken';
  errorCount: number;
  warningCount: number;
  diagnostics: StoredDiagnostic[];
}

const ZERO_POS: StoredSpanPosition = { line: 1, col: 1, offset: 0 };

/** Normalise a project-relative path: forward slashes, no `./`, collapsed. */
export function normalizeProjectPath(p: string): string {
  const norm = path.posix.normalize(p.replaceAll('\\', '/'));
  return norm.startsWith('./') ? norm.slice(2) : norm;
}

/**
 * INCLUDE resolution order: relative to the including file's directory first,
 * then project-root relative. Escaping the project root never resolves.
 */
function resolveInclude(
  files: ReadonlyMap<string, string>,
  ref: string,
  fromFile: string | undefined,
): string | null {
  const candidates: string[] = [];
  if (fromFile !== undefined) {
    candidates.push(normalizeProjectPath(path.posix.join(path.posix.dirname(fromFile), ref)));
  }
  candidates.push(normalizeProjectPath(ref));
  for (const candidate of candidates) {
    if (!candidate.startsWith('../') && files.has(candidate)) return candidate;
  }
  return null;
}

/** FileProvider over a story's scenes for the forge-dsl front-end. */
export function sceneFileProvider(files: ReadonlyMap<string, string>): FileProvider {
  return {
    resolve(ref, fromFile) {
      const resolved = resolveInclude(files, ref.trim(), fromFile);
      if (resolved === null) return null;
      return { fileName: resolved, source: files.get(resolved) as string };
    },
  };
}

/** Compile a story project: entry file + provider over all its files. */
export function buildStory(entryFile: string, files: ReadonlyMap<string, string>): BuildOutcome {
  const entrySource = files.get(entryFile);
  if (entrySource === undefined) {
    return {
      status: 'broken',
      errorCount: 1,
      warningCount: 0,
      diagnostics: [
        {
          severity: 'error',
          code: 'BUILD001',
          message: `entry file "${entryFile}" does not exist in this story`,
          file: entryFile,
          span: { start: ZERO_POS, end: ZERO_POS },
        },
      ],
    };
  }

  const result = compile(entrySource, {
    fileName: entryFile,
    files: sceneFileProvider(files),
  });
  const diagnostics: StoredDiagnostic[] = result.diagnostics.map((d) => ({
    severity: d.severity,
    code: d.code,
    message: d.message,
    file: d.file ?? entryFile,
    span: {
      start: { line: d.span.start.line, col: d.span.start.col, offset: d.span.start.offset },
      end: { line: d.span.end.line, col: d.span.end.col, offset: d.span.end.offset },
    },
  }));
  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = diagnostics.filter((d) => d.severity === 'warning').length;
  return { status: errorCount > 0 ? 'broken' : 'valid', errorCount, warningCount, diagnostics };
}

interface IncludeRef {
  /** Path text as written in the INCLUDE directive. */
  ref: string;
  /** Offsets of the full `INCLUDE <path>` directive in the source. */
  start: number;
  end: number;
  /** Project path the reference resolves to, or null when broken. */
  target: string | null;
}

function scanIncludes(
  files: ReadonlyMap<string, string>,
  filePath: string,
  source: string,
): IncludeRef[] {
  const { story } = parse(source, { fileName: filePath });
  return story.includes
    .filter((inc) => inc.path !== '')
    .map((inc) => ({
      ref: inc.path,
      start: inc.span.start.offset,
      end: inc.span.end.offset,
      target: resolveInclude(files, inc.path, filePath),
    }));
}

/** Project paths of every file whose INCLUDEs resolve to `target` (F503). */
export function findIncluders(files: ReadonlyMap<string, string>, target: string): string[] {
  const includers: string[] = [];
  for (const [filePath, source] of files) {
    if (filePath === target) continue;
    if (scanIncludes(files, filePath, source).some((inc) => inc.target === target)) {
      includers.push(filePath);
    }
  }
  return includers.sort();
}

/**
 * Rewrite INCLUDE references after renaming `oldPath` → `newPath` (F503).
 * Covers both directions: sibling files pointing at the renamed file, and the
 * renamed file's own relative includes when it changed directory. Returns the
 * sources that changed, keyed by their pre-rename project path — the caller
 * applies the path change itself.
 */
export function rewriteIncludesForRename(
  filesBefore: ReadonlyMap<string, string>,
  oldPath: string,
  newPath: string,
): Map<string, string> {
  const updated = new Map<string, string>();
  for (const [beforePath, source] of filesBefore) {
    const afterPath = beforePath === oldPath ? newPath : beforePath;
    const includes = scanIncludes(filesBefore, beforePath, source);
    let next = source;
    // Splice back-to-front so earlier offsets stay valid.
    for (const inc of [...includes].reverse()) {
      if (inc.target === null) continue; // already broken — leave untouched
      const targetAfter = inc.target === oldPath ? newPath : inc.target;
      // Canonical reference: relative to the including file's directory, the
      // first candidate the resolver tries — immune to root-level shadowing.
      const ref = path.posix.relative(path.posix.dirname(afterPath), targetAfter);
      if (ref !== inc.ref) {
        next = `${next.slice(0, inc.start)}INCLUDE ${ref}${next.slice(inc.end)}`;
      }
    }
    if (next !== source) updated.set(beforePath, next);
  }
  return updated;
}
