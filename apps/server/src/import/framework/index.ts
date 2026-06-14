/**
 * Importer SDK (F1409).
 *
 * The complete surface a source adapter (built-in or plugin) needs: implement
 * `SourceAdapter` to produce the staging IR, and the framework handles mapping,
 * the asset pipeline, link reconstruction, collisions, provenance, persistence,
 * and rollback. Built-in importers (Notion, Evernote, …) import from here too.
 */

export type {
  SourceAdapter,
  StagedDoc,
  StagedAsset,
  StagedLink,
  MappingRules,
  DryRunReport,
  DryRunDoc,
  ImportResult,
} from './types.js';
export { DEFAULT_MAPPING_RULES } from './types.js';
export { normalizeRules, mappedTags, notebookSegments, notebookLabel } from './mapping.js';
export { dryRun, runImport, rollbackImport, type RollbackResult } from './runner.js';
export {
  importBatchesRepo,
  type ImportBatch,
  type ImportBatchesRepo,
  type Provenance,
  type BatchStatus,
  type ArtifactKind,
} from './batches.js';
export { ImporterRegistry, type AdapterFactory, type ImporterInfo } from './registry.js';
export { importHealthReport, resyncImport, type ImportHealth } from './health.js';
