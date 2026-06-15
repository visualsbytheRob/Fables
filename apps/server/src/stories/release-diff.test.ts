/**
 * Release diffing tests (F1842/F1843/F1844).
 */

import { describe, expect, it } from 'vitest';
import { knotsIn, diffReleases, generateChangelog, saveCompat } from './release-diff.js';

const v1 = {
  'main.fable': '=== intro ===\nHello.\n-> forest\n\n=== forest ===\nTrees.\n-> END\n',
};
const v2 = {
  'main.fable':
    '=== intro ===\nHello there.\n-> forest\n\n=== forest ===\nTrees.\n-> cave\n\n=== cave ===\nDark.\n-> END\n',
};

describe('knotsIn', () => {
  it('lists declared knots', () => {
    expect(knotsIn(v1['main.fable'])).toEqual(['intro', 'forest']);
  });
});

describe('diffReleases (F1844)', () => {
  it('detects changed files and added/removed knots', () => {
    const diff = diffReleases(v1, v2);
    expect(diff.changedFiles).toEqual(['main.fable']);
    expect(diff.addedKnots).toEqual(['cave']);
    expect(diff.removedKnots).toEqual([]);
  });
});

describe('generateChangelog (F1842)', () => {
  it('renders a markdown changelog', () => {
    const md = generateChangelog(diffReleases(v1, v2), 'v1', 'v2');
    expect(md).toContain('# Changes from v1 to v2');
    expect(md).toContain('New knots');
    expect(md).toContain('- cave');
  });

  it('says "No changes" for identical snapshots', () => {
    expect(generateChangelog(diffReleases(v1, v1), 'v1', 'v1')).toContain('No changes.');
  });
});

describe('saveCompat (F1843)', () => {
  it('is compatible when no knot is removed', () => {
    expect(saveCompat(v1, v2).compatible).toBe(true);
  });

  it('flags removed knots that break saves', () => {
    const removed = { 'main.fable': '=== intro ===\nHi.\n-> END\n' };
    const compat = saveCompat(v1, removed);
    expect(compat.compatible).toBe(false);
    expect(compat.removedKnots).toContain('forest');
  });
});
