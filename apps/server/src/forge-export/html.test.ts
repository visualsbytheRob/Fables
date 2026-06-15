/**
 * Tests for the self-contained HTML story exporter (F583, F589).
 */

import { describe, expect, it } from 'vitest';

import { compileStory, deserializeProgram, programFingerprint } from '@fables/forge-vm';

import { StoryExportError, exportStoryHtml, extractEmbeddedProgram } from './html.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HELLO_SOURCE = 'A fox trotted through the quiet wood.';
const META = { title: 'Hello Story', author: 'Test Author' };
const RUNTIME_JS = '/* fake player runtime */ window.FABLE_LOADED = true;';

// ---------------------------------------------------------------------------
// exportStoryHtml — basic structure
// ---------------------------------------------------------------------------

describe('exportStoryHtml — basic structure', () => {
  it('returns a string', () => {
    const html = exportStoryHtml(HELLO_SOURCE, META, { playerRuntimeJs: RUNTIME_JS });
    expect(typeof html).toBe('string');
  });

  it('contains <!DOCTYPE html>', () => {
    const html = exportStoryHtml(HELLO_SOURCE, META, { playerRuntimeJs: RUNTIME_JS });
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('contains the title in a <title> tag', () => {
    const html = exportStoryHtml(HELLO_SOURCE, META, { playerRuntimeJs: RUNTIME_JS });
    expect(html).toContain('<title>Hello Story</title>');
  });

  it('contains a <div id="app">', () => {
    const html = exportStoryHtml(HELLO_SOURCE, META, { playerRuntimeJs: RUNTIME_JS });
    expect(html).toContain('<div id="app">');
  });

  it('inlines the player runtime JS', () => {
    const html = exportStoryHtml(HELLO_SOURCE, META, { playerRuntimeJs: RUNTIME_JS });
    expect(html).toContain(RUNTIME_JS);
  });

  it('contains the fable-bytecode script tag', () => {
    const html = exportStoryHtml(HELLO_SOURCE, META, { playerRuntimeJs: RUNTIME_JS });
    expect(html).toContain('type="application/fable-bytecode"');
    expect(html).toContain('id="story"');
  });

  it('contains a meta author tag when author is provided', () => {
    const html = exportStoryHtml(HELLO_SOURCE, META, { playerRuntimeJs: RUNTIME_JS });
    expect(html).toContain('name="author"');
    expect(html).toContain('Test Author');
  });

  it('omits meta author tag when author is not provided', () => {
    const html = exportStoryHtml(
      HELLO_SOURCE,
      { title: 'No Author' },
      { playerRuntimeJs: RUNTIME_JS },
    );
    expect(html).not.toContain('name="author"');
  });
});

// ---------------------------------------------------------------------------
// exportStoryHtml — HTML escaping
// ---------------------------------------------------------------------------

describe('exportStoryHtml — HTML escaping', () => {
  it('escapes < > & in title', () => {
    const html = exportStoryHtml(
      HELLO_SOURCE,
      { title: '<script>alert("xss")</script>' },
      { playerRuntimeJs: RUNTIME_JS },
    );
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes & in title', () => {
    const html = exportStoryHtml(
      HELLO_SOURCE,
      { title: 'Fox & Crow' },
      { playerRuntimeJs: RUNTIME_JS },
    );
    expect(html).toContain('Fox &amp; Crow');
  });

  it('escapes " in author', () => {
    const html = exportStoryHtml(
      HELLO_SOURCE,
      { title: 'Test', author: 'Author "Quoted"' },
      { playerRuntimeJs: RUNTIME_JS },
    );
    expect(html).toContain('&quot;Quoted&quot;');
    expect(html).not.toContain('Author "Quoted"');
  });

  it('does not escape the base64 bytecode payload', () => {
    const html = exportStoryHtml(HELLO_SOURCE, META, { playerRuntimeJs: RUNTIME_JS });
    // The bytecode script tag should contain only valid base64 chars + newlines
    const match = html.match(
      /<script[^>]*type="application\/fable-bytecode"[^>]*>([\s\S]*?)<\/script>/,
    );
    expect(match).not.toBeNull();
    const b64 = match![1]!.trim();
    expect(b64).toMatch(/^[A-Za-z0-9+/=\n]+$/);
  });
});

// ---------------------------------------------------------------------------
// exportStoryHtml — error handling
// ---------------------------------------------------------------------------

describe('exportStoryHtml — error handling', () => {
  it('throws StoryExportError for invalid source', () => {
    expect(() =>
      exportStoryHtml('-> nonexistent_knot_xyz', META, { playerRuntimeJs: RUNTIME_JS }),
    ).toThrow(StoryExportError);
  });

  it('StoryExportError has a descriptive message', () => {
    try {
      exportStoryHtml('-> nonexistent_knot_xyz', META, { playerRuntimeJs: RUNTIME_JS });
    } catch (e) {
      expect(e).toBeInstanceOf(StoryExportError);
      expect((e as StoryExportError).message).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// extractEmbeddedProgram
// ---------------------------------------------------------------------------

describe('extractEmbeddedProgram', () => {
  it('returns a Uint8Array', () => {
    const html = exportStoryHtml(HELLO_SOURCE, META, { playerRuntimeJs: RUNTIME_JS });
    const bytes = extractEmbeddedProgram(html);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('throws StoryExportError when no bytecode tag is found', () => {
    expect(() => extractEmbeddedProgram('<html><body>No story here</body></html>')).toThrow(
      StoryExportError,
    );
  });

  it('returns bytes that deserialize to a valid program', () => {
    const html = exportStoryHtml(HELLO_SOURCE, META, { playerRuntimeJs: RUNTIME_JS });
    const bytes = extractEmbeddedProgram(html);
    const program = deserializeProgram(bytes);
    expect(program).toBeDefined();
    expect(Array.isArray(program.containers)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F589 — integrity guarantee
// ---------------------------------------------------------------------------

describe('F589 integrity: roundtrip fingerprint', () => {
  it('exported HTML bytecode has the same fingerprint as direct compilation', () => {
    const html = exportStoryHtml(HELLO_SOURCE, META, { playerRuntimeJs: RUNTIME_JS });
    const extractedBytes = extractEmbeddedProgram(html);
    const extractedProgram = deserializeProgram(extractedBytes);
    const extractedFingerprint = programFingerprint(extractedProgram);

    // Direct compilation fingerprint
    const directBytes = compileStory(HELLO_SOURCE);
    const directProgram = deserializeProgram(directBytes);
    const directFingerprint = programFingerprint(directProgram);

    expect(extractedFingerprint).toBe(directFingerprint);
  });

  it('integrity holds for a multi-line story', () => {
    const source = [
      '=== start ===',
      'A brave knight stood before the dragon.',
      '+ [Attack] -> attack',
      '+ [Flee] -> flee',
      '=== attack ===',
      'The knight charged! The dragon fell.',
      '-> END',
      '=== flee ===',
      'The knight ran away to fight another day.',
      '-> END',
    ].join('\n');

    const html = exportStoryHtml(source, { title: 'Dragon Story' }, { playerRuntimeJs: '' });
    const extractedBytes = extractEmbeddedProgram(html);
    const extractedProgram = deserializeProgram(extractedBytes);
    const extractedFingerprint = programFingerprint(extractedProgram);

    const directBytes = compileStory(source);
    const directProgram = deserializeProgram(directBytes);
    const directFingerprint = programFingerprint(directProgram);

    expect(extractedFingerprint).toBe(directFingerprint);
  });

  it('deterministic: same source → same HTML', () => {
    const opts = { playerRuntimeJs: RUNTIME_JS };
    const a = exportStoryHtml(HELLO_SOURCE, META, opts);
    const b = exportStoryHtml(HELLO_SOURCE, META, opts);
    expect(a).toBe(b);
  });

  it('different sources produce different embedded bytecode', () => {
    const source2 = 'A different story altogether.';
    const html1 = exportStoryHtml(HELLO_SOURCE, META, { playerRuntimeJs: RUNTIME_JS });
    const html2 = exportStoryHtml(source2, META, { playerRuntimeJs: RUNTIME_JS });
    const bytes1 = extractEmbeddedProgram(html1);
    const bytes2 = extractEmbeddedProgram(html2);
    expect(bytes1).not.toEqual(bytes2);
  });
});
