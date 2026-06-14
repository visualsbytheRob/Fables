/**
 * Export runner + registry (F1471).
 *
 * Runs an export target over harvested notes and bundles the result — either to a
 * directory on disk (the natural form for an Obsidian/Logseq vault or a static
 * site) or to a single `.zip` (a downloadable archive). The registry mirrors the
 * importer registry so adding a target is one `register` call.
 */

import fs from 'node:fs';
import path from 'node:path';
import { validation } from '@fables/core';
import { writeZip } from '../import/lib/zip-write.js';
import type { ExportFile, ExportNote, ExportResult, ExportTarget } from './types.js';

/** Run a target over the notes, returning the bundle files. */
export async function runExport(target: ExportTarget, notes: ExportNote[]): Promise<ExportFile[]> {
  return target.export(notes);
}

/** Write a bundle to a directory on disk (creating parents). */
export function writeFilesToDir(files: ExportFile[], destDir: string): ExportResult {
  let bytes = 0;
  for (const file of files) {
    const abs = path.join(destDir, file.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, file.data);
    bytes += file.data.length;
  }
  return { target: '', notes: 0, files: files.length, bytes, path: destDir };
}

/** Bundle a set of export files into a single `.zip` archive buffer. */
export function bundleToZip(files: ExportFile[]): Buffer {
  return writeZip(files.map((f) => ({ name: f.path, data: f.data })));
}

// ── Registry ─────────────────────────────────────────────────────────────────

export interface ExporterInfo {
  name: string;
  description: string;
}

export type TargetFactory = () => ExportTarget;

export class ExporterRegistry {
  private readonly factories = new Map<string, TargetFactory>();
  private readonly infos = new Map<string, ExporterInfo>();

  register(info: ExporterInfo, factory: TargetFactory): this {
    this.factories.set(info.name, factory);
    this.infos.set(info.name, info);
    return this;
  }

  has(name: string): boolean {
    return this.factories.has(name);
  }

  create(name: string): ExportTarget {
    const factory = this.factories.get(name);
    if (!factory) throw validation(`unknown export target "${name}"`, { target: name });
    return factory();
  }

  list(): ExporterInfo[] {
    return [...this.infos.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
