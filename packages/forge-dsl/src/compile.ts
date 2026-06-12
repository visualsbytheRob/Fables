import type { StoryNode } from './ast.js';
import { check } from './checker.js';
import { DiagnosticBag } from './diagnostics.js';
import type { Diagnostic, SeverityConfig } from './diagnostics.js';
import { parse } from './parser.js';
import { resolve } from './symbols.js';
import type { FileProvider, KnowledgeResolver, SymbolTable } from './symbols.js';

/**
 * The compiler front-end pipeline (F399): tokenize → parse → resolve → check.
 * Pure — no I/O. Includes are loaded through an injected {@link FileProvider}
 * and knowledge bindings validate against an injected {@link KnowledgeResolver}.
 */

export interface CompileOptions {
  readonly fileName?: string;
  /** Resolves INCLUDE paths. Without one, INCLUDE directives report FORGE207. */
  readonly files?: FileProvider;
  /** Validates `@entity` / `[[note]]` bindings. Without one they are skipped. */
  readonly knowledge?: KnowledgeResolver;
  /** Promote/demote/disable diagnostics by code (F349). */
  readonly severityConfig?: SeverityConfig;
}

export interface CompileResult {
  readonly ast: StoryNode;
  /** All diagnostics from every phase, sorted by source position (F345). */
  readonly diagnostics: readonly Diagnostic[];
  readonly symbols: SymbolTable;
  /** True when there are no error-severity diagnostics. */
  readonly ok: boolean;
}

export function compile(source: string, options: CompileOptions = {}): CompileResult {
  const bag = new DiagnosticBag({
    ...(options.severityConfig !== undefined ? { severityConfig: options.severityConfig } : {}),
    ...(options.fileName !== undefined ? { file: options.fileName } : {}),
  });
  bag.loadSuppressions(source);

  const { story } = parse(source, {
    ...(options.fileName !== undefined ? { fileName: options.fileName } : {}),
    bag,
  });

  const { symbols } = resolve(
    {
      story,
      source,
      ...(options.fileName !== undefined ? { fileName: options.fileName } : {}),
    },
    {
      ...(options.files !== undefined ? { files: options.files } : {}),
      ...(options.knowledge !== undefined ? { knowledge: options.knowledge } : {}),
      ...(options.severityConfig !== undefined ? { severityConfig: options.severityConfig } : {}),
    },
    bag,
  );

  check(symbols, bag);

  return {
    ast: story,
    diagnostics: bag.sorted(),
    symbols,
    ok: !bag.hasErrors,
  };
}
