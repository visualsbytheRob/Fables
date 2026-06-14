/**
 * Export-framework tests (F1471, F1478) — harvesting (all / notebook / FQL),
 * notebook-path resolution, attachments, a reference target, and zip bundling
 * with a real CRC that round-trips through the reader.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { tagsRepo } from '../db/repos/tags.js';
import { createNote } from '../services/notes.js';
import { saveAttachmentFile } from '../attachments/store.js';
import { attachmentsRepo } from '../db/repos/attachments.js';
import { sha256Hex } from '../lib/hash.js';
import { readZip } from '../import/lib/zip.js';
import { bundleToZip, harvestNotes, runExport, writeFilesToDir } from './index.js';
import { textFile, type ExportNote, type ExportTarget } from './index.js';

let db: Db;
let dataDir: string;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-'));
});
afterEach(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** A trivial reference target: one markdown file per note under its notebook path. */
class RefTarget implements ExportTarget {
  readonly name = 'ref';
  export(notes: ExportNote[]) {
    return notes.map((n) =>
      textFile([...n.notebookPath, `${n.title}.md`].join('/'), `# ${n.title}\n\n${n.body}`),
    );
  }
}

describe('harvest (F1471/F1478)', () => {
  it('resolves notebook path, tags, and attachments', () => {
    const parent = notebooksRepo(db).create({ name: 'Work' });
    const child = notebooksRepo(db).create({ name: 'Projects', parentId: parent.id });
    const note = createNote(db, { notebookId: child.id, title: 'Plan', body: 'do things' });
    const tag = tagsRepo(db).ensure('important');
    tagsRepo(db).linkNote(note.id, tag.id, false);
    const bytes = Buffer.from([1, 2, 3]);
    const hash = sha256Hex(bytes);
    saveAttachmentFile(dataDir, hash, bytes);
    const att = attachmentsRepo(db).create({
      noteId: note.id,
      filename: 'a.bin',
      mime: 'application/octet-stream',
      size: bytes.length,
      hash,
    });
    void att;

    const [harvested] = harvestNotes(db, dataDir, {});
    expect(harvested!.notebookPath).toEqual(['Work', 'Projects']);
    expect(harvested!.tags).toEqual(['important']);
    expect(harvested!.attachments).toHaveLength(1);
    expect(harvested!.attachments[0]!.read().equals(bytes)).toBe(true);
  });

  it('selects by FQL query (F1478)', () => {
    const nb = notebooksRepo(db).create({ name: 'NB' });
    createNote(db, { notebookId: nb.id, title: 'Keep', body: 'x #alpha' });
    createNote(db, { notebookId: nb.id, title: 'Drop', body: 'y' });
    const harvested = harvestNotes(db, dataDir, { query: 'tag:alpha' });
    expect(harvested.map((n) => n.title)).toEqual(['Keep']);
  });
});

describe('targets + bundling', () => {
  it('runs a target and writes files to a directory', async () => {
    const nb = notebooksRepo(db).create({ name: 'Notes' });
    createNote(db, { notebookId: nb.id, title: 'Hello', body: 'world' });
    const notes = harvestNotes(db, dataDir, {});
    const files = await runExport(new RefTarget(), notes);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
    try {
      const result = writeFilesToDir(files, out);
      expect(result.files).toBe(1);
      expect(fs.existsSync(path.join(out, 'Notes', 'Hello.md'))).toBe(true);
      expect(fs.readFileSync(path.join(out, 'Notes', 'Hello.md'), 'utf8')).toContain('# Hello');
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it('bundles to a valid zip that the reader round-trips (real CRC)', async () => {
    const nb = notebooksRepo(db).create({ name: 'Notes' });
    createNote(db, { notebookId: nb.id, title: 'Z', body: 'zipped' });
    const files = await runExport(new RefTarget(), harvestNotes(db, dataDir, {}));
    const zip = bundleToZip(files);
    const entries = readZip(zip);
    expect(entries[0]!.name).toBe('Notes/Z.md');
    expect(entries[0]!.data.toString()).toContain('zipped');
  });
});
