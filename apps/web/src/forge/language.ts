/**
 * The CodeMirror 6 language package for `.fable` (F381): one extension
 * bundling compiler state, highlighting, diagnostics, completion, hover,
 * go-to-definition, rename, folding and format-on-save — all backed by the
 * real @fables/forge-dsl compiler.
 */
import type { Extension } from '@uiw/react-codemirror';
import type { CompileOptions } from '@fables/forge-dsl';
import { forgeCompileExtension } from './compileField.js';
import { forgeCompletion } from './completion.js';
import { forgeGoToDefinition } from './definition.js';
import { forgeDiagnostics } from './diagnostics.js';
import { forgeFolding } from './folding.js';
import { forgeFormatOnSave, type FormatOnSaveOptions } from './format.js';
import { forgeHighlight } from './highlight.js';
import { forgeHover } from './hover.js';
import { forgeRename } from './rename.js';
import './forge.css';

export interface ForgeLanguageConfig {
  /** Compiler options: knowledge resolver, include provider, severities. */
  compile?: CompileOptions;
  /** Format-on-save wiring (F378). Omit to disable the Mod-S binding. */
  save?: FormatOnSaveOptions;
}

/** Everything needed to edit Forge in CodeMirror. */
export function forge(config: ForgeLanguageConfig = {}): Extension {
  return [
    forgeCompileExtension(config.compile),
    forgeHighlight(),
    forgeDiagnostics(),
    forgeCompletion(),
    forgeHover(),
    forgeGoToDefinition(),
    forgeRename(),
    forgeFolding(),
    ...(config.save !== undefined ? [forgeFormatOnSave(config.save)] : []),
  ];
}
