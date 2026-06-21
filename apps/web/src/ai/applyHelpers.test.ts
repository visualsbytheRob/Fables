import { describe, expect, it } from 'vitest';
import {
  applyLinks,
  applyStructure,
  applySummary,
  applyTags,
  existingTags,
  linksFooter,
  prependBlock,
  structureToMarkdown,
  toTagToken,
} from './applyHelpers.js';

describe('prependBlock', () => {
  it('prepends a titled block above existing content', () => {
    expect(prependBlock('Body here', 'Summary', 'A short summary.')).toBe(
      '## Summary\n\nA short summary.\n\nBody here\n',
    );
  });

  it('omits the gap when the body is empty', () => {
    expect(prependBlock('   ', 'Outline', '- one\n- two')).toBe('## Outline\n\n- one\n- two\n');
  });
});

describe('applySummary / applyOutline', () => {
  it('inserts a Summary heading', () => {
    expect(applySummary('Note', 'It is about cats.')).toContain('## Summary\n\nIt is about cats.');
  });
});

describe('tag tokens', () => {
  it('normalises free text into a hashtag slug', () => {
    expect(toTagToken('  #Machine Learning ')).toBe('machine-learning');
    expect(toTagToken('AI/ML')).toBe('ai-ml');
    expect(toTagToken('###')).toBe('');
  });

  it('reads existing hashtags from a body', () => {
    expect([...existingTags('hello #foo and #Bar-baz')].sort()).toEqual(['bar-baz', 'foo']);
  });
});

describe('applyTags', () => {
  it('appends only new, normalised tags', () => {
    const out = applyTags('Body #foo', ['Foo', 'New Tag', 'new tag']);
    expect(out).toBe('Body #foo\n\n#new-tag\n');
  });

  it('returns the body unchanged when nothing new', () => {
    expect(applyTags('Body #foo', ['foo'])).toBe('Body #foo');
  });

  it('handles an empty body', () => {
    expect(applyTags('', ['Alpha', 'Beta'])).toBe('#alpha #beta\n');
  });
});

describe('structureToMarkdown', () => {
  it('renders summary, decisions, and checkbox actions with owners', () => {
    const md = structureToMarkdown({
      summary: 'We met.',
      decisions: ['Ship it'],
      actions: [
        { task: 'Write docs', owner: 'Rob' },
        { task: 'Review', owner: '' },
      ],
    });
    expect(md).toContain('## Summary\n\nWe met.');
    expect(md).toContain('## Decisions\n\n- Ship it');
    expect(md).toContain('- [ ] Write docs — Rob');
    expect(md).toContain('- [ ] Review');
    expect(md).not.toContain('Review —');
  });

  it('drops empty sections', () => {
    const md = structureToMarkdown({ summary: 'Solo.', decisions: [], actions: [] });
    expect(md).toBe('## Summary\n\nSolo.');
  });
});

describe('applyStructure', () => {
  it('prepends the structured block', () => {
    const out = applyStructure('Raw notes', { summary: 'S', decisions: [], actions: [] });
    expect(out).toBe('## Summary\n\nS\n\nRaw notes\n');
  });
});

describe('links', () => {
  it('builds a deduped related footer', () => {
    expect(
      linksFooter([
        { phrase: 'a', target: 'Alpha', targetId: '1' },
        { phrase: 'b', target: 'alpha', targetId: '1' },
        { phrase: 'c', target: 'Beta', targetId: '2' },
      ]),
    ).toBe('**Related:** [[Alpha]] · [[Beta]]');
  });

  it('appends the footer, or no-ops when empty', () => {
    expect(applyLinks('Body', [{ phrase: 'x', target: 'Beta', targetId: '2' }])).toBe(
      'Body\n\n**Related:** [[Beta]]\n',
    );
    expect(applyLinks('Body', [])).toBe('Body');
  });
});
