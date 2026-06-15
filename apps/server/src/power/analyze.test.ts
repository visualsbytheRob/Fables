/**
 * Tests for vault analysis tools — F1981–F1985.
 */

import { describe, it, expect } from 'vitest';
import { vaultStats, findDuplicates, findBroken, lintVault, analyzeStorage } from './analyze.js';
import type { AnalysisNote, AnalysisLink, AnalysisAttachment } from './analyze.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeNote(overrides: Partial<AnalysisNote> & { id: string }): AnalysisNote {
  return {
    title: `Note ${overrides.id}`,
    body: 'Some body text here for testing purposes.',
    tags: ['general'],
    notebookId: 'nb-1',
    sizeBytes: 100,
    updatedAt: '2024-01-15T00:00:00.000Z',
    ...overrides,
  };
}

const NOTE_A = makeNote({
  id: 'a',
  title: 'Alpha',
  body: 'The quick brown fox jumps over the lazy dog',
  tags: ['animal'],
  notebookId: 'nb-1',
  sizeBytes: 200,
  updatedAt: '2024-01-01T00:00:00.000Z',
});
const NOTE_B = makeNote({
  id: 'b',
  title: 'Beta',
  body: 'Hello world this is a test note with words',
  tags: ['test'],
  notebookId: 'nb-1',
  sizeBytes: 150,
  updatedAt: '2024-02-10T00:00:00.000Z',
});
const NOTE_C = makeNote({
  id: 'c',
  title: 'Gamma',
  body: 'The quick brown fox jumps over the lazy dog',
  tags: ['animal'],
  notebookId: 'nb-2',
  sizeBytes: 200,
  updatedAt: '2024-03-05T00:00:00.000Z',
});
const NOTE_D = makeNote({
  id: 'd',
  title: 'Delta',
  body: '  ',
  tags: [],
  notebookId: 'nb-2',
  sizeBytes: 10,
  updatedAt: '2024-04-20T00:00:00.000Z',
});
const NOTE_E = makeNote({
  id: 'e',
  title: 'Epsilon',
  body: 'The quick brown fox jumps over the lazy dogs in the forest',
  tags: ['animal', 'nature'],
  notebookId: 'nb-1',
  sizeBytes: 300,
  updatedAt: '2024-05-01T00:00:00.000Z',
});

// ---------------------------------------------------------------------------
// F1981 — vaultStats
// ---------------------------------------------------------------------------

