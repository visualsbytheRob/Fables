/**
 * Tests for StaticSiteExporter (F1476).
 */

import { describe, expect, it } from 'vitest';
import { StaticSiteExporter } from './exporter.js';
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

describe('StaticSiteExporter', () => {
  const exporter = new StaticSiteExporter();

  it('has name "static-site"', () => {
    expect(exporter.name).toBe('static-site');
  });

  it('emits index.html', () => {
    const files = exporter.export([makeNote()]);
    const index = files.find((f) => f.path === 'index.html');
    expect(index).toBeDefined();
  });

  it('emits style.css', () => {
    const files = exporter.export([makeNote()]);
    const css = files.find((f) => f.path === 'style.css');
    expect(css).toBeDefined();
  });

  it('emits one <id>.html per note', () => {
    const notes = [
      makeNote({ id: 'id-aaa', title: 'Alpha' }),
      makeNote({ id: 'id-bbb', title: 'Beta' }),
    ];
    const files = exporter.export(notes);
    expect(files.find((f) => f.path === 'id-aaa.html')).toBeDefined();
    expect(files.find((f) => f.path === 'id-bbb.html')).toBeDefined();
  });

  it('note page has note title in <h1>', () => {
    const files = exporter.export([makeNote({ id: 'id-aaa', title: 'My Special Note' })]);
    const page = files.find((f) => f.path === 'id-aaa.html')!;
    expect(page.data.toString('utf8')).toContain('<h1>My Special Note</h1>');
  });

  it('note page has tags rendered as pills', () => {
    const files = exporter.export([makeNote({ id: 'note-1', tags: ['alpha', 'beta'] })]);
    const page = files.find((f) => f.path === 'note-1.html')!;
    const html = page.data.toString('utf8');
    expect(html).toContain('class="tag"');
    expect(html).toContain('alpha');
    expect(html).toContain('beta');
  });

  it('note page has back-link to index.html', () => {
    const files = exporter.export([makeNote({ id: 'note-1' })]);
    const page = files.find((f) => f.path === 'note-1.html')!;
    expect(page.data.toString('utf8')).toContain('href="index.html"');
  });

  it('note page shows createdAt and updatedAt in footer', () => {
    const files = exporter.export([makeNote({ id: 'note-1' })]);
    const page = files.find((f) => f.path === 'note-1.html')!;
    const html = page.data.toString('utf8');
    expect(html).toContain('2024-01-01T00:00:00Z');
    expect(html).toContain('2024-06-01T00:00:00Z');
  });

  it('index.html links to each note by id', () => {
    const files = exporter.export([makeNote({ id: 'note-1', title: 'My Note' })]);
    const index = files.find((f) => f.path === 'index.html')!;
    const html = index.data.toString('utf8');
    expect(html).toContain('href="note-1.html"');
    expect(html).toContain('My Note');
  });

  it('index.html groups notes by notebookPath', () => {
    const notes = [
      makeNote({ id: 'n1', title: 'Alpha', notebookPath: ['Work'] }),
      makeNote({ id: 'n2', title: 'Beta', notebookPath: ['Personal'] }),
    ];
    const files = exporter.export(notes);
    const index = files.find((f) => f.path === 'index.html')!;
    const html = index.data.toString('utf8');
    expect(html).toContain('Work');
    expect(html).toContain('Personal');
  });

  it('converts **bold** to <strong>', () => {
    const files = exporter.export([makeNote({ id: 'note-1', body: 'This is **bold** text' })]);
    const page = files.find((f) => f.path === 'note-1.html')!;
    expect(page.data.toString('utf8')).toContain('<strong>bold</strong>');
  });

  it('converts *italic* to <em>', () => {
    const files = exporter.export([makeNote({ id: 'note-1', body: 'This is *italic* text' })]);
    const page = files.find((f) => f.path === 'note-1.html')!;
    expect(page.data.toString('utf8')).toContain('<em>italic</em>');
  });

  it('converts # heading to <h1>', () => {
    const files = exporter.export([makeNote({ id: 'note-1', body: '# Big Heading' })]);
    const page = files.find((f) => f.path === 'note-1.html')!;
    expect(page.data.toString('utf8')).toContain('<h1>Big Heading</h1>');
  });

  it('converts ## heading to <h2>', () => {
    const files = exporter.export([makeNote({ id: 'note-1', body: '## Sub Heading' })]);
    const page = files.find((f) => f.path === 'note-1.html')!;
    expect(page.data.toString('utf8')).toContain('<h2>Sub Heading</h2>');
  });

  it('converts `code` to <code>', () => {
    const files = exporter.export([makeNote({ id: 'note-1', body: 'Use `console.log()` here' })]);
    const page = files.find((f) => f.path === 'note-1.html')!;
    expect(page.data.toString('utf8')).toContain('<code>console.log()</code>');
  });

  it('converts fenced code blocks to <pre><code>', () => {
    const body = '```\nconst x = 1;\n```';
    const files = exporter.export([makeNote({ id: 'note-1', body })]);
    const page = files.find((f) => f.path === 'note-1.html')!;
    const html = page.data.toString('utf8');
    expect(html).toContain('<pre><code>');
    expect(html).toContain('const x = 1;');
  });

  it('converts - list items to <ul><li>', () => {
    const body = '- first\n- second';
    const files = exporter.export([makeNote({ id: 'note-1', body })]);
    const page = files.find((f) => f.path === 'note-1.html')!;
    const html = page.data.toString('utf8');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>');
    expect(html).toContain('first');
    expect(html).toContain('second');
  });

  it('converts > blockquote to <blockquote>', () => {
    const body = '> A quoted line';
    const files = exporter.export([makeNote({ id: 'note-1', body })]);
    const page = files.find((f) => f.path === 'note-1.html')!;
    expect(page.data.toString('utf8')).toContain('<blockquote>');
    expect(page.data.toString('utf8')).toContain('A quoted line');
  });

  it('converts [text](url) to <a href>', () => {
    const body = 'See [example](https://example.com) here';
    const files = exporter.export([makeNote({ id: 'note-1', body })]);
    const page = files.find((f) => f.path === 'note-1.html')!;
    const html = page.data.toString('utf8');
    expect(html).toContain('<a href="https://example.com">example</a>');
  });

  it('converts [[wikilink]] to anchor when title matches another note', () => {
    const notes = [
      makeNote({ id: 'note-1', title: 'Alpha', body: 'See [[Beta]]' }),
      makeNote({ id: 'note-2', title: 'Beta', body: 'Another note' }),
    ];
    const files = exporter.export(notes);
    const page = files.find((f) => f.path === 'note-1.html')!;
    expect(page.data.toString('utf8')).toContain('<a href="note-2.html">Beta</a>');
  });

  it('converts [[wikilink]] to plain text when title has no match', () => {
    const files = exporter.export([makeNote({ id: 'note-1', body: 'See [[Nonexistent]]' })]);
    const page = files.find((f) => f.path === 'note-1.html')!;
    const html = page.data.toString('utf8');
    expect(html).toContain('Nonexistent');
    expect(html).not.toContain('[[Nonexistent]]');
  });

  it('style.css references system font and max-width', () => {
    const files = exporter.export([makeNote()]);
    const css = files.find((f) => f.path === 'style.css')!;
    const content = css.data.toString('utf8');
    expect(content).toContain('font-family');
    expect(content).toContain('max-width');
  });

  it('handles notes with empty notebookPath', () => {
    const files = exporter.export([makeNote({ id: 'note-1', notebookPath: [] })]);
    const index = files.find((f) => f.path === 'index.html')!;
    expect(index).toBeDefined();
  });

  it('handles empty notes array', () => {
    const files = exporter.export([]);
    expect(files.find((f) => f.path === 'index.html')).toBeDefined();
    expect(files.find((f) => f.path === 'style.css')).toBeDefined();
  });
});
