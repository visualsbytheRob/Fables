/**
 * Tests for JsonExporter (F1475).
 */

import { describe, expect, it } from 'vitest';
import { JsonExporter, JSON_EXPORT_SCHEMA } from './exporter.js';
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
    id: 'att-abc123',
    filename: 'photo.png',
    mime: 'image/png',
    hash: 'deadbeef',
    read: () => Buffer.from([1, 2, 3]),
    ...overrides,
  };
}

describe('JsonExporter', () => {
  const exporter = new JsonExporter();

  it('has name "json"', () => {
    expect(exporter.name).toBe('json');
  });

  it('exports JSON_EXPORT_SCHEMA constant with correct value', () => {
    expect(JSON_EXPORT_SCHEMA).toBe('fables-export/v1');
  });

  it('produces fables-export.json as first file', () => {
    const files = exporter.export([makeNote()]);
    expect(files[0]!.path).toBe('fables-export.json');
  });

  it('fables-export.json is valid JSON with schema field', () => {
    const files = exporter.export([makeNote()]);
    const json = JSON.parse(files[0]!.data.toString('utf8'));
    expect(json.schema).toBe('fables-export/v1');
  });

  it('manifest has exportedAt ISO timestamp', () => {
    const files = exporter.export([makeNote()]);
    const json = JSON.parse(files[0]!.data.toString('utf8'));
    expect(typeof json.exportedAt).toBe('string');
    expect(() => new Date(json.exportedAt)).not.toThrow();
  });

  it('manifest has notes array with all exported notes', () => {
    const files = exporter.export([makeNote(), makeNote({ id: 'note-2', title: 'Second' })]);
    const json = JSON.parse(files[0]!.data.toString('utf8'));
    expect(Array.isArray(json.notes)).toBe(true);
    expect(json.notes).toHaveLength(2);
  });

  it('note record preserves all fields verbatim', () => {
    const note = makeNote();
    const files = exporter.export([note]);
    const json = JSON.parse(files[0]!.data.toString('utf8'));
    const rec = json.notes[0];
    expect(rec.id).toBe('note-1');
    expect(rec.title).toBe('My Note');
    expect(rec.body).toBe('Hello world');
    expect(rec.notebookPath).toEqual(['Work', 'Projects']);
    expect(rec.tags).toEqual(['alpha', 'beta']);
    expect(rec.createdAt).toBe('2024-01-01T00:00:00Z');
    expect(rec.updatedAt).toBe('2024-06-01T00:00:00Z');
  });

  it('note record has attachments array with metadata (no bytes)', () => {
    const att = makeAttachment();
    const files = exporter.export([makeNote({ attachments: [att] })]);
    const json = JSON.parse(files[0]!.data.toString('utf8'));
    const attRec = json.notes[0].attachments[0];
    expect(attRec.id).toBe('att-abc123');
    expect(attRec.filename).toBe('photo.png');
    expect(attRec.mime).toBe('image/png');
    expect(attRec.hash).toBe('deadbeef');
    // Bytes should NOT be in the manifest
    expect(attRec.data).toBeUndefined();
  });

  it('writes attachment bytes as attachments/<hash>', () => {
    const att = makeAttachment();
    const files = exporter.export([makeNote({ attachments: [att] })]);
    const attFile = files.find((f) => f.path === 'attachments/deadbeef');
    expect(attFile).toBeDefined();
    expect(attFile!.data).toEqual(Buffer.from([1, 2, 3]));
  });

  it('deduplicates attachments by hash across notes', () => {
    const att = makeAttachment({ hash: 'samehash' });
    const note1 = makeNote({ id: 'n1', title: 'Note 1', attachments: [att] });
    const note2 = makeNote({ id: 'n2', title: 'Note 2', attachments: [att] });
    const files = exporter.export([note1, note2]);
    const attFiles = files.filter((f) => f.path.startsWith('attachments/'));
    expect(attFiles).toHaveLength(1);
    expect(attFiles[0]!.path).toBe('attachments/samehash');
  });

  it('produces pretty-printed JSON (2-space indent)', () => {
    const files = exporter.export([makeNote()]);
    const raw = files[0]!.data.toString('utf8');
    // Pretty-printed JSON has newlines and spaces
    expect(raw).toContain('\n');
    expect(raw).toContain('  ');
  });

  it('handles empty notes array', () => {
    const files = exporter.export([]);
    expect(files).toHaveLength(1);
    const json = JSON.parse(files[0]!.data.toString('utf8'));
    expect(json.notes).toEqual([]);
  });

  it('handles notes with empty notebookPath and tags', () => {
    const note = makeNote({ notebookPath: [], tags: [] });
    const files = exporter.export([note]);
    const json = JSON.parse(files[0]!.data.toString('utf8'));
    expect(json.notes[0].notebookPath).toEqual([]);
    expect(json.notes[0].tags).toEqual([]);
  });
});
