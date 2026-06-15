/**
 * Tests for the narration scene builder (F1621 + F1622).
 */

import { describe, it, expect } from 'vitest';
import { buildScene, estimateDurationMs } from './scene.js';
import type { CastSheet } from '../casting/resolve.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const narratorVoice = { voiceId: 'narrator-1' };
const aliceVoice = { voiceId: 'alice-1' };

const fullCast: CastSheet = {
  narrator: narratorVoice,
  bySpeaker: { alice: aliceVoice },
  defaultCharacter: { voiceId: 'default-1' },
};

const nullCast: CastSheet = {
  narrator: null,
  bySpeaker: {},
  defaultCharacter: null,
};

function simpleSource(knotName: string, prose: string): string {
  return `=== ${knotName} ===\n${prose}\n`;
}

// ---------------------------------------------------------------------------
// estimateDurationMs
// ---------------------------------------------------------------------------

describe('estimateDurationMs', () => {
  it('returns 0 for empty string', () => {
    expect(estimateDurationMs('', 155)).toBe(0);
  });

  it('returns 0 for whitespace-only string', () => {
    expect(estimateDurationMs('   \n  ', 155)).toBe(0);
  });

  it('calculates duration from word count', () => {
    // 155 words at 155 wpm = 60000 ms
    const words = Array.from({ length: 155 }, (_, i) => `word${i}`).join(' ');
    expect(estimateDurationMs(words, 155)).toBe(60_000);
  });

  it('rounds to nearest ms', () => {
    // 1 word at 155 wpm = round(1/155 * 60000) = round(387.09) = 387
    expect(estimateDurationMs('hello', 155)).toBe(387);
  });

  it('scales with wpm', () => {
    // 10 words at 100 wpm = round(10/100 * 60000) = 6000
    const text = 'one two three four five six seven eight nine ten';
    expect(estimateDurationMs(text, 100)).toBe(6_000);
    // same 10 words at 200 wpm = 3000
    expect(estimateDurationMs(text, 200)).toBe(3_000);
  });
});

// ---------------------------------------------------------------------------
// buildScene
// ---------------------------------------------------------------------------

