/**
 * Tests for NotionExporter (F1473).
 */

import { describe, expect, it } from 'vitest';
import { NotionExporter } from './exporter.js';
import type { ExportNote } from '../index.js';

function makeNote(overrides: Partial<ExportNote> = {}): ExportNote {
  return {
    id: 'note-1',
    title: 'My Note',
    body: 'Hello world',
    notebookPath: ['Work', 'Projects'],
    tags: ['alpha', 'beta'],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-06-01T00:00:00Z',
    attachments: [],
    ...overrides,
  };
}

describe('NotionExporter', () => {
  const exporter = new NotionExporter();

  it('has name "notion-md"', () => {
    expect(exporter.name).toBe('notion-md');
  });

  it('produces one .md file per note under its notebook path', () => {
    const files = exporter.export([makeNote()]);
    const md = files.find((f) => f.path.endsWith('.md'));
    expect(md).toBeDefined();
    expect(md!.path).toBe('Work/Projects/My Note.md');
  });

  it('md file starts with # <title> heading', () => {
    const files = exporter.export([makeNote()]);
    const md = files.find((f) => f.path.endsWith('.md'))!;
    const content = md.data.toString('utf8');
    expect(content.startsWith('# My Note\n')).toBe(true);
  });

  it('md file includes the note body after the heading', () => {
    const files = exporter.export([makeNote()]);
    const md = files.find((f) => f.path.endsWith('.md'))!;
    const content = md.data.toString('utf8');
    expect(content).toContain('Hello world');
  });

  it('produces an index.csv file', () => {
    const files = exporter.export([makeNote()]);
    const csv = files.find((f) => f.path === 'index.csv');
    expect(csv).toBeDefined();
  });

  it('index.csv has correct header', () => {
    const files = exporter.export([makeNote()]);
    const csv = files.find((f) => f.path === 'index.csv')!;
    const content = csv.data.toString('utf8');
    expect(content.startsWith('Name,Notebook,Tags,Created\n')).toBe(true);
  });

  it('index.csv has one row per note with correct columns', () => {
    const files = exporter.export([makeNote()]);
    const csv = files.find((f) => f.path === 'index.csv')!;
    const lines = csv.data.toString('utf8').trim().split('\n');
    expect(lines).toHaveLength(2); // header + 1 note
    expect(lines[1]).toContain('My Note');
    expect(lines[1]).toContain('Work / Projects');
    expect(lines[1]).toContain('alpha, beta');
    expect(lines[1]).toContain('2024-01-01T00:00:00Z');
  });

  it('CSV-escapes values containing commas', () => {
    const note = makeNote({ title: 'Note, with comma', tags: [] });
    const files = exporter.export([note]);
    const csv = files.find((f) => f.path === 'index.csv')!;
    const content = csv.data.toString('utf8');
    expect(content).toContain('"Note, with comma"');
  });

  it('CSV-escapes values containing double quotes', () => {
    const note = makeNote({ title: 'Note "quoted"', tags: [] });
    const files = exporter.export([note]);
    const csv = files.find((f) => f.path === 'index.csv')!;
    const content = csv.data.toString('utf8');
    expect(content).toContain('"Note ""quoted"""');
  });

  it('handles multiple notes', () => {
    const note1 = makeNote({ id: 'n1', title: 'Alpha', notebookPath: ['A'] });
    const note2 = makeNote({ id: 'n2', title: 'Beta', notebookPath: ['B'] });
    const files = exporter.export([note1, note2]);
    const mds = files.filter((f) => f.path.endsWith('.md'));
    expect(mds).toHaveLength(2);
    const csv = files.find((f) => f.path === 'index.csv')!;
    const lines = csv.data.toString('utf8').trim().split('\n');
    expect(lines).toHaveLength(3); // header + 2
  });

  it('handles notes with empty notebook path', () => {
    const files = exporter.export([makeNote({ notebookPath: [] })]);
    const md = files.find((f) => f.path.endsWith('.md'))!;
    expect(md.path).toBe('My Note.md');
  });
});
