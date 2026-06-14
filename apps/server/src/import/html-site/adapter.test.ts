/**
 * HTML site adapter tests (F1468 — html portion).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HtmlSiteAdapter } from './adapter.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-site-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function write(relPath: string, content: string): string {
  const abs = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  return abs;
}

describe('HtmlSiteAdapter', () => {
  it('extracts title from <title> tag', () => {
    write(
      'index.html',
      '<html><head><title>My Site</title></head><body><p>Hello</p></body></html>',
    );
    const adapter = new HtmlSiteAdapter({ path: tmpDir });
    const docs = adapter.stage();
    expect(docs).toHaveLength(1);
    expect(docs[0]!.title).toBe('My Site');
  });

  it('falls back to first h1 when no <title>', () => {
    write('page.html', '<html><body><h1>The Heading</h1><p>Content</p></body></html>');
    const adapter = new HtmlSiteAdapter({ path: tmpDir });
    const docs = adapter.stage();
    expect(docs[0]!.title).toBe('The Heading');
  });

  it('falls back to filename when no title or h1', () => {
    write('my-page.html', '<html><body><p>Just text.</p></body></html>');
    const adapter = new HtmlSiteAdapter({ path: tmpDir });
    const docs = adapter.stage();
    expect(docs[0]!.title).toBe('my-page');
  });

  it('converts headings to markdown', () => {
    write(
      'headings.html',
      '<html><body><h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4></body></html>',
    );
    const adapter = new HtmlSiteAdapter({ path: tmpDir });
    const docs = adapter.stage();
    expect(docs[0]!.body).toContain('# H1');
    expect(docs[0]!.body).toContain('## H2');
    expect(docs[0]!.body).toContain('### H3');
    expect(docs[0]!.body).toContain('#### H4');
  });

  it('converts strong/b and em/i to markdown', () => {
    write(
      'styled.html',
      '<html><body><p><strong>Bold</strong> and <em>italic</em></p></body></html>',
    );
    const adapter = new HtmlSiteAdapter({ path: tmpDir });
    const docs = adapter.stage();
    expect(docs[0]!.body).toContain('**Bold**');
    expect(docs[0]!.body).toContain('*italic*');
  });

  it('converts list items to markdown dashes', () => {
    write('list.html', '<html><body><ul><li>Item A</li><li>Item B</li></ul></body></html>');
    const adapter = new HtmlSiteAdapter({ path: tmpDir });
    const docs = adapter.stage();
    expect(docs[0]!.body).toContain('- Item A');
    expect(docs[0]!.body).toContain('- Item B');
  });

  it('converts anchor links to markdown', () => {
    write('links.html', '<html><body><a href="https://example.com">External</a></body></html>');
    const adapter = new HtmlSiteAdapter({ path: tmpDir });
    const docs = adapter.stage();
    expect(docs[0]!.body).toContain('[External](https://example.com)');
  });

  it('resolves internal .html links as framework link placeholders', () => {
    write('index.html', '<html><body><a href="about.html">About</a></body></html>');
    write(
      'about.html',
      '<html><head><title>About Us</title></head><body><p>Info</p></body></html>',
    );
    const adapter = new HtmlSiteAdapter({ path: tmpDir });
    const docs = adapter.stage();
    const index = docs.find((d) => d.sourceId === 'index');
    expect(index).toBeDefined();
    expect(index!.body).toContain('{{link:about}}');
    expect(index!.links).toHaveLength(1);
    expect(index!.links[0]!.targetSourceId).toBe('about');
    expect(index!.links[0]!.label).toBe('About');
  });

  it('assigns notebookPath from parent directories', () => {
    write('docs/guide/page.html', '<html><body><p>Content</p></body></html>');
    const adapter = new HtmlSiteAdapter({ path: tmpDir });
    const docs = adapter.stage();
    expect(docs[0]!.notebookPath).toEqual(['docs', 'guide']);
  });

  it('sets sourceId as normalized relative path without extension', () => {
    write('Articles/My Post.html', '<html><body><p>Hi</p></body></html>');
    const adapter = new HtmlSiteAdapter({ path: tmpDir });
    const docs = adapter.stage();
    expect(docs[0]!.sourceId).toBe('articles/my post');
  });

  it('creates StagedAsset for local images', () => {
    // Write a small fake PNG file.
    const imgData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const imgPath = path.join(tmpDir, 'photo.png');
    fs.writeFileSync(imgPath, imgData);
    write('page.html', '<html><body><img src="photo.png" alt="A photo"/></body></html>');
    const adapter = new HtmlSiteAdapter({ path: tmpDir });
    const docs = adapter.stage();
    expect(docs[0]!.assets).toHaveLength(1);
    expect(docs[0]!.assets[0]!.filename).toBe('photo.png');
    expect(docs[0]!.body).toContain('{{asset:');
  });

  it('keeps external http images as-is', () => {
    write(
      'ext.html',
      '<html><body><img src="https://example.com/img.png" alt="ext"/></body></html>',
    );
    const adapter = new HtmlSiteAdapter({ path: tmpDir });
    const docs = adapter.stage();
    expect(docs[0]!.assets).toHaveLength(0);
    expect(docs[0]!.body).toContain('https://example.com/img.png');
  });

  it('skips dotfiles', () => {
    write('.hidden.html', '<html><body><p>Hidden</p></body></html>');
    write('visible.html', '<html><body><p>Visible</p></body></html>');
    const adapter = new HtmlSiteAdapter({ path: tmpDir });
    const docs = adapter.stage();
    expect(docs).toHaveLength(1);
    expect(docs[0]!.sourceId).toBe('visible');
  });

  it('recurses into subdirectories', () => {
    write('a.html', '<html><body><p>A</p></body></html>');
    write('sub/b.html', '<html><body><p>B</p></body></html>');
    write('sub/deep/c.html', '<html><body><p>C</p></body></html>');
    const adapter = new HtmlSiteAdapter({ path: tmpDir });
    const docs = adapter.stage();
    expect(docs).toHaveLength(3);
  });

  it('decodes HTML entities', () => {
    write('ents.html', '<html><body><p>AT&amp;T &lt;cool&gt;</p></body></html>');
    const adapter = new HtmlSiteAdapter({ path: tmpDir });
    const docs = adapter.stage();
    expect(docs[0]!.body).toContain('AT&T <cool>');
  });

  it('throws validation error for non-directory path', () => {
    write('file.html', '<html><body></body></html>');
    const adapter = new HtmlSiteAdapter({ path: path.join(tmpDir, 'file.html') });
    expect(() => adapter.stage()).toThrow();
  });

  it('throws validation error for missing path', () => {
    const adapter = new HtmlSiteAdapter({ path: path.join(tmpDir, 'nonexistent') });
    expect(() => adapter.stage()).toThrow();
  });

  it('throws validation error for relative path', () => {
    const adapter = new HtmlSiteAdapter({ path: 'relative/dir' });
    expect(() => adapter.stage()).toThrow();
  });
});
