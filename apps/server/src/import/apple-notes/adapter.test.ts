/**
 * Apple Notes / ENEX importer tests (F1429) — exercises the shared ENEX parser,
 * ENML→markdown (checklists, tables, media), folder mapping, date preservation,
 * and locked-note skipping, then materializes through the framework.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { notesRepo } from '../../db/repos/notes.js';
import { buildTitlesIndex } from '../../services/links.js';
import { normalizeRules, runImport } from '../framework/index.js';
import { parseEnex, normalizeEnexDate } from '../lib/enex.js';
import { enmlToMarkdown } from '../lib/enml.js';
import { AppleNotesAdapter } from './adapter.js';

/** Build a one-resource note's ENEX, computing the en-media hash from the bytes. */
function enexWith(opts: {
  title: string;
  contentInner: string;
  created?: string;
  tags?: string[];
  resourceBytes?: Buffer;
  resourceMime?: string;
  encrypted?: boolean;
}): string {
  let resourceBlock = '';
  let media = '';
  if (opts.resourceBytes) {
    const b64 = opts.resourceBytes.toString('base64');
    const mime = opts.resourceMime ?? 'image/png';
    const hash = crypto.createHash('md5').update(opts.resourceBytes).digest('hex');
    media = `<en-media hash="${hash}" type="${mime}"/>`;
    resourceBlock = `<resource><data encoding="base64">${b64}</data><mime>${mime}</mime><resource-attributes><file-name>scan.png</file-name></resource-attributes></resource>`;
  }
  const crypt = opts.encrypted ? '<en-crypt cipher="AES">xxxx</en-crypt>' : '';
  const tags = (opts.tags ?? []).map((t) => `<tag>${t}</tag>`).join('');
  return `<?xml version="1.0"?>
<en-export>
<note>
<title>${opts.title}</title>
<content><![CDATA[<en-note>${opts.contentInner}${media}${crypt}</en-note>]]></content>
${opts.created ? `<created>${opts.created}</created>` : ''}
<updated>20260101T000000Z</updated>
${tags}
${resourceBlock}
</note>
</en-export>`;
}

describe('ENEX parser', () => {
  it('parses titles, tags, dates, resources, and detects encryption', () => {
    const xml = enexWith({
      title: 'Trip',
      contentInner: '<div>hi</div>',
      created: '20260110T120000Z',
      tags: ['travel', 'spain'],
      resourceBytes: Buffer.from([1, 2, 3, 4]),
    });
    const [note] = parseEnex(xml);
    expect(note!.title).toBe('Trip');
    expect(note!.tags).toEqual(['travel', 'spain']);
    expect(note!.created).toBe('2026-01-10T12:00:00.000Z');
    expect(note!.resources).toHaveLength(1);
    expect(note!.encrypted).toBe(false);
  });

  it('normalizes ENEX dates', () => {
    expect(normalizeEnexDate('20260615T093000Z')).toBe('2026-06-15T09:30:00.000Z');
    expect(normalizeEnexDate(null)).toBeUndefined();
  });
});

describe('ENML → markdown', () => {
  it('converts checklists (F1425), tables (F1426), and media (F1424)', () => {
    const res = {
      md5: crypto
        .createHash('md5')
        .update(Buffer.from([9]))
        .digest('hex'),
      mime: 'image/png',
      filename: 'p.png',
      data: Buffer.from([9]),
    };
    const enml =
      `<en-note><div><en-todo checked="true"/>Pack bags</div>` +
      `<div><en-todo/>Book hotel</div>` +
      `<table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>` +
      `<en-media hash="${res.md5}" type="image/png"/></en-note>`;
    const { markdown, assets } = enmlToMarkdown(enml, [res]);
    expect(markdown).toContain('- [x] Pack bags');
    expect(markdown).toContain('- [ ] Book hotel');
    expect(markdown).toContain('| A | B |');
    expect(assets).toHaveLength(1);
    expect(markdown).toContain('{{asset:');
  });
});

describe('AppleNotesAdapter (F1422-F1428)', () => {
  let root: string;
  let db: Db;
  let dataDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-'));
    db = openDb(':memory:');
    migrate(db);
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-data-'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('maps a folder file → notebook, preserves dates, and imports media (F1423/F1424/F1427)', async () => {
    fs.writeFileSync(
      path.join(root, 'Travel.enex'),
      enexWith({
        title: 'Barcelona',
        contentInner: '<div>Gaudí everywhere</div>',
        created: '20260110T120000Z',
        resourceBytes: Buffer.from([1, 2, 3, 4]),
        resourceMime: 'image/png',
      }),
    );
    const adapter = new AppleNotesAdapter({ path: root });
    const docs = adapter.stage();
    expect(docs[0]!.notebookPath).toEqual(['Travel']);
    expect(docs[0]!.createdAt).toBe('2026-01-10T12:00:00.000Z');
    expect(docs[0]!.assets).toHaveLength(1);

    const result = await runImport(db, dataDir, adapter, normalizeRules({}));
    expect(result.imported).toBe(1);
    const note = notesRepo(db).get(buildTitlesIndex(db).get('barcelona')!)!;
    expect(note.body).toContain('Gaudí everywhere');
    expect(note.body).toContain('/api/v1/attachments/');
    expect(note.createdAt).toBe('2026-01-10T12:00:00.000Z');
  });

  it('detects and skips locked notes, reporting them (F1428)', () => {
    fs.writeFileSync(
      path.join(root, 'Secrets.enex'),
      enexWith({ title: 'Locked diary', contentInner: '<div>can’t see</div>', encrypted: true }),
    );
    const adapter = new AppleNotesAdapter({ path: root });
    const docs = adapter.stage();
    expect(docs).toHaveLength(0);
    expect(adapter.skippedLocked).toEqual(['Locked diary']);
  });
});
