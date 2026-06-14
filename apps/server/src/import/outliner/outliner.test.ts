/**
 * Outliner importer tests (F1449) — the shared model plus the Roam JSON and
 * Logseq directory adapters: block refs, page links, daily notes, namespaces,
 * queries, and block-uid preservation, then materialized through the framework.
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
import {
  detectDailyNote,
  outlinerToStaged,
  queryToFql,
  sanitizeUid,
  type OutlinerPage,
} from './model.js';
import { RoamAdapter } from '../roam/adapter.js';
import { LogseqAdapter, filenameToTitle, parseOutliner } from '../logseq/adapter.js';

describe('shared model helpers', () => {
  it('detects daily notes (Roam + Logseq formats)', () => {
    expect(detectDailyNote('January 1st, 2026')).toBe('2026-01-01T00:00:00.000Z');
    expect(detectDailyNote('2026_06_15')).toBe('2026-06-15T00:00:00.000Z');
    expect(detectDailyNote('Just a page')).toBeUndefined();
  });

  it('sanitizes uids to the Fables block-id charset', () => {
    expect(sanitizeUid('abc_DEF-123')).toBe('abc-DEF-123');
  });

  it('translates queries best-effort to FQL', () => {
    expect(queryToFql('{and: [[Project]] #urgent}')).toBe('links:"Project" AND tag:urgent');
  });
});

describe('outliner → staged', () => {
  const pages: OutlinerPage[] = [
    {
      title: 'Alpha',
      blocks: [
        { uid: 'u1', text: 'A point worth linking', children: [] },
        { text: 'See [[Beta]] and ((u1)) and #tag1', children: [] },
      ],
    },
    { title: 'Beta', blocks: [{ text: 'beta body', children: [] }] },
    { title: 'January 1st, 2026', blocks: [{ text: 'journal entry', children: [] }] },
  ];

  it('renders bullets, anchors referenced blocks, links, tags, and daily notes', () => {
    const docs = outlinerToStaged(pages, {
      source: 'roam',
      namespaces: 'flat',
      journalNotebook: 'Journal',
    });
    const alpha = docs.find((d) => d.title === 'Alpha')!;
    // Referenced block carries its ^uid anchor (F1446); links + tags harvested.
    expect(alpha.body).toContain('^u1');
    expect(alpha.body).toContain('{{link:beta}}');
    expect(alpha.body).toContain('{{link:alpha}}'); // ((u1)) → owning page Alpha
    expect(alpha.tags).toContain('tag1');
    // Daily note routed to the Journal notebook with its date (F1444).
    const daily = docs.find((d) => d.title === 'January 1st, 2026')!;
    expect(daily.notebookPath).toEqual(['Journal']);
    expect(daily.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('nests namespace pages when enabled (F1448)', () => {
    const ns: OutlinerPage[] = [{ title: 'Projects/Alpha/Plan', blocks: [] }];
    const [doc] = outlinerToStaged(ns, {
      source: 'logseq',
      namespaces: 'nest',
      journalNotebook: 'Journal',
    });
    expect(doc!.notebookPath).toEqual(['Projects', 'Alpha']);
    expect(doc!.title).toBe('Plan');
  });
});

describe('Roam adapter (F1441)', () => {
  let dir: string;
  let db: Db;
  let dataDir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roam-'));
    db = openDb(':memory:');
    migrate(db);
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roam-data-'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('parses Roam JSON and materializes with resolved links', async () => {
    const json = [
      {
        title: 'Home',
        children: [
          { string: 'Welcome to [[Topics]]', uid: 'h1' },
          { string: 'Nested', children: [{ string: 'child block', uid: 'c1' }] },
        ],
      },
      { title: 'Topics', children: [{ string: 'a topic' }] },
    ];
    fs.writeFileSync(path.join(dir, 'export.json'), JSON.stringify(json));
    const adapter = new RoamAdapter({ path: path.join(dir, 'export.json') });
    const result = await runImport(db, dataDir, adapter, normalizeRules({}));
    expect(result.imported).toBe(2);
    const home = notesRepo(db).get(buildTitlesIndex(db).get('home')!)!;
    expect(home.body).toContain('[[Topics]]');
    expect(home.body).toContain('- Nested');
    expect(home.body).toContain('  - child block');
  });
});

describe('Logseq adapter (F1442)', () => {
  it('parses filenames and outliner indentation with id properties', () => {
    expect(filenameToTitle('Projects___Alpha.md')).toBe('Projects/Alpha');
    const blocks = parseOutliner('- top\n\t- child\n\t  id:: abc123\n- second');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.children[0]!.uid).toBe('abc123');
    expect(blocks[0]!.children[0]!.text).toBe('child');
  });

  it('imports pages and journals from a graph directory', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logseq-'));
    const db = openDb(':memory:');
    migrate(db);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logseq-data-'));
    try {
      fs.mkdirSync(path.join(dir, 'pages'));
      fs.mkdirSync(path.join(dir, 'journals'));
      fs.writeFileSync(path.join(dir, 'pages', 'Ideas.md'), '- An idea about [[Topics]]\n');
      fs.writeFileSync(path.join(dir, 'journals', '2026_06_15.md'), '- did things today\n');
      const result = await runImport(
        db,
        dataDir,
        new LogseqAdapter({ path: dir }),
        normalizeRules({}),
      );
      expect(result.imported).toBe(2);
      const ideas = notesRepo(db).get(buildTitlesIndex(db).get('ideas')!)!;
      expect(ideas.body).toContain('[[Topics]]');
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
