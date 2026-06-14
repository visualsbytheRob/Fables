/**
 * DOCX adapter tests (F1468 — docx portion).
 *
 * Builds minimal .docx archives in-process (a stored-method ZIP containing
 * word/document.xml) and verifies the adapter's StagedDoc output.
 * One test also does a framework round-trip via runImport.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { notesRepo } from '../../db/repos/notes.js';
import { normalizeRules, runImport } from '../framework/index.js';
import { DocxAdapter } from './adapter.js';

// ── Minimal ZIP writer (stored method, CRC left 0) ───────────────────────────

interface ZipEntry {
  name: string;
  data: Buffer;
}

function writeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(0, 14); // crc
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(Buffer.concat([local, name, e.data]));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10); // stored
    central.writeUInt32LE(0, 16); // crc
    central.writeUInt32LE(e.data.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));

    offset += 30 + name.length + e.data.length;
  }

  const localBlock = Buffer.concat(locals);
  const centralBlock = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBlock.length, 12);
  eocd.writeUInt32LE(localBlock.length, 16);
  return Buffer.concat([localBlock, centralBlock, eocd]);
}

/** Build a minimal word/document.xml with the given paragraphs XML. */
function makeDocxXml(paragraphsXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphsXml}
  </w:body>
</w:document>`;
}

/** Build a .docx Buffer from raw paragraph XML snippets. */
function makeDocx(paragraphsXml: string): Buffer {
  const docXml = makeDocxXml(paragraphsXml);
  return writeZip([{ name: 'word/document.xml', data: Buffer.from(docXml, 'utf8') }]);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

let tmpDir: string;
let db: Db;
let dataDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-'));
  db = openDb(':memory:');
  migrate(db);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-data-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
  db.close();
});

function writeDocx(filename: string, buf: Buffer): string {
  const p = path.join(tmpDir, filename);
  fs.writeFileSync(p, buf);
  return p;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DocxAdapter', () => {
  it('uses first heading as title', () => {
    const docxPath = writeDocx(
      'report.docx',
      makeDocx(`
        <w:p>
          <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
          <w:r><w:t>My Report</w:t></w:r>
        </w:p>
        <w:p>
          <w:r><w:t>Some body text here.</w:t></w:r>
        </w:p>
      `),
    );
    const adapter = new DocxAdapter({ path: docxPath });
    const docs = adapter.stage();
    expect(docs).toHaveLength(1);
    expect(docs[0]!.title).toBe('My Report');
    expect(docs[0]!.body).toContain('Some body text here.');
  });

  it('falls back to filename when no heading present', () => {
    const docxPath = writeDocx(
      'my-notes.docx',
      makeDocx(`
        <w:p>
          <w:r><w:t>Just a plain paragraph.</w:t></w:r>
        </w:p>
      `),
    );
    const adapter = new DocxAdapter({ path: docxPath });
    const docs = adapter.stage();
    expect(docs[0]!.title).toBe('my-notes');
  });

  it('emits heading markers for h1/h2/h3', () => {
    const docxPath = writeDocx(
      'headings.docx',
      makeDocx(`
        <w:p>
          <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
          <w:r><w:t>H1 Title</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
          <w:r><w:t>H2 Section</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:pStyle w:val="Heading3"/></w:pPr>
          <w:r><w:t>H3 Sub</w:t></w:r>
        </w:p>
      `),
    );
    const adapter = new DocxAdapter({ path: docxPath });
    const docs = adapter.stage();
    expect(docs[0]!.body).toContain('# H1 Title');
    expect(docs[0]!.body).toContain('## H2 Section');
    expect(docs[0]!.body).toContain('### H3 Sub');
  });

  it('converts Title style to h1', () => {
    const docxPath = writeDocx(
      'titled.docx',
      makeDocx(`
        <w:p>
          <w:pPr><w:pStyle w:val="Title"/></w:pPr>
          <w:r><w:t>The Document Title</w:t></w:r>
        </w:p>
      `),
    );
    const adapter = new DocxAdapter({ path: docxPath });
    const docs = adapter.stage();
    expect(docs[0]!.title).toBe('The Document Title');
    expect(docs[0]!.body).toContain('# The Document Title');
  });

  it('emits list items for numPr paragraphs', () => {
    const docxPath = writeDocx(
      'list.docx',
      makeDocx(`
        <w:p>
          <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>
          <w:r><w:t>Item one</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>
          <w:r><w:t>Item two</w:t></w:r>
        </w:p>
      `),
    );
    const adapter = new DocxAdapter({ path: docxPath });
    const docs = adapter.stage();
    expect(docs[0]!.body).toContain('- Item one');
    expect(docs[0]!.body).toContain('- Item two');
  });

  it('applies bold and italic formatting', () => {
    const docxPath = writeDocx(
      'styled.docx',
      makeDocx(`
        <w:p>
          <w:r><w:rPr><w:b/></w:rPr><w:t>Bold text</w:t></w:r>
          <w:r><w:t> and </w:t></w:r>
          <w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r>
        </w:p>
      `),
    );
    const adapter = new DocxAdapter({ path: docxPath });
    const docs = adapter.stage();
    expect(docs[0]!.body).toContain('**Bold text**');
    expect(docs[0]!.body).toContain('*italic*');
  });

  it('decodes XML entities', () => {
    const docxPath = writeDocx(
      'entities.docx',
      makeDocx(`
        <w:p>
          <w:r><w:t>5 &amp; 3 &lt; 10 &gt; 1 &quot;quoted&quot; &#39;apos&#39;</w:t></w:r>
        </w:p>
      `),
    );
    const adapter = new DocxAdapter({ path: docxPath });
    const docs = adapter.stage();
    expect(docs[0]!.body).toContain('5 & 3 < 10 > 1 "quoted" \'apos\'');
  });

  it('adds lossy metadata when word/media/ entries are present', () => {
    const docxBuf = writeZip([
      {
        name: 'word/document.xml',
        data: Buffer.from(makeDocxXml('<w:p><w:r><w:t>With image</w:t></w:r></w:p>'), 'utf8'),
      },
      { name: 'word/media/image1.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    ]);
    const docxPath = writeDocx('with-image.docx', docxBuf);
    const adapter = new DocxAdapter({ path: docxPath });
    const docs = adapter.stage();
    expect(docs[0]!.metadata).toBeDefined();
    expect((docs[0]!.metadata!['lossy'] as string[]).some((s) => /image/i.test(s))).toBe(true);
  });

  it('sets sourceId from the filename', () => {
    const docxPath = writeDocx(
      'My Document.docx',
      makeDocx('<w:p><w:r><w:t>Content</w:t></w:r></w:p>'),
    );
    const adapter = new DocxAdapter({ path: docxPath });
    const docs = adapter.stage();
    expect(docs[0]!.sourceId).toBe('my-document');
  });

  it('throws validation error for missing file', () => {
    const adapter = new DocxAdapter({ path: path.join(tmpDir, 'nonexistent.docx') });
    expect(() => adapter.stage()).toThrow();
  });

  it('throws validation error for relative path', () => {
    const adapter = new DocxAdapter({ path: 'relative/path.docx' });
    expect(() => adapter.stage()).toThrow();
  });

  it('produces correct notebookPath and tags (empty)', () => {
    const docxPath = writeDocx('simple.docx', makeDocx('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>'));
    const adapter = new DocxAdapter({ path: docxPath });
    const docs = adapter.stage();
    expect(docs[0]!.notebookPath).toEqual([]);
    expect(docs[0]!.tags).toEqual([]);
    expect(docs[0]!.assets).toEqual([]);
    expect(docs[0]!.links).toEqual([]);
  });

  // ── Framework round-trip ──────────────────────────────────────────────────

  it('framework round-trip: imports a docx document into the db', async () => {
    const docxPath = writeDocx(
      'roundtrip.docx',
      makeDocx(`
        <w:p>
          <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
          <w:r><w:t>Round Trip Doc</w:t></w:r>
        </w:p>
        <w:p>
          <w:r><w:t>Framework body text.</w:t></w:r>
        </w:p>
      `),
    );
    const adapter = new DocxAdapter({ path: docxPath });
    const result = await runImport(db, dataDir, adapter, normalizeRules({}));
    expect(result.imported).toBe(1);

    const titles = notesRepo(db).listTitles();
    expect(titles.some((n) => n.title === 'Round Trip Doc')).toBe(true);
  });
});
