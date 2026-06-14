/**
 * JSON-based importer tests (F1459, part 1) — Day One, Simplenote, Google Keep,
 * Standard Notes — staging assertions plus a materialization through the framework.
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
import { DayOneAdapter } from '../day-one/adapter.js';
import { SimplenoteAdapter } from '../simplenote/adapter.js';
import { GoogleKeepAdapter } from '../google-keep/adapter.js';
import { StandardNotesAdapter } from '../standard-notes/adapter.js';

let root: string;
let db: Db;
let dataDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'misc-'));
  db = openDb(':memory:');
  migrate(db);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'misc-data-'));
});
afterEach(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('Day One (F1452/F1453)', () => {
  it('imports entries with metadata and photos', async () => {
    fs.mkdirSync(path.join(root, 'photos'));
    fs.writeFileSync(path.join(root, 'photos', 'abc123.jpeg'), Buffer.from([1, 2, 3]));
    fs.writeFileSync(
      path.join(root, 'Journal.json'),
      JSON.stringify({
        entries: [
          {
            uuid: 'E1',
            text: '# A great day\nWe hiked the ridge.',
            creationDate: '2026-05-01T08:00:00Z',
            tags: ['hiking'],
            starred: true,
            location: { placeName: 'Ridge Trail', country: 'Spain' },
            weather: { conditionsDescription: 'Sunny', temperatureCelsius: 21 },
            photos: [{ identifier: 'mom1', md5: 'abc123', type: 'jpeg' }],
          },
        ],
      }),
    );
    const adapter = new DayOneAdapter({ path: root });
    const docs = adapter.stage();
    expect(docs[0]!.title).toBe('A great day');
    expect(docs[0]!.tags).toEqual(['hiking']);
    expect(docs[0]!.body).toContain('📍 Ridge Trail, Spain');
    expect(docs[0]!.body).toContain('🌤️ Sunny (21°C)');
    expect(docs[0]!.assets).toHaveLength(1);

    const result = await runImport(db, dataDir, adapter, normalizeRules({}));
    expect(result.imported).toBe(1);
    const note = notesRepo(db).get(buildTitlesIndex(db).get('a great day')!)!;
    expect(note.body).toContain('/api/v1/attachments/');
    expect(note.notebookId).toBeTruthy();
  });
});

describe('Simplenote (F1454)', () => {
  it('uses the first line as the title and skips trashed', () => {
    fs.writeFileSync(
      path.join(root, 'notes.json'),
      JSON.stringify({
        activeNotes: [{ id: 'n1', content: 'Shopping list\nmilk\neggs', tags: ['errands'] }],
        trashedNotes: [{ id: 'n2', content: 'old' }],
      }),
    );
    const docs = new SimplenoteAdapter({ path: path.join(root, 'notes.json') }).stage();
    expect(docs).toHaveLength(1);
    expect(docs[0]!.title).toBe('Shopping list');
    expect(docs[0]!.body).toBe('milk\neggs');
    expect(docs[0]!.tags).toEqual(['errands']);
  });
});

describe('Google Keep (F1455)', () => {
  it('converts list items to checkboxes and labels to tags', () => {
    fs.writeFileSync(
      path.join(root, 'Groceries.json'),
      JSON.stringify({
        title: 'Groceries',
        listContent: [
          { text: 'Milk', isChecked: true },
          { text: 'Bread', isChecked: false },
        ],
        labels: [{ name: 'shopping' }],
        isPinned: true,
        createdTimestampUsec: 1_700_000_000_000_000,
      }),
    );
    const docs = new GoogleKeepAdapter({ path: root }).stage();
    expect(docs[0]!.title).toBe('Groceries');
    expect(docs[0]!.body).toContain('- [x] Milk');
    expect(docs[0]!.body).toContain('- [ ] Bread');
    expect(docs[0]!.tags).toEqual(expect.arrayContaining(['shopping', 'pinned']));
    expect(docs[0]!.createdAt).toBeTruthy();
  });
});

describe('Standard Notes (F1456)', () => {
  it('resolves tag references onto notes', () => {
    fs.writeFileSync(
      path.join(root, 'backup.txt'),
      JSON.stringify({
        items: [
          { uuid: 'u1', content_type: 'Note', content: { title: 'Idea', text: 'a thought' } },
          {
            uuid: 't1',
            content_type: 'Tag',
            content: { title: 'inbox', references: [{ uuid: 'u1' }] },
          },
          {
            uuid: 'u2',
            content_type: 'Note',
            content: { title: 'Gone', text: 'x', trashed: true },
          },
        ],
      }),
    );
    const docs = new StandardNotesAdapter({ path: path.join(root, 'backup.txt') }).stage();
    expect(docs).toHaveLength(1);
    expect(docs[0]!.title).toBe('Idea');
    expect(docs[0]!.tags).toEqual(['inbox']);
  });
});
