import { describe, expect, it } from 'vitest';
import type { SnapshotFieldDiff, WorldEntityView, WorldExport } from './api.js';
import {
  assertWorldExport,
  diffRowClass,
  diffStatusGlyph,
  exportBlob,
  exportFilename,
  formatFieldValue,
  summarizeMutations,
} from './pure.js';

const view = (
  mutatedFields: WorldEntityView['mutatedFields'],
  fields: Record<string, unknown> = {},
): WorldEntityView => ({ id: 'e1', type: 'character', name: 'Atlas', fields, mutatedFields });

describe('formatFieldValue', () => {
  it('renders primitives, lists, objects, and null', () => {
    expect(formatFieldValue('hi')).toBe('hi');
    expect(formatFieldValue(42)).toBe('42');
    expect(formatFieldValue(true)).toBe('true');
    expect(formatFieldValue(null)).toBe('∅');
    expect(formatFieldValue(undefined)).toBe('∅');
    expect(formatFieldValue(['a', 'b'])).toBe('a, b');
    expect(formatFieldValue({ x: 1 })).toBe('{"x":1}');
  });
});

describe('summarizeMutations', () => {
  it('rolls up counts, sorted fields, and distinct stories', () => {
    const s = summarizeMutations(
      view({
        health: { count: 3, lastAt: 't1', storyIds: ['s1', 's2'] },
        armor: { count: 1, lastAt: 't2', storyIds: ['s2'] },
      }),
    );
    expect(s.hasMutations).toBe(true);
    expect(s.fields).toEqual(['armor', 'health']);
    expect(s.totalCount).toBe(4);
    expect(s.storyIds).toEqual(['s1', 's2']);
  });

  it('reports no mutations for an untouched entity', () => {
    const s = summarizeMutations(view({}));
    expect(s.hasMutations).toBe(false);
    expect(s.totalCount).toBe(0);
    expect(s.storyIds).toEqual([]);
  });
});

describe('diff helpers', () => {
  it('maps status to a class and glyph', () => {
    expect(diffRowClass('added')).toBe('world-diff-row world-diff-added');
    expect(diffRowClass('removed')).toContain('world-diff-removed');
    const glyphs = (['added', 'removed', 'changed'] as SnapshotFieldDiff['status'][]).map(
      diffStatusGlyph,
    );
    expect(new Set(glyphs).size).toBe(3);
  });
});

describe('export helpers', () => {
  it('builds a timestamped json filename', () => {
    const name = exportFilename(new Date('2026-06-13T08:09:10.500Z'));
    expect(name).toBe('fables-world-2026-06-13_08-09-10.json');
    expect(name.endsWith('.json')).toBe(true);
  });

  it('serialises an export to a json blob', () => {
    const payload: WorldExport = {
      version: 1,
      entities: [{ id: 'e1', type: 'item', name: 'Sword', fields: { dmg: 5 } }],
    };
    const blob = exportBlob(payload);
    expect(blob.type).toBe('application/json');
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe('assertWorldExport', () => {
  it('accepts a well-formed payload', () => {
    expect(() =>
      assertWorldExport({ version: 1, entities: [{ id: 'e1', fields: {} }] }),
    ).not.toThrow();
  });

  it('rejects malformed payloads', () => {
    expect(() => assertWorldExport(null)).toThrow();
    expect(() => assertWorldExport({ entities: [] })).toThrow(/version/);
    expect(() => assertWorldExport({ version: 1 })).toThrow(/entities/);
    expect(() => assertWorldExport({ version: 1, entities: [{ fields: {} }] })).toThrow(/id/);
  });
});
