/**
 * Built-in export-target registration (Epic 15, F1471).
 *
 * Each format target registers here so the `/export/:target` routes pick it up
 * automatically. Built by a parallel agent team: vault formats (Obsidian, Notion,
 * Logseq) and data/presentation formats (JSON, static site, PDF book).
 */

import type { ExporterRegistry } from './index.js';
import { ObsidianExporter } from './obsidian/exporter.js';
import { NotionExporter } from './notion/exporter.js';
import { LogseqExporter } from './logseq/exporter.js';
import { JsonExporter } from './json/exporter.js';
import { StaticSiteExporter } from './static-site/exporter.js';
import { PdfBookExporter } from './pdf-book/exporter.js';

export function registerBuiltinExporters(registry: ExporterRegistry): ExporterRegistry {
  registry.register(
    { name: 'json', description: 'Canonical full-fidelity JSON (best for backup + round-trip)' },
    () => new JsonExporter(),
  );
  registry.register(
    { name: 'obsidian', description: 'Obsidian vault (markdown + frontmatter + attachments)' },
    () => new ObsidianExporter(),
  );
  registry.register(
    { name: 'notion-md', description: 'Notion-importable markdown + index.csv' },
    () => new NotionExporter(),
  );
  registry.register(
    { name: 'logseq', description: 'Logseq graph (pages/ + journals/ outliner)' },
    () => new LogseqExporter(),
  );
  registry.register(
    { name: 'static-site', description: 'Read-only HTML vault (index + a page per note)' },
    () => new StaticSiteExporter(),
  );
  registry.register(
    { name: 'pdf-book', description: 'Print-ready HTML book (chaptered, print to PDF)' },
    () => new PdfBookExporter(),
  );
  return registry;
}
