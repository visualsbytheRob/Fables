/**
 * Changelog generator tests (F995).
 */

import { describe, expect, it } from 'vitest';
import { groupCommits, parseCommit, renderChangelog } from './changelog.js';

describe('parseCommit', () => {
  it('parses type, scope and subject', () => {
    expect(parseCommit('feat(epic-20): add webhooks')).toEqual({
      type: 'feat',
      scope: 'epic-20',
      subject: 'add webhooks',
      breaking: false,
    });
  });

  it('detects a breaking-change marker', () => {
    expect(parseCommit('feat!: drop legacy API')?.breaking).toBe(true);
  });

  it('returns null for non-conventional subjects', () => {
    expect(parseCommit('merge branch main')).toBeNull();
  });
});

describe('groupCommits', () => {
  it('groups by type in a stable order and counts skipped', () => {
    const grouped = groupCommits([
      'feat(a): one',
      'fix: two',
      'feat: three',
      'chore: four',
      'not a commit',
    ]);
    expect(grouped.sections.map((s) => s.type)).toEqual(['feat', 'fix', 'chore']);
    expect(grouped.sections[0]?.entries).toHaveLength(2);
    expect(grouped.skipped).toBe(1);
  });

  it('collects breaking changes separately', () => {
    const grouped = groupCommits(['feat!: big change', 'fix: small']);
    expect(grouped.breaking).toHaveLength(1);
  });
});

describe('renderChangelog', () => {
  it('renders grouped markdown under a version heading', () => {
    const md = renderChangelog('v2.1.0', ['feat(forge): forge run CLI', 'fix: typo']);
    expect(md).toContain('## v2.1.0');
    expect(md).toContain('### Features');
    expect(md).toContain('**forge:** forge run CLI');
    expect(md).toContain('### Bug Fixes');
  });

  it('surfaces a breaking-changes section first', () => {
    const md = renderChangelog('v3.0.0', ['feat!: rewrite', 'feat: extra']);
    expect(md.indexOf('BREAKING CHANGES')).toBeLessThan(md.indexOf('### Features'));
  });
});
