/**
 * Folder/archive importer tests (F1459, part 2) — Bear, Joplin (.jex tar), and
 * the generic markdown-folder enhancer, plus the tar reader.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { notesRepo } from '../../db/repos/notes.js';
import { buildTitlesIndex } from '../../services/links.js';
import { normalizeRules, runImport } from '../framework/index.js';
import { readTar } from '../lib/tar.js';
import { BearAdapter } from '../bear/adapter.js';
import { JoplinAdapter } from '../joplin/adapter.js';
import { MarkdownFolderAdapter } from '../markdown/adapter.js';

let root: string;
let db: Db;
let dataDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-'));
  db = openDb(':memory:');
  migrate(db);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-data-'));
});
afterEach(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('Bear (F1451)', () => {
  it('harvests Bear tags (nested + multi-word) and keeps wikilinks', () => {
    fs.writeFileSync(
      path.join(root, 'Trip.md'),
      '# Trip\n\nVisited #spain/barcelona and #two words# with [[Packing List]].\n',
    );
    const docs = new BearAdapter({ path: root }).stage();
    expect(docs[0]!.title).toBe('Trip');
    expect(docs[0]!.tags).toEqual(expect.arrayContaining(['spain/barcelona', 'two-words']));
    expect(docs[0]!.body).toContain('{{link:packing list}}');
  });
});

describe('Generic markdown folder (F1458)', () => {
  it('reads frontmatter dialects (title, csv tags, dates)', async () => {
    fs.mkdirSync(path.join(root, 'Sub'));
    fs.writeFileSync(
      path.join(root, 'Sub', 'note.md'),
      '---\ntitle: My Note\ntags: alpha, beta\ncreated: 2026-03-04\n---\nBody with [[Other]].\n',
    );
    const adapter = new MarkdownFolderAdapter({ path: root });
    const docs = adapter.stage();
    expect(docs[0]!.title).toBe('My Note');
    expect(docs[0]!.tags).toEqual(['alpha', 'beta']);
    expect(docs[0]!.createdAt).toBe('2026-03-04T00:00:00.000Z');
    expect(docs[0]!.notebookPath).toEqual(['Sub']);

    const result = await runImport(db, dataDir, adapter, normalizeRules({}));
    expect(result.imported).toBe(1);
    expect(notesRepo(db).get(buildTitlesIndex(db).get('my note')!)!.body).toContain('[[Other]]');
  });
});

describe('tar reader + Joplin (F1457)', () => {
  it('reads a tar archive', () => {
    const tar = buildTar([{ name: 'hello.txt', data: Buffer.from('hi there') }]);
    const entries = readTar(tar);
    expect(entries[0]!.name).toBe('hello.txt');
    expect(entries[0]!.data.toString()).toBe('hi there');
  });

  it('imports notes + notebooks + resources from a .jex', async () => {
    const folderId = 'a'.repeat(32);
    const noteId = 'b'.repeat(32);
    const resId = 'c'.repeat(32);
    const folderItem = `Travel\n\nid: ${folderId}\ntype_: 2\n`;
    const noteItem =
      `Barcelona\n\nGreat trip ![photo](:/${resId})\n\n` +
      `id: ${noteId}\nparent_id: ${folderId}\nuser_created_time: 1700000000000\ntype_: 1\n`;
    const resItem = `photo.jpg\n\nid: ${resId}\nmime: image/jpeg\nfile_extension: jpg\ntype_: 4\n`;
    const jex = buildTar([
      { name: folderId, data: Buffer.from(folderItem) },
      { name: noteId, data: Buffer.from(noteItem) },
      { name: resId, data: Buffer.from(resItem) },
      { name: `resources/${resId}.jpg`, data: Buffer.from([1, 2, 3, 4]) },
    ]);
    const jexPath = path.join(root, 'export.jex');
    fs.writeFileSync(jexPath, jex);

    const adapter = new JoplinAdapter({ path: jexPath });
    const docs = adapter.stage();
    expect(docs).toHaveLength(1);
    expect(docs[0]!.title).toBe('Barcelona');
    expect(docs[0]!.notebookPath).toEqual(['Travel']);
    expect(docs[0]!.assets).toHaveLength(1);
    expect(docs[0]!.createdAt).toBe(new Date(1700000000000).toISOString());

    const result = await runImport(db, dataDir, adapter, normalizeRules({}));
    expect(result.imported).toBe(1);
    expect(notesRepo(db).get(buildTitlesIndex(db).get('barcelona')!)!.body).toContain(
      '/api/v1/attachments/',
    );
  });
});

/** Build an uncompressed ustar archive (CRC-free; reader doesn't validate checksum). */
function buildTar(files: { name: string; data: Buffer }[]): Buffer {
  const blocks: Buffer[] = [];
  for (const f of files) {
    const header = Buffer.alloc(512);
    header.write(f.name, 0, 'utf8');
    header.write('0000644', 100, 'ascii'); // mode
    header.write('0000000', 108, 'ascii');
    header.write('0000000', 116, 'ascii');
    header.write(f.data.length.toString(8).padStart(11, '0'), 124, 'ascii'); // size (octal)
    header.write('00000000000', 136, 'ascii');
    header[156] = '0'.charCodeAt(0); // typeflag = file
    header.write('ustar', 257, 'ascii');
    // Checksum: spaces then sum.
    header.write('        ', 148, 'ascii');
    let sum = 0;
    for (const b of header) sum += b;
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
    blocks.push(header);
    const padded = Buffer.alloc(Math.ceil(f.data.length / 512) * 512);
    f.data.copy(padded);
    blocks.push(padded);
  }
  blocks.push(Buffer.alloc(1024)); // two zero blocks = end
  return Buffer.concat(blocks);
}
