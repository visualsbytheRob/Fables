/**
 * Built-in importer registration (Epic 15).
 *
 * Each source importer (Notion F1411+, Apple Notes F1421+, Evernote F1431+,
 * Roam/Logseq F1441+, …) registers its source adapter here as it lands, so the
 * `/import/:source/*` routes pick it up automatically. Empty until the first
 * concrete importer is wired.
 */

import type { ImporterRegistry } from './framework/index.js';

export function registerBuiltinImporters(registry: ImporterRegistry): ImporterRegistry {
  // Concrete importers append registrations here (F1411+).
  return registry;
}
