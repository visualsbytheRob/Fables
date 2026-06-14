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
import { EvernoteAdapter } from './evernote/adapter.js';
import { RoamAdapter } from './roam/adapter.js';
import { LogseqAdapter } from './logseq/adapter.js';
import { DayOneAdapter } from './day-one/adapter.js';
import { SimplenoteAdapter } from './simplenote/adapter.js';
import { GoogleKeepAdapter } from './google-keep/adapter.js';
import { StandardNotesAdapter } from './standard-notes/adapter.js';
import { BearAdapter } from './bear/adapter.js';
import { JoplinAdapter } from './joplin/adapter.js';
import { MarkdownFolderAdapter } from './markdown/adapter.js';

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
  registry.register(
    { name: 'evernote', description: 'Evernote export (.enex, one per notebook)' },
    (input) => new EvernoteAdapter(asPathInput(input)),
  );
  registry.register(
    { name: 'roam', description: 'Roam Research JSON export' },
    (input) => new RoamAdapter(asPathInput(input)),
  );
  registry.register(
    { name: 'logseq', description: 'Logseq graph directory (markdown/org)' },
    (input) => new LogseqAdapter(asPathInput(input)),
  );
  registry.register(
    { name: 'day-one', description: 'Day One JSON export (journal entries + metadata)' },
    (input) => new DayOneAdapter(asPathInput(input)),
  );
  registry.register(
    { name: 'simplenote', description: 'Simplenote notes.json export' },
    (input) => new SimplenoteAdapter(asPathInput(input)),
  );
  registry.register(
    { name: 'google-keep', description: 'Google Keep (Takeout) JSON export' },
    (input) => new GoogleKeepAdapter(asPathInput(input)),
  );
  registry.register(
    { name: 'standard-notes', description: 'Standard Notes decrypted backup' },
    (input) => new StandardNotesAdapter(asPathInput(input)),
  );
  registry.register(
    { name: 'bear', description: 'Bear markdown export (tags, wikilinks, assets)' },
    (input) => new BearAdapter(asPathInput(input)),
  );
  registry.register(
    { name: 'joplin', description: 'Joplin .jex export (tarball of notes + resources)' },
    (input) => new JoplinAdapter(asPathInput(input)),
  );
  registry.register(
    { name: 'markdown', description: 'Generic folder of markdown (frontmatter dialects)' },
    (input) => new MarkdownFolderAdapter(asPathInput(input)),
  );
  // Further importers append registrations here (F1461+).
  return registry;
}
