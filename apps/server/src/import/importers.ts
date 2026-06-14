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
import { NotionAdapter } from './notion/adapter.js';
import { AppleNotesAdapter } from './apple-notes/adapter.js';

function asPathInput(input: unknown): { path: string } {
  if (
    typeof input === 'object' &&
    input !== null &&
    typeof (input as { path?: unknown }).path === 'string'
  ) {
    return { path: (input as { path: string }).path };
  }
  throw validation('import input must be { path } pointing at the export');
}

export function registerBuiltinImporters(registry: ImporterRegistry): ImporterRegistry {
  registry.register(
    { name: 'notion', description: 'Notion "Markdown & CSV" export (.zip or folder)' },
    (input) => new NotionAdapter(asPathInput(input)),
  );
  registry.register(
    { name: 'apple-notes', description: 'Apple Notes via the Exporter app (.enex)' },
    (input) => new AppleNotesAdapter(asPathInput(input)),
  );
  // Further importers append registrations here (F1431+).
  return registry;
}
