import { describe, expect, it } from 'vitest';
import { directTokenClass, forgeHighlightSpans, tokenClassName } from './tokens.js';
import type { ForgeTokenClass, HighlightSpan } from './tokens.js';

const classesAt = (source: string, needle: string): ForgeTokenClass[] => {
  const from = source.indexOf(needle);
  if (from < 0) throw new Error(`needle ${needle} not in source`);
  const to = from + needle.length;
  return forgeHighlightSpans(source)
    .filter((s) => s.from < to && s.to > from)
    .map((s) => s.cls);
};

const spanFor = (source: string, needle: string): HighlightSpan | undefined => {
  const from = source.indexOf(needle);
  return forgeHighlightSpans(source).find((s) => s.from === from && s.to === from + needle.length);
};

describe('forge tokenizer adapter (F382)', () => {
  it('classifies knot and stitch headers as headings, including the name', () => {
    const source = '=== fox_den ===\n= burrow\nProse here.\n';
    expect(classesAt(source, '===')).toContain('heading');
    expect(spanFor(source, 'fox_den')?.cls).toBe('heading');
    expect(spanFor(source, 'burrow')?.cls).toBe('heading');
  });

  it('classifies choice markers, gathers, and labels', () => {
    const source = '* (howl) Howl at the moon.\n+ Wait.\n- (after) The night passes.\n';
    expect(spanFor(source, '*')?.cls).toBe('choice');
    expect(spanFor(source, '+')?.cls).toBe('choice');
    expect(spanFor(source, '-')?.cls).toBe('choice');
    expect(spanFor(source, 'howl')?.cls).toBe('label');
    expect(spanFor(source, 'after')?.cls).toBe('label');
  });

  it('classifies logic keywords, variables, literals and operators', () => {
    const source = 'VAR hunger = 3\n~ temp name = "Reynard"\n~ hunger = hunger - 1\n';
    expect(spanFor(source, 'VAR')?.cls).toBe('keyword');
    expect(spanFor(source, 'temp')?.cls).toBe('keyword');
    expect(spanFor(source, '~')?.cls).toBe('keyword');
    expect(spanFor(source, 'hunger')?.cls).toBe('variable');
    expect(spanFor(source, '3')?.cls).toBe('number');
    expect(spanFor(source, '"Reynard"')?.cls).toBe('string');
    expect(classesAt(source, '- 1')).toContain('operator');
  });

  it('classifies diverts and dotted targets as one divert chain', () => {
    const source = 'The path forks. -> palace.throne\n->->\n<>\n';
    expect(spanFor(source, '->')?.cls).toBe('divert');
    expect(spanFor(source, 'palace')?.cls).toBe('divert');
    expect(spanFor(source, 'throne')?.cls).toBe('divert');
    expect(spanFor(source, '->->')?.cls).toBe('divert');
    expect(spanFor(source, '<>')?.cls).toBe('divert');
  });

  it('classifies bindings: @entity, fields, display names and [[notes]]', () => {
    const source = '@fox(Reynard).mood pads in. See [[The Night-Wood]].\n';
    expect(spanFor(source, '@')?.cls).toBe('binding');
    expect(spanFor(source, 'fox')?.cls).toBe('binding');
    expect(spanFor(source, 'Reynard')?.cls).toBe('binding');
    expect(spanFor(source, 'mood')?.cls).toBe('binding');
    expect(spanFor(source, '[[')?.cls).toBe('binding');
    expect(spanFor(source, 'The Night-Wood')?.cls).toBe('binding');
    expect(spanFor(source, ']]')?.cls).toBe('binding');
  });

  it('does not leak the binding class onto following prose', () => {
    const source = '@fox pads quietly into the den.\n';
    const spans = forgeHighlightSpans(source);
    // only the @ and the name are decorated; the prose stays plain
    expect(spans).toHaveLength(2);
    expect(spans.every((s) => s.cls === 'binding')).toBe(true);
  });

  it('classifies tags, comments, braces and bools', () => {
    const source = 'He yawned. # mood: sleepy\n// a note\n{lit: bright|dark}\n~ x = true\n';
    expect(classesAt(source, '# mood: sleepy')).toContain('tag');
    expect(classesAt(source, '// a note')).toContain('comment');
    expect(spanFor(source, '{')?.cls).toBe('brace');
    expect(spanFor(source, '|')?.cls).toBe('brace');
    expect(spanFor(source, 'true')?.cls).toBe('bool');
    expect(spanFor(source, 'lit')?.cls).toBe('variable');
  });

  it('marks lexer error tokens as invalid', () => {
    const source = '~ x = "unterminated\n';
    expect(forgeHighlightSpans(source).some((s) => s.cls === 'invalid')).toBe(true);
  });

  it('emits ordered, non-overlapping spans usable by a RangeSetBuilder', () => {
    const source = '=== den ===\n* {lit} Strike [the flint] now. -> den\n';
    const spans = forgeHighlightSpans(source);
    for (let i = 1; i < spans.length; i++) {
      expect((spans[i] as HighlightSpan).from).toBeGreaterThanOrEqual(
        (spans[i - 1] as HighlightSpan).to,
      );
    }
  });

  it('exposes a stable class-name scheme and direct kind table', () => {
    expect(tokenClassName('keyword')).toBe('tok-forge-keyword');
    expect(directTokenClass('VarKeyword')).toBe('keyword');
    expect(directTokenClass('Text')).toBeUndefined();
  });
});
