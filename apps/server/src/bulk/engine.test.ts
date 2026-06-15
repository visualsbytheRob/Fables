/**
 * Tests for apps/server/src/bulk/engine.ts (F1951–F1958).
 */

import { describe, it, expect } from 'vitest';
import {
  planBulk,
  applyPlan,
  invertPlan,
  findAndReplace,
  validateRegex,
  previewTagOp,
  mergeNotes,
  splitNote,
  planToJournalEntry,
  journalEntryToPlan,
  type BulkNote,
  type BulkPlan,
} from './engine.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function note(overrides: Partial<BulkNote> & Pick<BulkNote, 'id'>): BulkNote {
  return {
    title: `Note ${overrides.id}`,
    body: 'Default body.',
    tags: [],
    notebookId: 'nb1',
    ...overrides,
  };
}

const n1 = note({ id: 'n1', title: 'Hello World', body: 'hello world content', tags: ['a', 'b'] });
const n2 = note({
  id: 'n2',
  title: 'Goodbye World',
  body: 'goodbye world content',
  tags: ['b', 'c'],
});
const n3 = note({ id: 'n3', title: 'No match', body: 'nothing here', tags: [] });

// ---------------------------------------------------------------------------
// F1951 – BulkOp / planBulk / applyPlan / invertPlan
// ---------------------------------------------------------------------------

describe('F1951 – planBulk: findAndReplace', () => {
  it('returns a plan with diffs for matching notes', () => {
    const plan = planBulk([n1, n2, n3], {
      type: 'findAndReplace',
      options: { find: 'world', replace: 'planet' },
    });
    expect(plan.diffs).toHaveLength(2);
    expect(plan.totalAffected).toBe(2);
    expect(plan.totalExamined).toBe(3);
    expect(plan.summary).toMatch(/Find-and-replace/);
  });

  it('plan diffs contain correct before/after', () => {
    const plan = planBulk([n1], {
      type: 'findAndReplace',
      options: { find: 'world', replace: 'planet', scope: 'both' },
    });
    const diff = plan.diffs[0]!;
    expect(diff.before.body).toBe('hello world content');
    expect(diff.after.body).toBe('hello planet content');
    expect(diff.before.title).toBe('Hello World');
    // case-insensitive replace substitutes the literal replacement string (lowercase 'planet')
    expect(diff.after.title).toBe('Hello planet');
  });

  it('invalid regex returns an error plan (not a throw)', () => {
    const plan = planBulk([n1], {
      type: 'findAndReplace',
      options: { find: '[invalid', replace: 'x', mode: 'regex' },
    });
    expect(plan.diffs).toHaveLength(0);
    expect(plan.summary).toMatch(/Error/);
    expect(plan.totalAffected).toBe(0);
  });
});

describe('F1951 – applyPlan', () => {
  it('applies diffs to note list', () => {
    const plan = planBulk([n1, n2, n3], {
      type: 'findAndReplace',
      options: { find: 'world', replace: 'WORLD', scope: 'body' },
    });
    const result = applyPlan([n1, n2, n3], plan);
    const updated1 = result.find((n) => n.id === 'n1')!;
    expect(updated1.body).toBe('hello WORLD content');
  });

  it('removes notes listed in plan.removed', () => {
    const mergePlan = planBulk([n1, n2, n3], {
      type: 'merge',
      targetId: 'n1',
      sourceIds: ['n2'],
    });
    const result = applyPlan([n1, n2, n3], mergePlan);
    expect(result.find((n) => n.id === 'n2')).toBeUndefined();
    expect(result).toHaveLength(2); // n1 (updated) + n3
  });

  it('adds notes in plan.added', () => {
    const splitPlan = planBulk(
      [note({ id: 'ns', title: 'Multi', body: '## Sec A\nBody A\n## Sec B\nBody B' })],
      { type: 'split', noteId: 'ns', headingLevel: 2 },
    );
    const result = applyPlan(
      [note({ id: 'ns', title: 'Multi', body: '## Sec A\nBody A\n## Sec B\nBody B' })],
      splitPlan,
    );
    expect(result).toHaveLength(2);
  });

  it('leaves unaffected notes unchanged', () => {
    const plan = planBulk([n1], {
      type: 'findAndReplace',
      options: { find: 'hello', replace: 'hi' },
    });
    const result = applyPlan([n1, n3], plan);
    const unchanged = result.find((n) => n.id === 'n3')!;
    expect(unchanged).toBe(n3); // same object reference — not mutated
  });
});

