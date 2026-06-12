import { describe, expect, it } from 'vitest';
import { diffWords, tokenizeWords, type DiffOp } from './diff.js';

const join = (ops: DiffOp[], keep: DiffOp['op']): string =>
  ops
    .filter((o) => o.op === 'equal' || o.op === keep)
    .map((o) => o.text)
    .join('');

describe('tokenizeWords', () => {
  it('round-trips exactly, preserving whitespace', () => {
    const text = '  alpha\tbeta\n\ngamma ';
    expect(tokenizeWords(text).join('')).toBe(text);
  });
});

describe('diffWords', () => {
  it('returns a single equal op for identical inputs', () => {
    expect(diffWords('same text here', 'same text here')).toEqual([
      { op: 'equal', text: 'same text here' },
    ]);
  });

  it('detects a word replacement in the middle', () => {
    expect(diffWords('alpha beta gamma', 'alpha delta gamma')).toEqual([
      { op: 'equal', text: 'alpha ' },
      { op: 'del', text: 'beta' },
      { op: 'add', text: 'delta' },
      { op: 'equal', text: ' gamma' },
    ]);
  });

  it('handles pure insertion and pure deletion', () => {
    expect(diffWords('', 'brand new')).toEqual([{ op: 'add', text: 'brand new' }]);
    expect(diffWords('all gone', '')).toEqual([{ op: 'del', text: 'all gone' }]);
  });

  it('reconstructs base from equal+del and target from equal+add', () => {
    const base = 'the quick brown fox\njumps over the lazy dog';
    const target = 'the slow brown fox\nleaps over a lazy dog today';
    const ops = diffWords(base, target);
    expect(join(ops, 'del')).toBe(base);
    expect(join(ops, 'add')).toBe(target);
  });

  it('merges adjacent ops of the same kind', () => {
    const ops = diffWords('a b c', 'x y z');
    for (let i = 1; i < ops.length; i += 1) {
      expect(ops[i]!.op).not.toBe(ops[i - 1]!.op);
    }
  });
});
