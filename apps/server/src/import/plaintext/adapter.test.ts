/**
 * Plain text importer tests (F1467).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlaintextAdapter } from './adapter.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'plaintext-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('PlaintextAdapter (F1467)', () => {
  it('reads a single .txt file', () => {
    const file = path.join(root, 'note.txt');
    fs.writeFileSync(file, 'Hello world\n\nSome content here.\n');
    const docs = new PlaintextAdapter({ path: file }).stage();
    expect(docs).toHaveLength(1);
  });

  it('uses first non-empty line as title when no heading', () => {
    const file = path.join(root, 'note.txt');
    fs.writeFileSync(file, 'Hello world\n\nSome content here.\n');
    const docs = new PlaintextAdapter({ path: file }).stage();
    expect(docs[0]!.title).toBe('Hello world');
  });

  it('detects ALL CAPS line as heading', () => {
    const file = path.join(root, 'caps.txt');
    fs.writeFileSync(file, 'INTRODUCTION\n\nSome text.\n');
    const docs = new PlaintextAdapter({ path: file }).stage();
    expect(docs[0]!.title).toBe('INTRODUCTION');
    expect(docs[0]!.body).toContain('# INTRODUCTION');
  });

  it('detects setext === underline as h1 heading', () => {
    const file = path.join(root, 'setext.txt');
    fs.writeFileSync(file, 'My Title\n========\n\nContent.\n');
    const docs = new PlaintextAdapter({ path: file }).stage();
    expect(docs[0]!.title).toBe('My Title');
    expect(docs[0]!.body).toContain('# My Title');
    expect(docs[0]!.body).not.toContain('========');
  });

  it('detects setext --- underline as h2 heading', () => {
    const file = path.join(root, 'setext2.txt');
    fs.writeFileSync(file, 'Section\n-------\n\nContent.\n');
    const docs = new PlaintextAdapter({ path: file }).stage();
    expect(docs[0]!.body).toContain('## Section');
    expect(docs[0]!.body).not.toContain('-------');
  });

  it('normalizes * and • bullets to - ', () => {
    const file = path.join(root, 'bullets.txt');
    fs.writeFileSync(file, '* Item A\n• Item B\n- Item C\n');
    const docs = new PlaintextAdapter({ path: file }).stage();
    const lines = docs[0]!.body.split('\n');
    expect(lines.filter((l) => l.startsWith('- '))).toHaveLength(3);
  });

  it('preserves ordered list items', () => {
    const file = path.join(root, 'ordered.txt');
    fs.writeFileSync(file, '1. First\n2. Second\n3. Third\n');
    const docs = new PlaintextAdapter({ path: file }).stage();
    expect(docs[0]!.body).toContain('1. First');
    expect(docs[0]!.body).toContain('2. Second');
  });

  it('sourceId is filename lowercased (relative path)', () => {
    const file = path.join(root, 'MyNote.txt');
    fs.writeFileSync(file, 'content');
    const docs = new PlaintextAdapter({ path: file }).stage();
    expect(docs[0]!.sourceId).toBe('mynote.txt');
  });

  it('notebookPath is empty for single file import', () => {
    const file = path.join(root, 'note.txt');
    fs.writeFileSync(file, 'content');
    const docs = new PlaintextAdapter({ path: file }).stage();
    expect(docs[0]!.notebookPath).toEqual([]);
  });

  it('reads a directory of .txt files recursively', () => {
    const subdir = path.join(root, 'Sub');
    fs.mkdirSync(subdir);
    fs.writeFileSync(path.join(root, 'a.txt'), 'File A');
    fs.writeFileSync(path.join(subdir, 'b.txt'), 'File B');
    const docs = new PlaintextAdapter({ path: root }).stage();
    expect(docs).toHaveLength(2);
  });

  it('sets notebookPath from parent dirs relative to root', () => {
    const subdir = path.join(root, 'Notes', 'Work');
    fs.mkdirSync(subdir, { recursive: true });
    fs.writeFileSync(path.join(subdir, 'task.txt'), 'Task content');
    const docs = new PlaintextAdapter({ path: root }).stage();
    expect(docs[0]!.notebookPath).toEqual(['Notes', 'Work']);
  });

  it('sourceId for directory import is relative path lowercased', () => {
    const subdir = path.join(root, 'Sub');
    fs.mkdirSync(subdir);
    fs.writeFileSync(path.join(subdir, 'MyFile.txt'), 'content');
    const docs = new PlaintextAdapter({ path: root }).stage();
    expect(docs[0]!.sourceId).toBe('sub/myfile.txt');
  });

  it('uses filename as title when file is empty', () => {
    const file = path.join(root, 'empty.txt');
    fs.writeFileSync(file, '');
    const docs = new PlaintextAdapter({ path: file }).stage();
    expect(docs[0]!.title).toBe('empty');
  });

  it('truncates long first-line titles to 120 chars', () => {
    const long = 'A'.repeat(200);
    const file = path.join(root, 'long.txt');
    fs.writeFileSync(file, long);
    const docs = new PlaintextAdapter({ path: file }).stage();
    expect(docs[0]!.title.length).toBeLessThanOrEqual(120);
  });

  it('rejects non-.txt files', () => {
    const file = path.join(root, 'note.md');
    fs.writeFileSync(file, 'content');
    expect(() => new PlaintextAdapter({ path: file }).stage()).toThrow();
  });

  it('ALL CAPS must have more than 3 letters to be a heading', () => {
    const file = path.join(root, 'short.txt');
    fs.writeFileSync(file, 'HI\n\nOther content.\n');
    const docs = new PlaintextAdapter({ path: file }).stage();
    // 'HI' has only 2 letters, should NOT become a heading
    expect(docs[0]!.body).not.toContain('# HI');
  });
});
