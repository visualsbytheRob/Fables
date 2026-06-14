/**
 * Export SDK (F1471) — the surface an export target needs.
 *
 * Implement `ExportTarget` to serialize the harvested `ExportNote[]` into bundle
 * files; the framework handles harvesting (incl. FQL selection F1478), bundling
 * to a directory or `.zip`, and the registry. Built-in targets import from here.
 */

export type {
  ExportTarget,
  ExportNote,
  ExportAttachment,
  ExportFile,
  ExportResult,
} from './types.js';
export { textFile, safeName } from './types.js';
export { harvestNotes, notebookPathOf, type HarvestOptions } from './harvest.js';
export {
  runExport,
  writeFilesToDir,
  bundleToZip,
  ExporterRegistry,
  type ExporterInfo,
  type TargetFactory,
} from './runner.js';