describe('F1951 – invertPlan (undo)', () => {
  it('inverts a findAndReplace plan', () => {
    const notes = [n1, n2];
    const plan = planBulk(notes, {
      type: 'findAndReplace',
      options: { find: 'world', replace: 'planet' },
    });
    const applied = applyPlan(notes, plan);
    const undoPlan = invertPlan(plan);
    const restored = applyPlan(applied, undoPlan);

    expect(restored.find((n) => n.id === 'n1')!.body).toBe(n1.body);
    expect(restored.find((n) => n.id === 'n1')!.title).toBe(n1.title);
  });

  it('invert summary says Undo', () => {
    const plan = planBulk([n1], {
      type: 'findAndReplace',
      options: { find: 'hello', replace: 'hi' },
    });
    expect(invertPlan(plan).summary).toMatch(/^Undo:/);
  });

  it('plan is serialisable (JSON roundtrip)', () => {
    const plan = planBulk([n1, n2], {
      type: 'findAndReplace',
      options: { find: 'world', replace: 'earth' },
    });
    const json = JSON.stringify(plan);
    const parsed = JSON.parse(json) as BulkPlan;
    expect(parsed.diffs).toHaveLength(plan.diffs.length);
    expect(parsed.summary).toBe(plan.summary);
  });
});

// ---------------------------------------------------------------------------
// F1952 – findAndReplace standalone
// ---------------------------------------------------------------------------

