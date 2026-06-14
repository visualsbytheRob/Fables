/**
 * Round-trip fidelity (F1479) — export → import → compare.
 *
 * Exports a vault via the Obsidian target, writes it to disk, re-imports it
 * through the generic markdown importer into a fresh database, and asserts the
 * notes survive intact (title, body, tags, notebook). This guards every export
 * target + importer against silent fidelity loss.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import { tagsRepo } from '../db/repos/tags.js';
import { createNote } from '../services/notes.js';
import { buildTitlesIndex } from '../services/links.js';
import { MarkdownFolderAdapter } from '../import/markdown/adapter.js';
import { normalizeRules, runImport } from '../import/framework/index.js';
import { ObsidianExporter } from './obsidian/exporter.js';
import { harvestNotes, runExport, writeFilesToDir } from './index.js';

let src: Db;
let dst: Db;
let exportDir: string;
let dataDir: string;

beforeEach(() => {
  src = openDb(':memory:');
  migrate(src);
  dst = openDb(':memory:');
  migrate(dst);
  exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-export-'));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-data-'));
});
afterEach(() => {
  src.close();
  dst.close();
  fs.rmSync(exportDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('export → import round-trip (F1479)', () => {
  it('preserves title, body, tags, and notebook through Obsidian + markdown', async () => {
    // Seed a small vault.
    const work = notebooksRepo(src).create({ name: 'Work' });
    const note = createNote(src, {
      notebookId: work.id,
      title: 'Trip Plan',
      body: 'Visit Spain.\n\nSee the coast and eat well.',
    });
    for (const name of ['travel', 'spain']) {
      tagsRepo(src).linkNote(note.id, tagsRepo(src).ensure(name).id, false);
    }

    // Export → disk.
    const files = await runExport(new ObsidianExporter(), harvestNotes(src, dataDir, {}));
    writeFilesToDir(files, exportDir);

    // Re-import into a fresh DB through the markdown importer.
    const result = await runImport(
      dst,
      dataDir,
      new MarkdownFolderAdapter({ path: exportDir }),
      normalizeRules({}),
    );
    expect(result.imported).toBe(1);

    const reimported = notesRepo(dst).get(buildTitlesIndex(dst).get('trip plan')!)!;
    expect(reimported.title).toBe('Trip Plan');
    expect(reimported.body).toContain('Visit Spain.');
    expect(reimported.body).toContain('eat well.');
    const tags = tagsRepo(dst)
      .tagsForNote(reimported.id)
      .map((t) => t.name)
      .sort();
    expect(tags).toEqual(['spain', 'travel']);
  });

  it('round-trips a whole multi-note, multi-notebook vault by count', async () => {
    const a = notebooksRepo(src).create({ name: 'Alpha' });
    const b = notebooksRepo(src).create({ name: 'Beta' });
    for (let i = 0; i < 5; i += 1) {
      createNote(src, {
        notebookId: i % 2 === 0 ? a.id : b.id,
        title: `Note ${i}`,
        body: `body ${i}`,
      });
    }
    const files = await runExport(new ObsidianExporter(), harvestNotes(src, dataDir, {}));
    writeFilesToDir(files, exportDir);
    const result = await runImport(
      dst,
      dataDir,
      new MarkdownFolderAdapter({ path: exportDir }),
      normalizeRules({}),
    );
    expect(result.imported).toBe(5);
  });
});