describe('vaultStats', () => {
  it('returns zero values for empty vault', () => {
    const stats = vaultStats([], [], []);
    expect(stats.totalNotes).toBe(0);
    expect(stats.totalWords).toBe(0);
    expect(stats.totalBytes).toBe(0);
    expect(stats.tagCount).toBe(0);
    expect(stats.tagHistogram).toEqual([]);
    expect(stats.notebookDistribution).toEqual([]);
    expect(stats.orphanCount).toBe(0);
    expect(stats.linkCount).toBe(0);
    expect(stats.mostLinked).toEqual([]);
    expect(stats.notesPerMonth).toEqual([]);
    expect(stats.averageNoteLengthWords).toBe(0);
    expect(stats.medianNoteLengthWords).toBe(0);
  });

  it('counts total notes correctly', () => {
    const stats = vaultStats([NOTE_A, NOTE_B, NOTE_C], [], []);
    expect(stats.totalNotes).toBe(3);
  });

  it('sums total bytes from note sizeBytes', () => {
    const stats = vaultStats([NOTE_A, NOTE_B, NOTE_C], [], []);
    expect(stats.totalBytes).toBe(550); // 200 + 150 + 200
  });

  it('counts total words across all notes', () => {
    const notes = [
      makeNote({ id: '1', body: 'one two three' }),
      makeNote({ id: '2', body: 'a b' }),
    ];
    const stats = vaultStats(notes, [], []);
    expect(stats.totalWords).toBe(5);
  });

  it('builds tag histogram sorted by count desc', () => {
    const stats = vaultStats([NOTE_A, NOTE_B, NOTE_C, NOTE_E], [], []);
    // 'animal' appears in A, C, E → 3 times; 'test' in B → 1; 'nature' in E → 1
    expect(stats.tagHistogram[0]?.tag).toBe('animal');
    expect(stats.tagHistogram[0]?.count).toBe(3);
  });

  it('counts unique tags', () => {
    const stats = vaultStats([NOTE_A, NOTE_B, NOTE_E], [], []);
    // animal, test, nature → 3 unique tags
    expect(stats.tagCount).toBe(3);
  });

  it('computes notebook distribution', () => {
    const stats = vaultStats([NOTE_A, NOTE_B, NOTE_C, NOTE_D, NOTE_E], [], []);
    const nb1 = stats.notebookDistribution.find((n) => n.notebookId === 'nb-1');
    const nb2 = stats.notebookDistribution.find((n) => n.notebookId === 'nb-2');
    expect(nb1?.count).toBe(3); // A, B, E
    expect(nb2?.count).toBe(2); // C, D
  });

  it('computes averageNoteLengthWords', () => {
    const notes = [
      makeNote({ id: '1', body: 'one two three four' }),
      makeNote({ id: '2', body: 'a b' }),
    ];
    const stats = vaultStats(notes, [], []);
    expect(stats.averageNoteLengthWords).toBeCloseTo(3, 5); // (4 + 2) / 2
  });

  it('computes medianNoteLengthWords for even count', () => {
    const notes = [makeNote({ id: '1', body: 'a' }), makeNote({ id: '2', body: 'a b c' })];
    const stats = vaultStats(notes, [], []);
    expect(stats.medianNoteLengthWords).toBe(2); // (1+3)/2
  });

  it('computes medianNoteLengthWords for odd count', () => {
    const notes = [
      makeNote({ id: '1', body: 'a' }),
      makeNote({ id: '2', body: 'a b' }),
      makeNote({ id: '3', body: 'a b c d e' }),
    ];
    const stats = vaultStats(notes, [], []);
    expect(stats.medianNoteLengthWords).toBe(2); // sorted [1,2,5] → middle=2
  });

  it('counts orphan notes (no incoming or outgoing links)', () => {
    const notes = [NOTE_A, NOTE_B, NOTE_C];
    const links: AnalysisLink[] = [{ fromId: 'a', toTitle: 'Beta' }];
    const stats = vaultStats(notes, links, []);
    // A has outgoing, B has incoming → not orphans. C is orphan.
    expect(stats.orphanCount).toBe(1);
  });

  it('counts link count', () => {
    const links: AnalysisLink[] = [
      { fromId: 'a', toTitle: 'Beta' },
      { fromId: 'b', toTitle: 'Gamma' },
    ];
    const stats = vaultStats([NOTE_A, NOTE_B, NOTE_C], links, []);
    expect(stats.linkCount).toBe(2);
  });

  it('returns most-linked notes by incoming count', () => {
    const links: AnalysisLink[] = [
      { fromId: 'a', toTitle: 'Beta' },
      { fromId: 'c', toTitle: 'Beta' },
      { fromId: 'a', toTitle: 'Gamma' },
    ];
    const stats = vaultStats([NOTE_A, NOTE_B, NOTE_C], links, [], 5);
    expect(stats.mostLinked[0]?.noteId).toBe('b'); // Beta has 2 incoming
    expect(stats.mostLinked[0]?.incomingLinks).toBe(2);
  });

  it('groups notes-per-month correctly', () => {
    const stats = vaultStats([NOTE_A, NOTE_B, NOTE_C, NOTE_D, NOTE_E], [], []);
    const months = stats.notesPerMonth.map((m) => m.month);
    expect(months).toContain('2024-01');
    expect(months).toContain('2024-02');
    const jan = stats.notesPerMonth.find((m) => m.month === '2024-01');
    expect(jan?.count).toBe(1);
  });

  it('all notes are orphans when there are no links', () => {
    const stats = vaultStats([NOTE_A, NOTE_B], [], []);
    expect(stats.orphanCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// F1982 — findDuplicates
// ---------------------------------------------------------------------------

describe('findDuplicates', () => {
  it('returns empty array for empty notes', () => {
    expect(findDuplicates([])).toEqual([]);
  });

  it('finds exact duplicates with same normalised body', () => {
    const groups = findDuplicates([NOTE_A, NOTE_C]); // both have same body
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe('exact');
    expect(groups[0]?.similarity).toBe(1.0);
    expect(groups[0]?.noteIds).toContain('a');
    expect(groups[0]?.noteIds).toContain('c');
  });

  it('suggests most-recently-updated note as merge target for exact duplicates', () => {
    const groups = findDuplicates([NOTE_A, NOTE_C]);
    // A: 2024-01-01, C: 2024-03-05 → C is more recent
    expect(groups[0]?.suggestedMergeTarget).toBe('c');
  });

  it('no duplicate when bodies are different', () => {
    const groups = findDuplicates([NOTE_A, NOTE_B]);
    expect(groups).toHaveLength(0);
  });

  it('finds near-duplicates above threshold', () => {
    const groups = findDuplicates([NOTE_A, NOTE_E], { threshold: 0.3 });
    // "The quick brown fox jumps over the lazy dog" vs "...lazy dogs in the forest"
    // Should be near-duplicate at a low threshold
    const near = groups.find((g) => g.kind === 'near');
    expect(near).toBeDefined();
  });

  it('does not flag near-duplicates below threshold', () => {
    const groups = findDuplicates([NOTE_A, NOTE_B], { threshold: 0.99 });
    // completely different content
    expect(groups.filter((g) => g.kind === 'near')).toHaveLength(0);
  });

  it('exact duplicate notes are not re-evaluated for near-duplicates', () => {
    // A and C are exact duplicates; they should appear in exactly one 'exact' group
    const groups = findDuplicates([NOTE_A, NOTE_B, NOTE_C], { threshold: 0.1 });
    const exactGroups = groups.filter((g) => g.kind === 'exact');
    expect(exactGroups).toHaveLength(1);
    // A and C should not also appear in a near-duplicate group
    const nearGroups = groups.filter((g) => g.kind === 'near');
    for (const g of nearGroups) {
      expect(g.noteIds).not.toContain('a');
      expect(g.noteIds).not.toContain('c');
    }
  });

  it('handles single note — no duplicates', () => {
    expect(findDuplicates([NOTE_A])).toHaveLength(0);
  });

  it('normalises whitespace for exact hash comparison', () => {
    const n1 = makeNote({ id: 'x1', body: 'hello   world' });
    const n2 = makeNote({ id: 'x2', body: 'hello world' });
    const groups = findDuplicates([n1, n2]);
    expect(groups[0]?.kind).toBe('exact');
  });

  it('normalises case for exact hash comparison', () => {
    const n1 = makeNote({ id: 'y1', body: 'Hello World' });
    const n2 = makeNote({ id: 'y2', body: 'hello world' });
    const groups = findDuplicates([n1, n2]);
    expect(groups[0]?.kind).toBe('exact');
  });

  it('returns sorted noteIds within each group', () => {
    const groups = findDuplicates([NOTE_C, NOTE_A]);
    expect(groups[0]?.noteIds).toEqual(['a', 'c']);
  });
});

// ---------------------------------------------------------------------------
// F1983 — findBroken
// ---------------------------------------------------------------------------

describe('findBroken', () => {
  it('returns empty report for pristine vault', () => {
    const links: AnalysisLink[] = [{ fromId: 'a', toTitle: 'Beta' }];
    const atts: AnalysisAttachment[] = [
      { id: 'att1', noteId: 'a', name: 'file.png', sizeBytes: 500, present: true },
    ];
    const report = findBroken([NOTE_A, NOTE_B], links, atts);
    expect(report.brokenLinks).toHaveLength(0);
    expect(report.missingAttachments).toHaveLength(0);
    expect(report.emptyNotes).toHaveLength(0);
  });

  it('detects broken wikilinks', () => {
    const links: AnalysisLink[] = [{ fromId: 'a', toTitle: 'NonExistent' }];
    const report = findBroken([NOTE_A, NOTE_B], links, []);
    expect(report.brokenLinks).toHaveLength(1);
    expect(report.brokenLinks[0]?.toTitle).toBe('NonExistent');
  });

  it('detects missing attachments (present: false)', () => {
    const atts: AnalysisAttachment[] = [
      { id: 'att1', noteId: 'a', name: 'photo.jpg', sizeBytes: 100, present: false },
    ];
    const report = findBroken([NOTE_A], [], atts);
    expect(report.missingAttachments).toHaveLength(1);
    expect(report.missingAttachments[0]?.name).toBe('photo.jpg');
  });

  it('does not flag present attachments', () => {
    const atts: AnalysisAttachment[] = [
      { id: 'att1', noteId: 'a', name: 'ok.jpg', sizeBytes: 100, present: true },
    ];
    const report = findBroken([NOTE_A], [], atts);
    expect(report.missingAttachments).toHaveLength(0);
  });

  it('detects whitespace-only notes as empty', () => {
    const report = findBroken([NOTE_A, NOTE_D], [], []);
    expect(report.emptyNotes).toHaveLength(1);
    expect(report.emptyNotes[0]?.noteId).toBe('d');
  });

  it('is case-insensitive for wikilink title matching', () => {
    const links: AnalysisLink[] = [{ fromId: 'a', toTitle: 'BETA' }];
    const report = findBroken([NOTE_A, NOTE_B], links, []);
    // "BETA" should match "Beta"
    expect(report.brokenLinks).toHaveLength(0);
  });

  it('returns broken links sorted by fromId then toTitle', () => {
    const links: AnalysisLink[] = [
      { fromId: 'b', toTitle: 'Missing2' },
      { fromId: 'a', toTitle: 'Missing1' },
    ];
    const report = findBroken([NOTE_A, NOTE_B], links, []);
    expect(report.brokenLinks[0]?.fromId).toBe('a');
    expect(report.brokenLinks[1]?.fromId).toBe('b');
  });
});

// ---------------------------------------------------------------------------
// F1984 — lintVault
// ---------------------------------------------------------------------------

describe('lintVault', () => {
  it('returns no findings for a clean note', () => {
    const clean = makeNote({
      id: 'clean',
      title: 'Clean Note',
      body: 'This is a good note with [[another note]] linked.',
      tags: ['good'],
    });
    // disable orphan-note since body has a wikilink
    const findings = lintVault([clean], { disabled: [] });
    const nonOrphan = findings.filter((f) => f.ruleId !== 'orphan-note');
    expect(nonOrphan).toHaveLength(0);
  });

  it('fires empty-title for blank title', () => {
    const note = makeNote({ id: 'x', title: '', tags: ['t'], body: '[[link]]' });
    const findings = lintVault([note]);
    const f = findings.find((f) => f.ruleId === 'empty-title');
    expect(f).toBeDefined();
    expect(f?.severity).toBe('error');
  });

  it('fires title-case for lowercase first letter', () => {
    const note = makeNote({ id: 'x', title: 'uncapitalised title', tags: ['t'], body: '[[link]]' });
    const findings = lintVault([note]);
    const f = findings.find((f) => f.ruleId === 'title-case');
    expect(f).toBeDefined();
    expect(f?.severity).toBe('warning');
    expect(f?.fix).toEqual({ kind: 'setTitle', title: 'Uncapitalised title' });
  });

  it('does not fire title-case for already-capitalised title', () => {
    const note = makeNote({ id: 'x', title: 'Good Title', tags: ['t'], body: '[[link]]' });
    const findings = lintVault([note]);
    expect(findings.filter((f) => f.ruleId === 'title-case')).toHaveLength(0);
  });

  it('fires untagged-note for notes with no tags', () => {
    const note = makeNote({ id: 'x', title: 'No Tags', tags: [], body: '[[link]]' });
    const findings = lintVault([note]);
    const f = findings.find((f) => f.ruleId === 'untagged-note');
    expect(f).toBeDefined();
    expect(f?.severity).toBe('info');
    expect(f?.fix).toEqual({ kind: 'addTag', tag: 'inbox' });
  });

  it('fires very-long-note when exceeding maxWords', () => {
    const longBody = Array.from({ length: 5001 }, (_, i) => `word${i}`).join(' ');
    const note = makeNote({ id: 'x', title: 'Long', tags: ['t'], body: longBody });
    const findings = lintVault([note]);
    const f = findings.find((f) => f.ruleId === 'very-long-note');
    expect(f).toBeDefined();
    expect(f?.fix).toEqual({ kind: 'splitNote' });
  });

  it('respects custom maxWords threshold', () => {
    const body = 'one two three four five';
    const note = makeNote({ id: 'x', title: 'Short Long', tags: ['t'], body });
    const findings = lintVault([note], { maxWords: 4 });
    expect(findings.find((f) => f.ruleId === 'very-long-note')).toBeDefined();
  });

  it('fires duplicate-title for notes sharing a title', () => {
    const n1 = makeNote({ id: '1', title: 'Duplicate Title', tags: ['t'], body: '[[link]]' });
    const n2 = makeNote({ id: '2', title: 'Duplicate Title', tags: ['t'], body: '[[link2]]' });
    const findings = lintVault([n1, n2]);
    const dups = findings.filter((f) => f.ruleId === 'duplicate-title');
    expect(dups).toHaveLength(2);
    expect(dups[0]?.severity).toBe('error');
  });

  it('fires orphan-note when no outgoing wikilinks', () => {
    const note = makeNote({ id: 'x', title: 'Orphan', tags: ['t'], body: 'no links here' });
    const findings = lintVault([note]);
    expect(findings.find((f) => f.ruleId === 'orphan-note')).toBeDefined();
  });

  it('does not fire orphan-note when note has [[wikilinks]]', () => {
    const note = makeNote({ id: 'x', title: 'Linked', tags: ['t'], body: 'See [[other note]]' });
    const findings = lintVault([note]);
    expect(findings.filter((f) => f.ruleId === 'orphan-note')).toHaveLength(0);
  });

  it('fires title-convention when title does not match pattern', () => {
    const note = makeNote({ id: 'x', title: 'my note', tags: ['t'], body: '[[link]]' });
    const findings = lintVault([note], { titlePattern: '^[A-Z]', disabled: ['title-case'] });
    expect(findings.find((f) => f.ruleId === 'title-convention')).toBeDefined();
  });

  it('does not fire title-convention when no pattern configured', () => {
    const note = makeNote({ id: 'x', title: 'anything goes', tags: ['t'], body: '[[link]]' });
    const findings = lintVault([note], {
      disabled: ['title-case', 'orphan-note', 'untagged-note'],
    });
    expect(findings.filter((f) => f.ruleId === 'title-convention')).toHaveLength(0);
  });

  it('respects disabled rules', () => {
    const note = makeNote({ id: 'x', title: '', tags: [], body: 'no links' });
    const findings = lintVault([note], {
      disabled: ['empty-title', 'untagged-note', 'orphan-note'],
    });
    expect(findings.find((f) => f.ruleId === 'empty-title')).toBeUndefined();
    expect(findings.find((f) => f.ruleId === 'untagged-note')).toBeUndefined();
  });

  it('allows severity overrides', () => {
    const note = makeNote({ id: 'x', title: '', tags: ['t'], body: '[[link]]' });
    const findings = lintVault([note], { severities: { 'empty-title': 'info' } });
    const f = findings.find((f) => f.ruleId === 'empty-title');
    expect(f?.severity).toBe('info');
  });

  it('sorts findings: errors first, then warnings, then info', () => {
    const note = makeNote({ id: 'x', title: '', tags: [], body: 'no links' });
    const findings = lintVault([note]);
    const severities = findings.map((f) => f.severity);
    // errors before warnings before info
    let lastSev = -1;
    const order: Record<string, number> = { error: 0, warning: 1, info: 2 };
    for (const s of severities) {
      const v = order[s] ?? 99;
      expect(v).toBeGreaterThanOrEqual(lastSev);
      lastSev = v;
    }
  });

  it('includes noteId on every finding', () => {
    const note = makeNote({ id: 'zz', title: '', tags: [], body: 'no links' });
    const findings = lintVault([note]);
    for (const f of findings) {
      expect(f.noteId).toBe('zz');
    }
  });
});

// ---------------------------------------------------------------------------
// F1985 — analyzeStorage
// ---------------------------------------------------------------------------

describe('analyzeStorage', () => {
  it('returns zero values for empty vault', () => {
    const report = analyzeStorage([], []);
    expect(report.totalBytes).toBe(0);
    expect(report.noteBodyBytes).toBe(0);
    expect(report.attachmentBytes).toBe(0);
    expect(report.byNotebook).toEqual([]);
    expect(report.topNotes).toEqual([]);
    expect(report.topAttachments).toEqual([]);
    expect(report.largestItemShare).toBe(0);
  });

  it('sums totalBytes as noteBodyBytes + attachmentBytes', () => {
    const atts: AnalysisAttachment[] = [
      { id: 'a1', noteId: 'a', name: 'img.png', sizeBytes: 400, present: true },
    ];
    const report = analyzeStorage([NOTE_A, NOTE_B], atts);
    // NOTE_A = 200, NOTE_B = 150, att = 400 → total = 750
    expect(report.totalBytes).toBe(750);
    expect(report.noteBodyBytes).toBe(350);
    expect(report.attachmentBytes).toBe(400);
  });

  it('breaks down storage by notebook', () => {
    const report = analyzeStorage([NOTE_A, NOTE_B, NOTE_C], []);
    const nb1 = report.byNotebook.find((n) => n.notebookId === 'nb-1');
    const nb2 = report.byNotebook.find((n) => n.notebookId === 'nb-2');
    expect(nb1?.noteBodyBytes).toBe(350); // 200 + 150
    expect(nb2?.noteBodyBytes).toBe(200); // 200
  });

  it('includes attachment bytes in notebook breakdown', () => {
    const atts: AnalysisAttachment[] = [
      { id: 'a1', noteId: 'a', name: 'img.png', sizeBytes: 500, present: true },
    ];
    const report = analyzeStorage([NOTE_A, NOTE_B], atts);
    const nb1 = report.byNotebook.find((n) => n.notebookId === 'nb-1');
    expect(nb1?.attachmentBytes).toBe(500);
    expect(nb1?.totalBytes).toBe(850); // 350 + 500
  });

  it('returns top notes sorted by size desc', () => {
    const report = analyzeStorage([NOTE_A, NOTE_B, NOTE_C, NOTE_E], []);
    // E=300 > A=200 = C=200 > B=150
    expect(report.topNotes[0]?.id).toBe('e');
    expect(report.topNotes[0]?.sizeBytes).toBe(300);
  });

  it('limits topNotes to topN param', () => {
    const notes = Array.from({ length: 15 }, (_, i) =>
      makeNote({ id: `n${i}`, sizeBytes: i * 10 }),
    );
    const report = analyzeStorage(notes, [], 5);
    expect(report.topNotes).toHaveLength(5);
  });

  it('computes shareOfTotal for top notes', () => {
    const report = analyzeStorage([NOTE_A, NOTE_B], []);
    // A=200, B=150, total=350
    expect(report.topNotes[0]?.shareOfTotal).toBeCloseTo(200 / 350, 5);
  });

  it('returns top attachments sorted by size desc', () => {
    const atts: AnalysisAttachment[] = [
      { id: 'small', noteId: 'a', name: 'small.png', sizeBytes: 50, present: true },
      { id: 'large', noteId: 'b', name: 'large.png', sizeBytes: 999, present: true },
    ];
    const report = analyzeStorage([NOTE_A, NOTE_B], atts);
    expect(report.topAttachments[0]?.id).toBe('large');
  });

  it('computes largestItemShare', () => {
    const atts: AnalysisAttachment[] = [
      { id: 'a1', noteId: 'a', name: 'file.png', sizeBytes: 100, present: true },
    ];
    const report = analyzeStorage([NOTE_A], atts, 1);
    // topNotes: A=200, topAttachments: a1=100, total=300
    // share = (200 + 100) / 300 = 1.0
    expect(report.largestItemShare).toBeCloseTo(1.0, 5);
  });

  it('includes name field in topNotes from note title', () => {
    const report = analyzeStorage([NOTE_A], []);
    expect(report.topNotes[0]?.name).toBe('Alpha');
  });

  it('includes name field in topAttachments from attachment name', () => {
    const atts: AnalysisAttachment[] = [
      { id: 'a1', noteId: 'a', name: 'photo.jpg', sizeBytes: 200, present: true },
    ];
    const report = analyzeStorage([NOTE_A], atts);
    expect(report.topAttachments[0]?.name).toBe('photo.jpg');
  });

  it('sorts byNotebook by totalBytes desc', () => {
    const report = analyzeStorage([NOTE_A, NOTE_B, NOTE_C], []);
    // nb-1 has 350, nb-2 has 200
    expect(report.byNotebook[0]?.notebookId).toBe('nb-1');
  });
});