describe('F1952 – findAndReplace', () => {
  it('literal case-insensitive by default', () => {
    const r = findAndReplace([n1], { find: 'HELLO', replace: 'hi' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.results).toHaveLength(1);
      expect(r.results[0]!.newBody).toBe('hi world content');
    }
  });

  it('literal case-sensitive respects flag', () => {
    const r = findAndReplace([n1], { find: 'HELLO', replace: 'hi', caseSensitive: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.results).toHaveLength(0);
    }
  });

  it('regex mode', () => {
    const r = findAndReplace([n1], { find: 'h.llo', replace: 'hey', mode: 'regex' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.results[0]!.newBody).toBe('hey world content');
    }
  });

  it('invalid regex returns structured error', () => {
    const r = findAndReplace([n1], { find: '(?bad', replace: 'x', mode: 'regex' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('invalid_regex');
      expect(typeof r.message).toBe('string');
    }
  });

  it('whole-word does not match partial', () => {
    const notes = [note({ id: 'w1', body: 'worlds are great' })];
    const r = findAndReplace(notes, { find: 'world', replace: 'X', wholeWord: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.results).toHaveLength(0);
    }
  });

  it('whole-word matches exact word', () => {
    const notes = [note({ id: 'w2', body: 'the world is nice' })];
    const r = findAndReplace(notes, { find: 'world', replace: 'X', wholeWord: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.results[0]!.newBody).toBe('the X is nice');
    }
  });

  it('scope: title only does not touch body', () => {
    const r = findAndReplace([n1], { find: 'World', replace: 'Planet', scope: 'title' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.results[0]!.newTitle).toBe('Hello Planet');
      expect(r.results[0]!.newBody).toBe(n1.body);
    }
  });

  it('scope: body only does not touch title', () => {
    const r = findAndReplace([n1], { find: 'world', replace: 'planet', scope: 'body' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.results[0]!.newTitle).toBe(n1.title);
      expect(r.results[0]!.newBody).toBe('hello planet content');
    }
  });

  it('returns correct match counts', () => {
    const notes = [note({ id: 'mc', body: 'foo foo foo' })];
    const r = findAndReplace(notes, { find: 'foo', replace: 'bar', scope: 'body' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.results[0]!.matchCount).toBe(3);
    }
  });
});

describe('F1952 – validateRegex', () => {
  it('valid regex returns ok: true', () => {
    expect(validateRegex('\\d+', 'g').ok).toBe(true);
  });

  it('invalid regex returns ok: false', () => {
    const r = validateRegex('[unclosed', 'g');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_regex');
  });
});

// ---------------------------------------------------------------------------
// F1953 – Bulk field editing (frontmatter)
// ---------------------------------------------------------------------------

describe('F1953 – fieldEdit via planBulk', () => {
  it('sets a frontmatter field on notes without existing frontmatter', () => {
    const myNote = note({ id: 'fe1', body: 'plain body' });
    const plan = planBulk([myNote], {
      type: 'fieldEdit',
      edits: [{ key: 'status', value: 'draft' }],
    });
    expect(plan.diffs).toHaveLength(1);
    expect(plan.diffs[0]!.after.body).toContain('status: draft');
  });

  it('updates an existing frontmatter field', () => {
    const myNote = note({ id: 'fe2', body: '---\nstatus: draft\n---\nbody' });
    const plan = planBulk([myNote], {
      type: 'fieldEdit',
      edits: [{ key: 'status', value: 'published' }],
    });
    expect(plan.diffs[0]!.after.body).toContain('status: published');
    expect(plan.diffs[0]!.after.body).not.toContain('status: draft');
  });

  it('clears a frontmatter field when value is undefined', () => {
    const myNote = note({ id: 'fe3', body: '---\nstatus: draft\n---\nbody' });
    const plan = planBulk([myNote], {
      type: 'fieldEdit',
      edits: [{ key: 'status' }],
    });
    expect(plan.diffs[0]!.after.body).not.toContain('status:');
  });

  it('sets multiple fields at once', () => {
    const myNote = note({ id: 'fe4', body: 'no frontmatter' });
    const plan = planBulk([myNote], {
      type: 'fieldEdit',
      edits: [
        { key: 'author', value: 'alice' },
        { key: 'priority', value: 'high' },
      ],
    });
    const afterBody = plan.diffs[0]!.after.body;
    expect(afterBody).toContain('author: alice');
    expect(afterBody).toContain('priority: high');
  });
});

// ---------------------------------------------------------------------------
// F1954 – Bulk wikilink rewriting
// ---------------------------------------------------------------------------

describe('F1954 – wikilinkRename via planBulk', () => {
  it('rewrites a wikilink target', () => {
    const myNote = note({ id: 'wl1', body: 'See [[Old Title]] for details.' });
    const plan = planBulk([myNote], {
      type: 'wikilinkRename',
      renames: [{ oldTitle: 'Old Title', newTitle: 'New Title' }],
    });
    expect(plan.diffs).toHaveLength(1);
    expect(plan.diffs[0]!.after.body).toBe('See [[New Title]] for details.');
  });

  it('does not partially match wikilinks', () => {
    const myNote = note({ id: 'wl2', body: 'See [[Old Title Extra]] for details.' });
    const plan = planBulk([myNote], {
      type: 'wikilinkRename',
      renames: [{ oldTitle: 'Old Title', newTitle: 'New Title' }],
    });
    // "Old Title Extra" should NOT be rewritten because target doesn't match exactly
    expect(plan.diffs).toHaveLength(0);
  });

  it('handles multiple renames in one pass', () => {
    const myNote = note({ id: 'wl3', body: '[[A]] and [[B]] and [[C]]' });
    const plan = planBulk([myNote], {
      type: 'wikilinkRename',
      renames: [
        { oldTitle: 'A', newTitle: 'Alpha' },
        { oldTitle: 'B', newTitle: 'Beta' },
      ],
    });
    expect(plan.diffs[0]!.after.body).toBe('[[Alpha]] and [[Beta]] and [[C]]');
  });
});

// ---------------------------------------------------------------------------
// F1955 – Bulk tag operations
// ---------------------------------------------------------------------------

describe('F1955 – tagOp via planBulk', () => {
  it('adds a tag to notes that do not have it', () => {
    const plan = planBulk([n1, n2, n3], { type: 'tagOp', op: { action: 'add', tag: 'new' } });
    expect(plan.diffs).toHaveLength(3); // none of the notes have 'new'
    for (const d of plan.diffs) {
      expect(d.after.tags).toContain('new');
    }
  });

  it('skips notes that already have the tag', () => {
    const plan = planBulk([n1, n2, n3], { type: 'tagOp', op: { action: 'add', tag: 'a' } });
    expect(plan.summary).toMatch(/1 already had tag/);
    // n1 has 'a', n2 and n3 don't
    expect(plan.diffs).toHaveLength(2);
  });

  it('removes a tag', () => {
    const plan = planBulk([n1, n2, n3], { type: 'tagOp', op: { action: 'remove', tag: 'b' } });
    expect(plan.diffs).toHaveLength(2);
    for (const d of plan.diffs) {
      expect(d.after.tags).not.toContain('b');
    }
  });

  it('renames a tag', () => {
    const plan = planBulk([n1, n2, n3], {
      type: 'tagOp',
      op: { action: 'rename', oldTag: 'a', newTag: 'alpha' },
    });
    expect(plan.diffs).toHaveLength(1);
    expect(plan.diffs[0]!.after.tags).toContain('alpha');
    expect(plan.diffs[0]!.after.tags).not.toContain('a');
  });
});

describe('F1955 – previewTagOp', () => {
  it('counts adds correctly', () => {
    const preview = previewTagOp([n1, n2, n3], { action: 'add', tag: 'a' });
    expect(preview.alreadyHadTag).toBe(1); // n1
    expect(preview.affected).toBe(2); // n2, n3
    expect(preview.totalNotes).toBe(3);
  });

  it('counts removes correctly', () => {
    const preview = previewTagOp([n1, n2, n3], { action: 'remove', tag: 'b' });
    expect(preview.willLoseTag).toBe(2);
    expect(preview.affected).toBe(2);
  });

  it('counts renames correctly', () => {
    const preview = previewTagOp([n1, n2, n3], { action: 'rename', oldTag: 'b', newTag: 'beta' });
    expect(preview.affected).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// F1956 – Batch merge
// ---------------------------------------------------------------------------

describe('F1956 – merge via planBulk', () => {
  it('merges source bodies into target', () => {
    const plan = planBulk([n1, n2, n3], {
      type: 'merge',
      targetId: 'n1',
      sourceIds: ['n2'],
    });
    expect(plan.diffs).toHaveLength(1);
    const merged = plan.diffs[0]!.after;
    expect(merged.body).toContain('hello world content');
    expect(merged.body).toContain('goodbye world content');
  });

  it('unions tags in merge', () => {
    const plan = planBulk([n1, n2, n3], {
      type: 'merge',
      targetId: 'n1',
      sourceIds: ['n2'],
    });
    const merged = plan.diffs[0]!.after;
    // n1 has [a,b], n2 has [b,c] → union [a,b,c]
    expect(merged.tags).toContain('a');
    expect(merged.tags).toContain('b');
    expect(merged.tags).toContain('c');
    expect(merged.tags.filter((t) => t === 'b')).toHaveLength(1); // no duplicate b
  });

  it('marks source IDs as removed', () => {
    const plan = planBulk([n1, n2, n3], {
      type: 'merge',
      targetId: 'n1',
      sourceIds: ['n2', 'n3'],
    });
    expect(plan.removed).toContain('n2');
    expect(plan.removed).toContain('n3');
  });

  it('error when target not found', () => {
    const plan = planBulk([n1], { type: 'merge', targetId: 'missing', sourceIds: ['n1'] });
    expect(plan.totalAffected).toBe(0);
    expect(plan.summary).toMatch(/not found/);
  });

  it('uses custom separator', () => {
    const plan = planBulk([n1, n2], {
      type: 'merge',
      targetId: 'n1',
      sourceIds: ['n2'],
      separator: '\n\n===\n\n',
    });
    expect(plan.diffs[0]!.after.body).toContain('===');
  });
});

describe('F1956 – mergeNotes standalone', () => {
  it('merges two notes', () => {
    const { merged, removedIds } = mergeNotes(n1, [n2]);
    expect(merged.body).toContain(n1.body);
    expect(merged.body).toContain(n2.body);
    expect(removedIds).toEqual(['n2']);
  });

  it('does not mutate inputs', () => {
    const original = { ...n1 };
    mergeNotes(n1, [n2]);
    expect(n1.body).toBe(original.body);
    expect(n1.tags).toEqual(original.tags);
  });
});

// ---------------------------------------------------------------------------
// F1957 – Batch split
// ---------------------------------------------------------------------------

describe('F1957 – split via planBulk', () => {
  it('splits by h2 headings', () => {
    const splitNote_ = note({
      id: 'sp1',
      title: 'Multi',
      body: '## Introduction\nIntro text.\n## Conclusion\nConclusion text.',
    });
    const plan = planBulk([splitNote_], { type: 'split', noteId: 'sp1', headingLevel: 2 });
    expect(plan.diffs).toHaveLength(1);
    expect(plan.added).toHaveLength(1);
    expect(plan.diffs[0]!.after.title).toBe('Introduction');
    expect(plan.added[0]!.title).toBe('Conclusion');
    expect(plan.added[0]!.body).toBe('Conclusion text.');
  });

  it('error when note not found', () => {
    const plan = planBulk([n1], { type: 'split', noteId: 'missing' });
    expect(plan.totalAffected).toBe(0);
    expect(plan.summary).toMatch(/not found/);
  });

  it('no headings returns zero diffs', () => {
    const plan = planBulk([n1], { type: 'split', noteId: 'n1', headingLevel: 2 });
    expect(plan.diffs).toHaveLength(0);
    expect(plan.summary).toMatch(/no headings/);
  });

  it('inherits tags and notebookId from original', () => {
    const splitNote_ = note({
      id: 'sp2',
      tags: ['x', 'y'],
      notebookId: 'nb99',
      body: '## A\naa\n## B\nbb',
    });
    const plan = planBulk([splitNote_], { type: 'split', noteId: 'sp2', headingLevel: 2 });
    for (const added of plan.added) {
      expect(added.tags).toEqual(['x', 'y']);
      expect(added.notebookId).toBe('nb99');
    }
  });
});

describe('F1957 – splitNote standalone', () => {
  it('splits by h1 headings', () => {
    const myNote = note({ id: 'sl1', body: '# Alpha\nA body\n# Beta\nB body' });
    const { sections } = splitNote(myNote, 1);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.title).toBe('Alpha');
    expect(sections[1]!.title).toBe('Beta');
  });

  it('first section keeps original id', () => {
    const myNote = note({ id: 'sl2', body: '## X\nx body\n## Y\ny body' });
    const { sections } = splitNote(myNote, 2);
    expect(sections[0]!.id).toBe('sl2');
    expect(sections[1]!.id).toBe('sl2-split-1');
  });

  it('does not match deeper heading levels', () => {
    const myNote = note({ id: 'sl3', body: '## Top\nbody\n### Sub\nmore' });
    const { sections } = splitNote(myNote, 2);
    // '### Sub' should be part of 'Top' body, not a new section
    expect(sections).toHaveLength(1);
    expect(sections[0]!.body).toContain('### Sub');
  });
});

// ---------------------------------------------------------------------------
// F1958 – Operation journal
// ---------------------------------------------------------------------------

describe('F1958 – planToJournalEntry / journalEntryToPlan', () => {
  it('round-trips a plan through journal entry', () => {
    const plan = planBulk([n1, n2], {
      type: 'findAndReplace',
      options: { find: 'world', replace: 'earth' },
    });
    const entry = planToJournalEntry(plan, 'j1', '2026-01-01T00:00:00Z');
    expect(entry.id).toBe('j1');
    expect(entry.createdAt).toBe('2026-01-01T00:00:00Z');
    expect(entry.before).toHaveLength(plan.diffs.length);
    expect(entry.after).toHaveLength(plan.diffs.length);

    const restored = journalEntryToPlan(entry);
    expect(restored.diffs).toHaveLength(plan.diffs.length);
    expect(restored.op).toEqual(plan.op);
  });

  it('journal entry is plain JSON-serialisable', () => {
    const plan = planBulk([n1], {
      type: 'tagOp',
      op: { action: 'add', tag: 'archived' },
    });
    const entry = planToJournalEntry(plan, 'j2', '2026-06-15T12:00:00Z');
    expect(() => JSON.stringify(entry)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(entry));
    expect(parsed.id).toBe('j2');
  });

  it('journalEntryToPlan builds correct diffs', () => {
    const plan = planBulk([n1], {
      type: 'fieldEdit',
      edits: [{ key: 'status', value: 'done' }],
    });
    const entry = planToJournalEntry(plan, 'j3', '2026-06-15T00:00:00Z');
    const restored = journalEntryToPlan(entry);
    expect(restored.diffs[0]!.before).toEqual(plan.diffs[0]!.before);
    expect(restored.diffs[0]!.after).toEqual(plan.diffs[0]!.after);
  });

  it('undo via invertPlan after journal round-trip', () => {
    const notes = [n1];
    const plan = planBulk(notes, {
      type: 'findAndReplace',
      options: { find: 'hello', replace: 'greetings' },
    });
    const entry = planToJournalEntry(plan, 'j4', '2026-06-15T00:00:00Z');
    const restoredPlan = journalEntryToPlan(entry);
    const applied = applyPlan(notes, restoredPlan);
    const undoPlan = invertPlan(restoredPlan);
    const restored = applyPlan(applied, undoPlan);
    expect(restored[0]!.body).toBe(n1.body);
  });
});
