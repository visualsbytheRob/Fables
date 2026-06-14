/**
 * Tests for LogseqExporter (F1474).
 */

import { describe, expect, it } from 'vitest';
import { LogseqExporter } from './exporter.js';
import type { ExportNote } from '../index.js';

function makeNote(overrides: Partial<ExportNote> = {}): ExportNote {
  return {
    id: 'note-1',
    title: 'My Note',
    body: 'Hello world',
    notebookPath: ['Work'],
    tags: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-06-01T00:00:00Z',
    attachments: [],
    ...overrides,
  };
}

describe('LogseqExporter', () => {
  const exporter = new LogseqExporter();

  it('has name "logseq"', () => {
    expect(exporter.name).toBe('logseq');
  });

  it('routes date-titled notes (YYYY-MM-DD) to journals/', () => {
    const files = exporter.export([makeNote({ title: '2024-03-15' })]);
    expect(files[0]!.path).toBe('journals/2024_03_15.md');
  });

  it('routes date-titled notes (YYYY_MM_DD) to journals/', () => {
    const files = exporter.export([makeNote({ title: '2024_03_15' })]);
    expect(files[0]!.path).toBe('journals/2024_03_15.md');
  });

  it('routes non-date notes to pages/', () => {
    const files = exporter.export([makeNote({ title: 'My Note' })]);
    expect(files[0]!.path).toBe('pages/My Note.md');
  });

  it('converts top-level lines to `- ` bullets', () => {
    const files = exporter.export([makeNote({ body: 'First line\nSecond line' })]);
    const content = files[0]!.data.toString('utf8');
    expect(content).toContain('- First line');
    expect(content).toContain('- Second line');
  });

  it('leaves lines already starting with `- ` untouched', () => {
    const files = exporter.export([makeNote({ body: '- Already a bullet\nNormal line' })]);
    const content = files[0]!.data.toString('utf8');
    // Should not become `- - Already a bullet`
    expect(content).toContain('- Already a bullet');
    expect(content).not.toContain('- - Already');
  });

  it('converts heading lines to `- # Heading` bullets', () => {
    const files = exporter.export([makeNote({ body: '# Section Heading\nSome text' })]);
    const content = files[0]!.data.toString('utf8');
    expect(content).toContain('- # Section Heading');
  });

  it('appends tags:: line when note has tags', () => {
    const files = exporter.export([makeNote({ tags: ['alpha', 'beta'] })]);
    const content = files[0]!.data.toString('utf8');
    expect(content).toContain('tags:: alpha, beta');
  });

  it('does not append tags:: line when note has no tags', () => {
    const files = exporter.export([makeNote({ tags: [] })]);
    const content = files[0]!.data.toString('utf8');
    expect(content).not.toContain('tags::');
  });

  it('leaves [[wikilinks]] as-is', () => {
    const files = exporter.export([makeNote({ body: 'See [[Other Page]] here' })]);
    const content = files[0]!.data.toString('utf8');
    expect(content).toContain('[[Other Page]]');
  });

  it('preserves blank lines between content', () => {
    const files = exporter.export([makeNote({ body: 'Line one\n\nLine two' })]);
    const content = files[0]!.data.toString('utf8');
    // Both lines should appear as bullets with a blank line between.
    expect(content).toContain('- Line one');
    expect(content).toContain('- Line two');
    expect(content).toMatch(/- Line one\n\n- Line two/);
  });

  it('handles multiple notes producing separate files', () => {
    const notes = [
      makeNote({ title: '2024-01-01', body: 'Journal entry' }),
      makeNote({ title: 'Meeting Notes', body: 'Agenda' }),
    ];
    const files = exporter.export(notes);
    expect(files).toHaveLength(2);
    expect(files[0]!.path).toBe('journals/2024_01_01.md');
    expect(files[1]!.path).toBe('pages/Meeting Notes.md');
  });
});
