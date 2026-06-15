import { describe, expect, it } from 'vitest';
import { parseSpeechMarkup, segmentsToPlainText } from './markup.js';

describe('parseSpeechMarkup', () => {
  it('returns a single plain-text segment for unadorned text', () => {
    const segs = parseSpeechMarkup('Hello world');
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ text: 'Hello world' });
    expect(segs[0]!.emphasis).toBeUndefined();
    expect(segs[0]!.rate).toBeUndefined();
    expect(segs[0]!.pauseAfterMs).toBeUndefined();
  });

  it('collapses runs of whitespace in plain text', () => {
    const segs = parseSpeechMarkup('Hello   world');
    expect(segs).toHaveLength(1);
    expect(segs[0]!.text).toBe('Hello world');
  });

  // -------------------------------------------------------------------------
  // Pause handling
  // -------------------------------------------------------------------------

  it('[pause] attaches a 500 ms pause to the preceding segment', () => {
    const segs = parseSpeechMarkup('Hello[pause]');
    expect(segs).toHaveLength(1);
    expect(segs[0]!.text).toBe('Hello');
    expect(segs[0]!.pauseAfterMs).toBe(500);
  });

  it('[pause 800] attaches an 800 ms pause', () => {
    const segs = parseSpeechMarkup('Hi[pause 800]');
    expect(segs[0]!.pauseAfterMs).toBe(800);
  });

  it('[pause 800ms] attaches an 800 ms pause', () => {
    const segs = parseSpeechMarkup('Hi[pause 800ms]');
    expect(segs[0]!.pauseAfterMs).toBe(800);
  });

  it('[pause] at the start emits a standalone empty segment', () => {
    const segs = parseSpeechMarkup('[pause]Then words');
    // First segment: standalone pause, second: text
    expect(segs[0]).toMatchObject({ text: '', pauseAfterMs: 500 });
    expect(segs[1]).toMatchObject({ text: 'Then words' });
  });

  it('multiple [pause] tokens accumulate on the same preceding segment', () => {
    const segs = parseSpeechMarkup('A[pause 200][pause 300]');
    expect(segs).toHaveLength(1);
    expect(segs[0]!.pauseAfterMs).toBe(500);
  });

  // -------------------------------------------------------------------------
  // Emphasis
  // -------------------------------------------------------------------------

  it('*x* sets emphasis and strips the asterisk markers', () => {
    const segs = parseSpeechMarkup('*emphasized*');
    expect(segs).toHaveLength(1);
    expect(segs[0]!.text).toBe('emphasized');
    expect(segs[0]!.emphasis).toBe(true);
  });

  it('emphasis mid-sentence splits into three segments', () => {
    const segs = parseSpeechMarkup('before *middle* after');
    expect(segs).toHaveLength(3);
    expect(segs[0]!.emphasis).toBeUndefined();
    expect(segs[1]!.emphasis).toBe(true);
    expect(segs[1]!.text).toBe('middle');
    expect(segs[2]!.emphasis).toBeUndefined();
  });

  it('unmatched * is treated as plain text', () => {
    const segs = parseSpeechMarkup('price is $5*');
    expect(segs).toHaveLength(1);
    expect(segs[0]!.text).toBe('price is $5*');
    expect(segs[0]!.emphasis).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Rate tags
  // -------------------------------------------------------------------------

  it('{rate:slow} … {/rate} makes only the enclosed text slow', () => {
    const segs = parseSpeechMarkup('{rate:slow}a{/rate}b');
    // "a" is slow, "b" is plain
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ text: 'a', rate: 'slow' });
    expect(segs[1]).toMatchObject({ text: 'b' });
    expect(segs[1]!.rate).toBeUndefined();
  });

  it('supports all valid rate values', () => {
    for (const r of ['x-slow', 'slow', 'normal', 'fast', 'x-fast']) {
      const segs = parseSpeechMarkup(`{rate:${r}}word{/rate}`);
      expect(segs[0]!.rate).toBe(r);
    }
  });

  it('rate carries into emphasis segments inside the rate block', () => {
    const segs = parseSpeechMarkup('{rate:fast}*go*{/rate}');
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ text: 'go', rate: 'fast', emphasis: true });
  });

  it('unknown {rate:???} tag is emitted as plain text', () => {
    const segs = parseSpeechMarkup('{rate:warp}word{/rate}');
    // Falls through as plain text including the literal braces
    const joined = segs.map((s) => s.text).join('');
    expect(joined).toContain('word');
  });

  // -------------------------------------------------------------------------
  // Mixed input
  // -------------------------------------------------------------------------

  it('parses mixed markup in order', () => {
    const segs = parseSpeechMarkup('Hello *world*[pause 200]{rate:slow}farewell{/rate}');
    // "Hello" → plain
    // "world" → emphasis
    // pause attaches to "world"
    // "farewell" → slow rate
    expect(segs).toHaveLength(3);
    expect(segs[0]!.text).toBe('Hello');
    expect(segs[1]!.text).toBe('world');
    expect(segs[1]!.emphasis).toBe(true);
    expect(segs[1]!.pauseAfterMs).toBe(200);
    expect(segs[2]!.text).toBe('farewell');
    expect(segs[2]!.rate).toBe('slow');
  });

  it('returns empty array for empty input', () => {
    expect(parseSpeechMarkup('')).toEqual([]);
  });

  it('returns empty array for whitespace-only input', () => {
    expect(parseSpeechMarkup('   ')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// segmentsToPlainText
// ---------------------------------------------------------------------------

describe('segmentsToPlainText', () => {
  it('concatenates text fields separated by spaces', () => {
    const segs = parseSpeechMarkup('Hello *world* today');
    expect(segmentsToPlainText(segs)).toBe('Hello world today');
  });

  it('skips empty-text pause segments', () => {
    const segs = parseSpeechMarkup('[pause]Hello');
    // First segment has empty text (pause-only), second is "Hello"
    expect(segmentsToPlainText(segs)).toBe('Hello');
  });

  it('round-trips plain words through parse → plainText', () => {
    const input = 'The quick brown fox';
    const segs = parseSpeechMarkup(input);
    expect(segmentsToPlainText(segs)).toBe(input);
  });

  it('returns empty string for empty segment array', () => {
    expect(segmentsToPlainText([])).toBe('');
  });
});
