import { describe, it, expect } from 'vitest';
import { separateScript } from './separate.js';

describe('separateScript', () => {
  it('returns a single narration line for text with no quotes', () => {
    const lines = separateScript('Once upon a time there was a forest.');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.kind).toBe('narration');
    expect(lines[0]!.speaker).toBeNull();
  });

  it('emits dialogue for a single quoted span', () => {
    const lines = separateScript('"Hello," said Alice.');
    const dialogue = lines.filter((l) => l.kind === 'dialogue');
    expect(dialogue).toHaveLength(1);
    expect(dialogue[0]!.text).toBe('Hello,');
    expect(dialogue[0]!.speaker).toBe('Alice');
  });

  it('emits narration before and after a quote', () => {
    const lines = separateScript('She paused. "Hello," said Alice. Then she left.');
    expect(lines[0]!.kind).toBe('narration');
    expect(lines[0]!.text).toBe('She paused.');
    expect(lines[1]!.kind).toBe('dialogue');
    expect(lines[2]!.kind).toBe('narration');
    expect(lines[2]!.text).toContain('Then she left');
  });

  it('produces correct order for a mixed paragraph', () => {
    const text =
      'The wizard entered. "Greetings," said Mira. The crowd gasped. ' +
      '"Who are you?" asked Tom. Then silence fell.';
    const lines = separateScript(text);
    const kinds = lines.map((l) => l.kind);
    // narration, dialogue, narration, dialogue, narration
    expect(kinds[0]).toBe('narration');
    expect(kinds[1]).toBe('dialogue');
    expect(kinds[2]).toBe('narration');
    expect(kinds[3]).toBe('dialogue');
    expect(kinds[4]).toBe('narration');
    expect(lines[1]!.speaker).toBe('Mira');
    expect(lines[3]!.speaker).toBe('Tom');
  });

  it('sets speaker:null on narration lines', () => {
    const lines = separateScript('Alice said, "Hi." Bob left.');
    for (const line of lines.filter((l) => l.kind === 'narration')) {
      expect(line.speaker).toBeNull();
    }
  });

  it('passes knownSpeakers through to attribution', () => {
    const lines = separateScript('"Ready?" asked Mira Vale.', ['Mira Vale']);
    const dialogue = lines.find((l) => l.kind === 'dialogue');
    expect(dialogue?.speaker).toBe('Mira Vale');
  });

  it('skips empty narration segments', () => {
    // Two quotes side-by-side with no text between them.
    const lines = separateScript('"First." "Second."');
    const narration = lines.filter((l) => l.kind === 'narration');
    // There may be empty strings between quotes — they must not be emitted.
    for (const n of narration) {
      expect(n.text.length).toBeGreaterThan(0);
    }
  });

  it('handles curly-quoted text in a paragraph', () => {
    const lines = separateScript('"Go now," said the goblin. He vanished.');
    expect(lines[0]!.kind).toBe('dialogue');
    expect(lines[0]!.speaker).toBe('the goblin');
    expect(lines[1]!.kind).toBe('narration');
    expect(lines[1]!.text).toContain('He vanished');
  });

  it('collapses whitespace inside narration segments', () => {
    const lines = separateScript('  Once  upon  a  time.  "Hello."   The  end.  ');
    const narr = lines.filter((l) => l.kind === 'narration');
    for (const n of narr) {
      // No leading/trailing spaces, no double-spaces.
      expect(n.text).not.toMatch(/^\s|\s$|\s{2}/);
    }
  });
});
