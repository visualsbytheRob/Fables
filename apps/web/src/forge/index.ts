/**
 * Forge editor integration (F378, F381–F390): the public surface the story
 * editing page (Day 6) builds on.
 */
export { forge, type ForgeLanguageConfig } from './language.js';
export {
  forgeCompileExtension,
  forgeCompileField,
  getCompileResult,
  COMPILE_IDLE_MS,
} from './compileField.js';
export { forgeHighlightSpans, tokenClassName, type ForgeTokenClass } from './tokens.js';
export { mapDiagnostics, diagnosticsByLine, type MappedDiagnostic } from './diagnostics.js';
export { forgeCompletionSource, knotAt } from './completion.js';
export { definitionAt, goToDefinition, resolveTargetPath } from './definition.js';
export { hoverInfoAt, simpleTypeOf, type HoverInfo } from './hover.js';
export { extractOutline, outlineFromResult, type OutlineEntry } from './outline.js';
export { OutlinePanel, type OutlinePanelProps } from './OutlinePanel.js';
export { renameAt, renameSymbol, type RenameEdit, type RenameOutcome } from './rename.js';
export { computeFoldRanges, foldedRanges, toggleFoldAtLine, type FoldRange } from './folding.js';
export { applyFormat, formatDocument, forgeFormatOnSave } from './format.js';
export { ForgePlaygroundPage } from './ForgePlayground.js';
