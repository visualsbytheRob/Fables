/**
 * Tests for ObsidianExporter (F1472).
 */

import { describe, expect, it } from 'vitest';
import { ObsidianExporter } from './exporter.js';
import type { ExportNote, ExportAttachment } from '../index.js';

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

function makeAttachment(overrides: Partial<ExportAttachment> = {}): ExportAttachment {
  return {
    id: 'att-abc123def456',
    filename: 'photo.png',
    mime: 'image/png',
    hash: 'deadbeef',
    read: () => Buffer.from([1, 2, 3]),
    ...overrides,
  };
}

describe('ObsidianExporter', () => {
  const exporter = new ObsidianExporter();

  it('has name "obsidian"', () => {
    expect(exporter.name).toBe('obsidian');
  });

  it('produces one .md file per note under its notebook path', () => {
    const files = exporter.export([makeNote()]);
    const md = files.find((f) => f.path.endsWith('.md'));
    expect(md).toBeDefined();
    expect(md!.path).toBe('Work/Projects/My Note.md');
  });

  it('includes YAML frontmatter with tags, created, updated', () => {
    const files = exporter.export([makeNote()]);
    const md = files.find((f) => f.path.endsWith('.md'))!;
    const content = md.data.toString('utf8');
    expect(content).toMatch(/^---\n/);
    expect(content).toContain('tags:');
    expect(content).toContain('- alpha');
    expect(content).toContain('- beta');
    expect(content).toContain('created: 2024-01-01T00:00:00Z');
    expect(content).toContain('updated: 2024-06-01T00:00:00Z');
    expect(content).toContain('---');
  });

  it('includes the note body after frontmatter', () => {
    const files = exporter.export([makeNote()]);
    const md = files.find((f) => f.path.endsWith('.md'))!;
    const content = md.data.toString('utf8');
    expect(content).toContain('Hello world');
  });

  it('emits attachment file under attachments/', () => {
    const att = makeAttachment();
    const files = exporter.export([makeNote({ attachments: [att] })]);
    const attFile = files.find((f) => f.path.startsWith('attachments/'));
    expect(attFile).toBeDefined();
    expect(attFile!.path).toBe('attachments/photo.png');
    expect(attFile!.data).toEqual(Buffer.from([1, 2, 3]));
  });

  it('rewrites /api/v1/attachments/<id> to vault-relative attachments/<filename>', () => {
    const att = makeAttachment({ id: 'att-abc123def456', filename: 'photo.png' });
    const body = `See ![img](/api/v1/attachments/att-abc123def456) here`;
    const files = exporter.export([makeNote({ body, attachments: [att] })]);
    const md = files.find((f) => f.path.endsWith('.md'))!;
    const content = md.data.toString('utf8');
    expect(content).toContain('attachments/photo.png');
    expect(content).not.toContain('/api/v1/attachments/');
  });

  it('deduplicates attachment filenames across notes by prefixing id', () => {
    const att1 = makeAttachment({ id: 'id-aaa111', filename: 'doc.pdf' });
    const att2 = makeAttachment({ id: 'id-bbb222', filename: 'doc.pdf' });
    const note1 = makeNote({ id: 'n1', title: 'Note 1', attachments: [att1] });
    const note2 = makeNote({ id: 'n2', title: 'Note 2', attachments: [att2] });
    const files = exporter.export([note1, note2]);
    const attFiles = files.filter((f) => f.path.startsWith('attachments/'));
    // Should have two distinct attachment paths.
    expect(attFiles).toHaveLength(2);
    const names = attFiles.map((f) => f.path);
    expect(new Set(names).size).toBe(2);
  });

  it('leaves [[wikilinks]] untouched', () => {
    const body = 'See [[Other Note]] for details';
    const files = exporter.export([makeNote({ body })]);
    const md = files.find((f) => f.path.endsWith('.md'))!;
    expect(md.data.toString('utf8')).toContain('[[Other Note]]');
  });

  it('handles notes with empty notebook path', () => {
    const files = exporter.export([makeNote({ notebookPath: [] })]);
    const md = files.find((f) => f.path.endsWith('.md'))!;
    expect(md!.path).toBe('My Note.md');
  });

  it('uses empty tags list in frontmatter when note has no tags', () => {
    const files = exporter.export([makeNote({ tags: [] })]);
    const md = files.find((f) => f.path.endsWith('.md'))!;
    const content = md.data.toString('utf8');
    expect(content).toContain('tags: []');
  });
});
