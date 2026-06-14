/**
 * CSV entities adapter tests (F1468 — csv portion).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CsvEntitiesAdapter } from './adapter.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-entities-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeCsv(filename: string, content: string): string {
  const p = path.join(tmpDir, filename);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

describe('CsvEntitiesAdapter', () => {
  it('produces one StagedDoc per CSV row', () => {
    const csvPath = writeCsv('people.csv', 'name,age,city\nAlice,30,NYC\nBob,25,LA\n');
    const adapter = new CsvEntitiesAdapter({ path: csvPath });
    const docs = adapter.stage();
    expect(docs).toHaveLength(2);
  });

  it('uses name column for title', () => {
    const csvPath = writeCsv('people.csv', 'name,age\nAlice,30\nBob,25\n');
    const adapter = new CsvEntitiesAdapter({ path: csvPath });
    const docs = adapter.stage();
    expect(docs[0]!.title).toBe('Alice');
    expect(docs[1]!.title).toBe('Bob');
  });

  it('uses title column (case-insensitive) for title', () => {
    const csvPath = writeCsv('items.csv', 'Title,color\nRed Widget,red\n');
    const adapter = new CsvEntitiesAdapter({ path: csvPath });
    const docs = adapter.stage();
    expect(docs[0]!.title).toBe('Red Widget');
  });

  it('falls back to first column value when no name/title column', () => {
    const csvPath = writeCsv('misc.csv', 'label,count\nAlpha,1\nBeta,2\n');
    const adapter = new CsvEntitiesAdapter({ path: csvPath });
    const docs = adapter.stage();
    expect(docs[0]!.title).toBe('Alpha');
    expect(docs[1]!.title).toBe('Beta');
  });

  it('falls back to Row N when first column is empty', () => {
    const csvPath = writeCsv('empty.csv', 'name,age\n,30\n,25\n');
    const adapter = new CsvEntitiesAdapter({ path: csvPath });
    const docs = adapter.stage();
    expect(docs[0]!.title).toBe('Row 1');
    expect(docs[1]!.title).toBe('Row 2');
  });

  it('builds a properties table from non-title columns', () => {
    const csvPath = writeCsv('things.csv', 'name,color,size\nWidget,blue,large\n');
    const adapter = new CsvEntitiesAdapter({ path: csvPath });
    const docs = adapter.stage();
    expect(docs[0]!.body).toContain('## Properties');
    expect(docs[0]!.body).toContain('| Field | Value |');
    expect(docs[0]!.body).toContain('| color | blue |');
    expect(docs[0]!.body).toContain('| size | large |');
  });

  it('harvests tags column into tags array', () => {
    const csvPath = writeCsv('tagged.csv', 'name,tags,desc\nFoo,"alpha,beta",A thing\n');
    const adapter = new CsvEntitiesAdapter({ path: csvPath });
    const docs = adapter.stage();
    expect(docs[0]!.tags).toContain('alpha');
    expect(docs[0]!.tags).toContain('beta');
  });

  it('harvests Tags (capital) column into tags array', () => {
    const csvPath = writeCsv('tagged2.csv', 'Name,Tags\nBar,"sci-fi, fantasy"\n');
    const adapter = new CsvEntitiesAdapter({ path: csvPath });
    const docs = adapter.stage();
    expect(docs[0]!.tags).toContain('sci-fi');
    expect(docs[0]!.tags).toContain('fantasy');
  });

  it('sets notebookPath to [Entities, basename]', () => {
    const csvPath = writeCsv('contacts.csv', 'name\nAlice\n');
    const adapter = new CsvEntitiesAdapter({ path: csvPath });
    const docs = adapter.stage();
    expect(docs[0]!.notebookPath).toEqual(['Entities', 'contacts']);
  });

  it('sets sourceId to basename-rowindex lowercased', () => {
    const csvPath = writeCsv('MyItems.csv', 'name\nAlpha\nBeta\n');
    const adapter = new CsvEntitiesAdapter({ path: csvPath });
    const docs = adapter.stage();
    expect(docs[0]!.sourceId).toBe('myitems-0');
    expect(docs[1]!.sourceId).toBe('myitems-1');
  });

  it('skips empty column values in properties table', () => {
    const csvPath = writeCsv('sparse.csv', 'name,col1,col2\nItem,value,\n');
    const adapter = new CsvEntitiesAdapter({ path: csvPath });
    const docs = adapter.stage();
    expect(docs[0]!.body).toContain('| col1 | value |');
    expect(docs[0]!.body).not.toContain('col2');
  });

  it('returns empty array for empty CSV', () => {
    const csvPath = writeCsv('empty.csv', 'name,age\n');
    const adapter = new CsvEntitiesAdapter({ path: csvPath });
    const docs = adapter.stage();
    expect(docs).toHaveLength(0);
  });

  it('escapes pipe characters in table cells', () => {
    const csvPath = writeCsv('pipes.csv', 'name,formula\nTest,a|b\n');
    const adapter = new CsvEntitiesAdapter({ path: csvPath });
    const docs = adapter.stage();
    expect(docs[0]!.body).toContain('a\\|b');
  });

  it('initializes assets and links as empty arrays', () => {
    const csvPath = writeCsv('basic.csv', 'name\nFoo\n');
    const adapter = new CsvEntitiesAdapter({ path: csvPath });
    const docs = adapter.stage();
    expect(docs[0]!.assets).toEqual([]);
    expect(docs[0]!.links).toEqual([]);
  });

  it('throws validation error for relative path', () => {
    const adapter = new CsvEntitiesAdapter({ path: 'relative/data.csv' });
    expect(() => adapter.stage()).toThrow();
  });

  it('throws validation error for non-.csv file', () => {
    const txtPath = path.join(tmpDir, 'data.txt');
    fs.writeFileSync(txtPath, 'name\nFoo\n');
    const adapter = new CsvEntitiesAdapter({ path: txtPath });
    expect(() => adapter.stage()).toThrow();
  });

  it('throws validation error for missing file', () => {
    const adapter = new CsvEntitiesAdapter({ path: path.join(tmpDir, 'missing.csv') });
    expect(() => adapter.stage()).toThrow();
  });
});