describe('buildScene', () => {
  it('returns empty scene for empty path', () => {
    const source = simpleSource('start', 'Hello world.');
    const scene = buildScene(source, [], fullCast);
    expect(scene.items).toHaveLength(0);
    expect(scene.totalEstMs).toBe(0);
  });

  it('skips unknown knot names without throwing', () => {
    const source = simpleSource('start', 'Hello world.');
    const scene = buildScene(source, ['missing', 'also_missing'], fullCast);
    expect(scene.items).toHaveLength(0);
    expect(scene.totalEstMs).toBe(0);
  });

  it('produces line items for a simple narration knot', () => {
    const source = simpleSource('start', 'The hero walked into the forest.');
    const scene = buildScene(source, ['start'], fullCast);

    expect(scene.items.length).toBeGreaterThan(0);
    const item = scene.items[0]!;
    expect(item.kind).toBe('line');
    expect(item.knot).toBe('start');
    expect(item.text).toBe('The hero walked into the forest.');
    expect(item.speaker).toBeNull();
    expect(item.voice).toBe(narratorVoice);
    expect(item.estDurationMs).toBeGreaterThan(0);
  });

  it('attributes dialogue lines to speakers', () => {
    // separateScript will detect quoted dialogue
    const source = simpleSource('talk', '"Hello there," said Alice. She smiled warmly.');
    const scene = buildScene(source, ['talk'], fullCast);

    // Should have a dialogue item for Alice and at least a narration item
    const dialogueItem = scene.items.find((i) => i.kind === 'line' && i.speaker !== null);
    expect(dialogueItem).toBeDefined();
    expect(dialogueItem!.speaker).toBe('Alice');
    expect(dialogueItem!.voice).toBe(aliceVoice);
  });

  it('produces earcon + choice items when knot has choices', () => {
    const source = `=== branch ===\nYou stand at a crossroads.\n* Go left\n* Go right\n`;
    const scene = buildScene(source, ['branch'], fullCast);

    const earconItem = scene.items.find((i) => i.kind === 'earcon');
    const choiceItem = scene.items.find((i) => i.kind === 'choice');

    expect(earconItem).toBeDefined();
    expect(earconItem!.earcon).toBe('choice-prompt');
    expect(earconItem!.text).toBe('');
    expect(earconItem!.voice).toBe(narratorVoice);
    expect(earconItem!.estDurationMs).toBe(400);

    expect(choiceItem).toBeDefined();
    expect(choiceItem!.choices).toHaveLength(2);
    expect(choiceItem!.choices![0]!.index).toBe(1);
    expect(choiceItem!.choices![1]!.index).toBe(2);
    expect(choiceItem!.speaker).toBeNull();
    expect(choiceItem!.voice).toBe(narratorVoice);
  });

  it('earcon appears after prose lines, before choice item', () => {
    const source = `=== branch ===\nSome prose here.\n* Option A\n* Option B\n`;
    const scene = buildScene(source, ['branch'], fullCast);

    const kinds = scene.items.map((i) => i.kind);
    const earconIdx = kinds.indexOf('earcon');
    const choiceIdx = kinds.indexOf('choice');
    const lineIdx = kinds.indexOf('line');

    expect(lineIdx).toBeGreaterThanOrEqual(0);
    expect(earconIdx).toBeGreaterThan(lineIdx);
    expect(choiceIdx).toBeGreaterThan(earconIdx);
  });

  it('processes multiple knots in order', () => {
    const source = `=== knot_a ===\nFirst knot.\n=== knot_b ===\nSecond knot.\n`;
    const scene = buildScene(source, ['knot_a', 'knot_b'], fullCast);

    const knotAItems = scene.items.filter((i) => i.knot === 'knot_a');
    const knotBItems = scene.items.filter((i) => i.knot === 'knot_b');

    expect(knotAItems.length).toBeGreaterThan(0);
    expect(knotBItems.length).toBeGreaterThan(0);

    // knot_a items come before knot_b items
    const lastA = scene.items.lastIndexOf(knotAItems[knotAItems.length - 1]!);
    const firstB = scene.items.indexOf(knotBItems[0]!);
    expect(lastA).toBeLessThan(firstB);
  });

  it('resolves to null voice when cast is all-null', () => {
    const source = simpleSource('start', 'Some narration text here.');
    const scene = buildScene(source, ['start'], nullCast);

    for (const item of scene.items) {
      if (item.kind === 'line') {
        expect(item.voice).toBeNull();
      }
    }
  });

  it('uses default wpm = 155', () => {
    // 155 words → 60000 ms
    const words = Array.from({ length: 155 }, (_, i) => `word${i}`).join(' ');
    const source = simpleSource('start', words);
    const scene = buildScene(source, ['start'], fullCast);

    expect(scene.items.length).toBeGreaterThan(0);
    const totalWords = scene.items.reduce((sum, item) => {
      const trimmed = item.text.trim();
      return sum + (trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length);
    }, 0);
    // totalWords should be 155 (all prose, no choices in this knot)
    expect(totalWords).toBe(155);
    // At 155 wpm, total should be exactly 60000
    const lineItems = scene.items.filter((i) => i.kind === 'line');
    const totalMs = lineItems.reduce((sum, i) => sum + i.estDurationMs, 0);
    expect(totalMs).toBe(60_000);
  });

  it('respects custom wpm option', () => {
    const source = simpleSource('start', 'one two three four five');
    // 5 words at 100 wpm = 3000 ms
    const scene100 = buildScene(source, ['start'], fullCast, { wpm: 100 });
    // 5 words at 300 wpm = 1000 ms
    const scene300 = buildScene(source, ['start'], fullCast, { wpm: 300 });

    const ms100 = scene100.items.reduce((s, i) => s + i.estDurationMs, 0);
    const ms300 = scene300.items.reduce((s, i) => s + i.estDurationMs, 0);

    expect(ms100).toBeGreaterThan(ms300);
  });

  it('totalEstMs equals sum of all item durations', () => {
    const source = `=== k ===\nHello world.\n* Choice one\n* Choice two\n`;
    const scene = buildScene(source, ['k'], fullCast);

    const expected = scene.items.reduce((sum, i) => sum + i.estDurationMs, 0);
    expect(scene.totalEstMs).toBe(expected);
  });

  it('knot with no prose but has choices emits earcon+choice without preceding line', () => {
    const source = `=== menu ===\n* Alpha\n* Beta\n* Gamma\n`;
    const scene = buildScene(source, ['menu'], fullCast);

    const kinds = scene.items.map((i) => i.kind);
    // No 'line' items; only earcon + choice
    expect(kinds).not.toContain('line');
    expect(kinds).toContain('earcon');
    expect(kinds).toContain('choice');

    const choiceItem = scene.items.find((i) => i.kind === 'choice')!;
    expect(choiceItem.choices).toHaveLength(3);
    expect(choiceItem.choices![0]!.index).toBe(1);
    expect(choiceItem.choices![2]!.index).toBe(3);
  });
});
