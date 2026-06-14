/**
 * Evernote importer tests (F1439) — notebook mapping, flat tags, resource hashes,
 * web-clip source handling, reminder attributes, and the streaming ENEX reader.
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
import { streamEnexNotes } from '../lib/enex.js';
import { EvernoteAdapter } from './adapter.js';

interface NoteSpec {
  title: string;
  body: string;
  tags?: string[];
  sourceUrl?: string;
  reminder?: string;
  created?: string;
}

function noteXml(n: NoteSpec): string {
  const tags = (n.tags ?? []).map((t) => `<tag>${t}</tag>`).join('');
  const attrs: string[] = [];
  if (n.sourceUrl) attrs.push(`<source-url>${n.sourceUrl}</source-url>`);
  if (n.reminder) attrs.push(`<reminder-time>${n.reminder}</reminder-time>`);
  const attrBlock = attrs.length ? `<note-attributes>${attrs.join('')}</note-attributes>` : '';
  return `<note><title>${n.title}</title><content><![CDATA[<en-note>${n.body}</en-note>]]></content>${
    n.created ? `<created>${n.created}</created>` : ''
  }${tags}${attrBlock}</note>`;
}

function enexDoc(notes: NoteSpec[]): string {
  return `<?xml version="1.0"?>\n<en-export>\n${notes.map(noteXml).join('\n')}\n</en-export>`;
}

let root: string;
let db: Db;
let dataDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'evernote-'));
  db = openDb(':memory:');
  migrate(db);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evernote-data-'));
});
afterEach(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('streaming ENEX reader (F1438)', () => {
  it('yields each note without loading the file as one array', () => {
    const file = path.join(root, 'Work.enex');
    fs.writeFileSync(
      file,
      enexDoc([
        { title: 'One', body: '<div>1</div>' },
        { title: 'Two', body: '<div>2</div>' },
        { title: 'Three', body: '<div>3</div>' },
      ]),
    );
    const titles = [...streamEnexNotes(file, 64)].map((n) => n.title); // tiny chunk forces streaming
    expect(titles).toEqual(['One', 'Two', 'Three']);
  });
});

describe('EvernoteAdapter (F1431-F1437)', () => {
  it('maps notebook, tags, web-clip source, and reminders', async () => {
    fs.writeFileSync(
      path.join(root, 'Research.enex'),
      enexDoc([
        {
          title: 'Clipped article',
          body: '<div>Important findings</div>',
          tags: ['science'],
          sourceUrl: 'https://example.com/a',
          reminder: '20260201T090000Z',
          created: '20260115T101500Z',
        },
      ]),
    );
    const adapter = new EvernoteAdapter({ path: root });
    const docs = adapter.stage();
    expect(docs[0]!.notebookPath).toEqual(['Research']);
    expect(docs[0]!.tags).toEqual(['science']);
    expect(docs[0]!.body).toContain('Clipped from');
    expect(docs[0]!.body).toContain('⏰ Reminder');
    expect((docs[0]!.metadata?.['lossy'] as string[]).some((l) => /web clip/.test(l))).toBe(true);

    const result = await runImport(db, dataDir, adapter, normalizeRules({}));
    expect(result.imported).toBe(1);
    const note = notesRepo(db).get(buildTitlesIndex(db).get('clipped article')!)!;
    expect(note.body).toContain('Important findings');
    expect(note.createdAt).toBe('2026-01-15T10:15:00.000Z');
  });

  it('treats each .enex file as its own notebook', () => {
    fs.writeFileSync(
      path.join(root, 'Personal.enex'),
      enexDoc([{ title: 'P', body: '<div>p</div>' }]),
    );
    fs.writeFileSync(path.join(root, 'Work.enex'), enexDoc([{ title: 'W', body: '<div>w</div>' }]));
    const docs = new EvernoteAdapter({ path: root }).stage();
    const byTitle = Object.fromEntries(docs.map((d) => [d.title, d.notebookPath]));
    expect(byTitle).toEqual({ P: ['Personal'], W: ['Work'] });
  });
});
