/**
 * OPML importer tests (F1464).
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
import { OpmlAdapter } from './adapter.js';

let root: string;
let db: Db;
let dataDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'opml-'));
  db = openDb(':memory:');
  migrate(db);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opml-data-'));
});
afterEach(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const FLAT_OPML = `<?xml version="1.0"?>
<opml version="2.0">
  <head><title>My feeds</title></head>
  <body>
    <outline text="Tech" title="Tech">
      <outline text="Hacker News" xmlUrl="https://news.ycombinator.com/rss" htmlUrl="https://news.ycombinator.com/" type="rss"/>
      <outline text="Lobsters" xmlUrl="https://lobste.rs/rss" type="rss"/>
    </outline>
    <outline text="Bookmarks">
      <outline text="GitHub" htmlUrl="https://github.com"/>
    </outline>
  </body>
</opml>`;

const SELF_CLOSE_OPML = `<?xml version="1.0"?>
<opml version="1.0">
  <body>
    <outline text="Feeds">
      <outline text="Feed A" xmlUrl="https://a.com/rss"/>
      <outline text="Feed B" xmlUrl="https://b.com/rss"/>
    </outline>
  </body>
</opml>`;

const ENTITY_OPML = `<?xml version="1.0"?>
<opml version="1.0">
  <body>
    <outline text="A &amp; B">
      <outline text="&lt;Child&gt;" htmlUrl="https://example.com"/>
    </outline>
  </body>
</opml>`;

describe('OpmlAdapter (F1464)', () => {
  it('maps each top-level outline to a StagedDoc', () => {
    const file = path.join(root, 'feeds.opml');
    fs.writeFileSync(file, FLAT_OPML);
    const docs = new OpmlAdapter({ path: file }).stage();
    expect(docs).toHaveLength(2);
    expect(docs[0]!.title).toBe('Tech');
    expect(docs[1]!.title).toBe('Bookmarks');
  });

  it('renders feed children as [text](xmlUrl) bullet items', () => {
    const file = path.join(root, 'feeds.opml');
    fs.writeFileSync(file, FLAT_OPML);
    const docs = new OpmlAdapter({ path: file }).stage();
    expect(docs[0]!.body).toContain('[Hacker News](https://news.ycombinator.com/rss)');
    expect(docs[0]!.body).toContain('[Lobsters](https://lobste.rs/rss)');
  });

  it('renders non-feed children as plain bullet items', () => {
    const file = path.join(root, 'feeds.opml');
    fs.writeFileSync(file, FLAT_OPML);
    const docs = new OpmlAdapter({ path: file }).stage();
    expect(docs[1]!.body).toContain('- GitHub');
  });

  it('handles self-closing outline tags', () => {
    const file = path.join(root, 'self.opml');
    fs.writeFileSync(file, SELF_CLOSE_OPML);
    const docs = new OpmlAdapter({ path: file }).stage();
    expect(docs).toHaveLength(1);
    expect(docs[0]!.body).toContain('[Feed A](https://a.com/rss)');
    expect(docs[0]!.body).toContain('[Feed B](https://b.com/rss)');
  });

  it('decodes XML entities in text attributes', () => {
    const file = path.join(root, 'entities.opml');
    fs.writeFileSync(file, ENTITY_OPML);
    const docs = new OpmlAdapter({ path: file }).stage();
    expect(docs[0]!.title).toBe('A & B');
    expect(docs[0]!.body).toContain('<Child>');
  });

  it('sourceId is title lowercased', () => {
    const file = path.join(root, 'feeds.opml');
    fs.writeFileSync(file, FLAT_OPML);
    const docs = new OpmlAdapter({ path: file }).stage();
    expect(docs[0]!.sourceId).toBe('tech');
    expect(docs[1]!.sourceId).toBe('bookmarks');
  });

  it('notebookPath is empty and tags/assets/links are empty arrays', () => {
    const file = path.join(root, 'feeds.opml');
    fs.writeFileSync(file, FLAT_OPML);
    const docs = new OpmlAdapter({ path: file }).stage();
    expect(docs[0]!.notebookPath).toEqual([]);
    expect(docs[0]!.tags).toEqual([]);
    expect(docs[0]!.assets).toEqual([]);
    expect(docs[0]!.links).toEqual([]);
  });

  it('accepts .xml extension', () => {
    const file = path.join(root, 'feeds.xml');
    fs.writeFileSync(file, FLAT_OPML);
    const docs = new OpmlAdapter({ path: file }).stage();
    expect(docs).toHaveLength(2);
  });

  it('rejects non-.opml/.xml files', () => {
    const file = path.join(root, 'feeds.txt');
    fs.writeFileSync(file, FLAT_OPML);
    expect(() => new OpmlAdapter({ path: file }).stage()).toThrow();
  });

  it('framework round-trip: runImport materialises docs to DB', async () => {
    const file = path.join(root, 'feeds.opml');
    fs.writeFileSync(file, FLAT_OPML);
    const adapter = new OpmlAdapter({ path: file });
    const result = await runImport(db, dataDir, adapter, normalizeRules({}));
    expect(result.imported).toBe(2);
    const note = notesRepo(db).get(buildTitlesIndex(db).get('tech')!)!;
    expect(note.body).toContain('[Hacker News]');
  });
});
