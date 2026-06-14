/**
 * Format-detection tests (F1469) — extension + content sniffing for files and
 * directory layouts, with ranked guesses.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectImportSource } from './detect.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const write = (name: string, content = 'x'): string => {
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
};

describe('file detection by extension', () => {
  it('maps unambiguous extensions to a single high-confidence source', () => {
    expect(detectImportSource(write('a.docx'))[0]).toMatchObject({
      source: 'docx',
      confidence: 'high',
    });
    expect(detectImportSource(write('a.opml'))[0]!.source).toBe('opml');
    expect(detectImportSource(write('a.ics'))[0]!.source).toBe('ics');
    expect(detectImportSource(write('a.mbox'))[0]!.source).toBe('email');
    expect(detectImportSource(write('a.csv'))[0]!.source).toBe('csv');
    expect(detectImportSource(write('a.txt'))[0]!.source).toBe('plaintext');
    expect(detectImportSource(write('a.jex'))[0]!.source).toBe('joplin');
  });

  it('offers both ENEX sources for .enex', () => {
    const guesses = detectImportSource(write('Notes.enex'));
    expect(guesses.map((g) => g.source)).toEqual(['evernote', 'apple-notes']);
  });

  it('returns nothing for an unknown extension', () => {
    expect(detectImportSource(write('a.xyz'))).toEqual([]);
  });
});

describe('JSON content sniffing', () => {
  it('distinguishes Roam, Simplenote, Day One, Standard Notes', () => {
    expect(detectImportSource(write('roam.json', '[{"title":"A"}]'))[0]!.source).toBe('roam');
    expect(detectImportSource(write('sn.json', '{"activeNotes":[]}'))[0]!.source).toBe(
      'simplenote',
    );
    expect(detectImportSource(write('d1.json', '{"metadata":{},"entries":[]}'))[0]!.source).toBe(
      'day-one',
    );
    expect(detectImportSource(write('std.json', '{"items":[]}'))[0]!.source).toBe('standard-notes');
  });
});

describe('directory detection', () => {
  it('detects a Logseq graph', () => {
    fs.mkdirSync(path.join(dir, 'pages'));
    fs.mkdirSync(path.join(dir, 'journals'));
    expect(detectImportSource(dir)[0]).toMatchObject({ source: 'logseq', confidence: 'high' });
  });

  it('detects a Day One folder (json + photos)', () => {
    write('Journal.json', '{"entries":[]}');
    fs.mkdirSync(path.join(dir, 'photos'));
    expect(detectImportSource(dir).some((g) => g.source === 'day-one')).toBe(true);
  });

  it('offers markdown + bear for a folder of .md, deduped', () => {
    write('a.md');
    write('b.md');
    const sources = detectImportSource(dir).map((g) => g.source);
    expect(sources).toContain('markdown');
    expect(sources).toContain('bear');
    expect(new Set(sources).size).toBe(sources.length); // no duplicates
  });

  it('returns nothing for an unrecognised, missing, or empty target', () => {
    expect(detectImportSource(path.join(dir, 'nope'))).toEqual([]);
    expect(detectImportSource(dir)).toEqual([]);
  });
});
