/**
 * Prompt infrastructure tests (F1311/F1312/F1315/F1318/F1320).
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { AppError } from '@fables/core';
import {
  defineTemplate,
  render,
  estimateTokens,
  fitToBudget,
  extractJson,
  parseJsonResponse,
  TASK_TEMPERATURE,
} from './prompt.js';

describe('typed prompt templates (F1311)', () => {
  const tmpl = defineTemplate({
    id: 'summarize',
    system: 'You summarize notes.',
    template: 'Summarize this note titled "{{title}}":\n\n{{body}}',
    slots: ['title', 'body'] as const,
  });

  it('renders all slots and carries the system prompt', () => {
    const out = render(tmpl, { title: 'Dragons', body: 'They breathe fire.' });
    expect(out.system).toBe('You summarize notes.');
    expect(out.prompt).toContain('"Dragons"');
    expect(out.prompt).toContain('They breathe fire.');
    expect(out.prompt).not.toContain('{{');
  });

  it('rejects a missing slot at render time', () => {
    expect(() => render(tmpl, { title: 'x' } as never)).toThrowError(AppError);
  });

  it('rejects an undeclared slot at definition time', () => {
    expect(() =>
      defineTemplate({ id: 'bad', template: 'hi {{ghost}}', slots: [] as const }),
    ).toThrow(/undeclared slot/);
  });
});

describe('context budget manager (F1312)', () => {
  it('estimates tokens and fits items within budget, reserving headroom', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
    const items = [
      { id: 'a', text: 'x'.repeat(400) }, // ~100 tok
      { id: 'b', text: 'y'.repeat(400) }, // ~100 tok
      { id: 'c', text: 'z'.repeat(400) }, // ~100 tok
    ];
    const res = fitToBudget(items, 300, 100); // budget 200 → 2 items
    expect(res.included.map((i) => i.id)).toEqual(['a', 'b']);
    expect(res.droppedCount).toBe(1);
    expect(res.usedTokens).toBe(200);
  });

  it('handles an empty list and a zero budget', () => {
    expect(fitToBudget([], 1000).included).toEqual([]);
    expect(fitToBudget([{ id: 'a', text: 'hi' }], 0).included).toEqual([]);
  });
});

describe('JSON response validation (F1315)', () => {
  const schema = z.object({ tags: z.array(z.string()) });

  it('extracts JSON from a fenced response', () => {
    expect(extractJson('```json\n{"tags":["a"]}\n```')).toBe('{"tags":["a"]}');
  });

  it('extracts a bare JSON object embedded in prose', () => {
    expect(extractJson('Sure! {"tags":["a","b"]} hope that helps')).toBe('{"tags":["a","b"]}');
  });

  it('validates a good response', () => {
    const r = parseJsonResponse('{"tags":["fire","lore"]}', schema);
    expect(r).toEqual({ ok: true, data: { tags: ['fire', 'lore'] } });
  });

  it('reports failure on no-JSON / bad-JSON / schema-mismatch (for re-ask)', () => {
    expect(parseJsonResponse('I cannot do that', schema).ok).toBe(false);
    expect(parseJsonResponse('{ not valid json', schema).ok).toBe(false);
    expect(parseJsonResponse('{"tags":"not-an-array"}', schema).ok).toBe(false);
  });
});

describe('determinism presets (F1318)', () => {
  it('structured tasks are deterministic, creative tasks are warm', () => {
    expect(TASK_TEMPERATURE.tags).toBe(0);
    expect(TASK_TEMPERATURE.prose).toBeGreaterThan(0.5);
    expect(TASK_TEMPERATURE.dialogue).toBeGreaterThanOrEqual(TASK_TEMPERATURE.prose);
  });
});
