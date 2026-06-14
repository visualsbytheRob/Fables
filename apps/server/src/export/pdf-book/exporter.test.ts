/**
 * Tests for PdfBookExporter (F1477).
 */

import { describe, expect, it } from 'vitest';
import { PdfBookExporter } from './exporter.js';
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

describe('PdfBookExporter', () => {
  const exporter = new PdfBookExporter();

  it('has name "pdf-book"', () => {
    expect(exporter.name).toBe('pdf-book');
  });

  it('produces exactly one file: book.html', () => {
    const files = exporter.export([makeNote()]);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe('book.html');
  });

  it('book.html is valid HTML5 document', () => {
    const files = exporter.export([makeNote()]);
    const html = files[0]!.data.toString('utf8');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('book.html contains @page CSS rule with margin', () => {
    const files = exporter.export([makeNote()]);
    const html = files[0]!.data.toString('utf8');
    expect(html).toContain('@page');
    expect(html).toContain('margin: 2cm');
  });

  it('book.html has embedded <style> block', () => {
    const files = exporter.export([makeNote()]);
    const html = files[0]!.data.toString('utf8');
    expect(html).toContain('<style>');
  });

  it('book.html has a title page', () => {
    const files = exporter.export([makeNote()]);
    const html = files[0]!.data.toString('utf8');
    expect(html).toContain('title-page');
    expect(html).toContain('Fables Notes');
  });

  it('book.html has a table of contents section', () => {
    const files = exporter.export([makeNote()]);
    const html = files[0]!.data.toString('utf8');
    expect(html).toContain('Table of Contents');
  });

  it('TOC links to chapters by anchor', () => {
    const files = exporter.export([makeNote({ notebookPath: ['Work'] })]);
    const html = files[0]!.data.toString('utf8');
    expect(html).toContain('href="#chapter-');
  });

  it('TOC links to individual notes by anchor', () => {
    const files = exporter.export([makeNote({ id: 'note-1' })]);
    const html = files[0]!.data.toString('utf8');
    expect(html).toContain('href="#note-note-1"');
  });

  it('chapters have page-break-before: always', () => {
    const files = exporter.export([makeNote()]);
    const html = files[0]!.data.toString('utf8');
    expect(html).toContain('page-break-before: always');
  });

  it('chapter uses notebook path as <h1> heading', () => {
    const files = exporter.export([makeNote({ notebookPath: ['Science', 'Biology'] })]);
    const html = files[0]!.data.toString('utf8');
    expect(html).toContain('<h1>Science / Biology</h1>');
  });

  it('note sections use note title as <h2>', () => {
    const files = exporter.export([makeNote({ title: 'My Special Note' })]);
    const html = files[0]!.data.toString('utf8');
    expect(html).toContain('<h2>My Special Note</h2>');
  });

  it('note section has id="note-<id>" anchor', () => {
    const files = exporter.export([makeNote({ id: 'note-abc' })]);
    const html = files[0]!.data.toString('utf8');
    expect(html).toContain('id="note-note-abc"');
  });

  it('notes are grouped into chapters by notebookPath', () => {
    const notes = [
      makeNote({ id: 'n1', title: 'Alpha', notebookPath: ['Work'] }),
      makeNote({ id: 'n2', title: 'Beta', notebookPath: ['Personal'] }),
    ];
    const files = exporter.export(notes);
    const html = files[0]!.data.toString('utf8');
    // Two distinct chapter sections
    const chapterMatches = html.match(/class="chapter"/g);
    expect(chapterMatches).toHaveLength(2);
  });

  it('converts **bold** to <strong>', () => {
    const files = exporter.export([makeNote({ body: 'This is **bold** text' })]);
    const html = files[0]!.data.toString('utf8');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('converts *italic* to <em>', () => {
    const files = exporter.export([makeNote({ body: 'This is *italic* text' })]);
    const html = files[0]!.data.toString('utf8');
    expect(html).toContain('<em>italic</em>');
  });

  it('converts # heading to <h1> within note body', () => {
    const files = exporter.export([makeNote({ body: '# Section Heading' })]);
    const html = files[0]!.data.toString('utf8');
    expect(html).toContain('<h1>Section Heading</h1>');
  });

  it('converts `code` to <code>', () => {
    const files = exporter.export([makeNote({ body: 'Use `console.log()` here' })]);
    const html = files[0]!.data.toString('utf8');
    expect(html).toContain('<code>console.log()</code>');
  });

  it('converts fenced code blocks to <pre><code>', () => {
    const body = '```\nconst x = 1;\n```';
    const files = exporter.export([makeNote({ body })]);
    const html = files[0]!.data.toString('utf8');
    expect(html).toContain('<pre><code>');
    expect(html).toContain('const x = 1;');
  });

  it('renders tags as pills', () => {
    const files = exporter.export([makeNote({ tags: ['alpha', 'beta'] })]);
    const html = files[0]!.data.toString('utf8');
    expect(html).toContain('class="tag"');
    expect(html).toContain('alpha');
    expect(html).toContain('beta');
  });

  it('shows createdAt and updatedAt in note meta', () => {
    const files = exporter.export([makeNote()]);
    const html = files[0]!.data.toString('utf8');
    expect(html).toContain('2024-01-01T00:00:00Z');
    expect(html).toContain('2024-06-01T00:00:00Z');
  });

  it('has break-after: avoid on headings to prevent orphaning', () => {
    const files = exporter.export([makeNote()]);
    const html = files[0]!.data.toString('utf8');
    expect(html).toContain('break-after: avoid');
  });

  it('wikilinks become in-page anchors if title matches another note', () => {
    const notes = [
      makeNote({ id: 'note-1', title: 'Alpha', body: 'See [[Beta]]', notebookPath: ['X'] }),
      makeNote({ id: 'note-2', title: 'Beta', body: 'Another note', notebookPath: ['X'] }),
    ];
    const files = exporter.export(notes);
    const html = files[0]!.data.toString('utf8');
    expect(html).toContain('href="#note-note-2"');
  });

  it('handles notes with no notebookPath (falls back to label)', () => {
    const files = exporter.export([makeNote({ notebookPath: [] })]);
    const html = files[0]!.data.toString('utf8');
    expect(html).toContain('(No notebook)');
  });

  it('handles empty notes array', () => {
    const files = exporter.export([]);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe('book.html');
  });
});
