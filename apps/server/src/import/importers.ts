/**
 * Built-in importer registration (Epic 15).
 *
 * Each source importer (Notion F1411+, Apple Notes F1421+, Evernote F1431+,
 * Roam/Logseq F1441+, …) registers its source adapter here as it lands, so the
 * `/import/:source/*` routes pick it up automatically. Empty until the first
 * concrete importer is wired.
 */

import { validation } from '@fables/core';
import type { ImporterRegistry } from './framework/index.js';
import { NotionAdapter, type NotionInput } from './notion/adapter.js';

function asPathInput(input: unknown): { path: string } {
  if (
    typeof input === 'object' &&
    input !== null &&
    typeof (input as NotionInput).path === 'string'
  ) {
    return { path: (input as NotionInput).path };
  }
  throw validation('import input must be { path } pointing at the export');
}

export function registerBuiltinImporters(registry: ImporterRegistry): ImporterRegistry {
  registry.register(
    { name: 'notion', description: 'Notion "Markdown & CSV" export (.zip or folder)' },
    (input) => new NotionAdapter(asPathInput(input)),
  );
  // Further importers append registrations here (F1421+).
  return registry;
}
