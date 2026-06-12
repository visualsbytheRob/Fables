import {
  codeRanges,
  fencedRanges,
  formatWikilink,
  parseWikilinks,
  rewriteWikilinkTargets,
} from '@fables/core';
import { describe, expect, it } from 'vitest';

describe('parseWikilinks (F201, F210)', () => {
  it('parses a plain link with exact offsets', () => {
    const body = 'see [[Moon Base]] for details';
    const links = parseWikilinks(body);
    expect(links).toHaveLength(1);
    const link = links[0]!;
    expect(link.target).toBe('Moon Base');
    expect(link.alias).toBeNull();
    expect(link.heading).toBeNull();
    expect(link.blockId).toBeNull();
    expect(link.start).toBe(4);
    expect(link.end).toBe(17);
    expect(body.slice(link.start, link.end)).toBe('[[Moon Base]]');
  });

  it('parses multiple links in document order', () => {
    const targets = parseWikilinks('[[A1]] then [[B2]] and [[C3]]').map((l) => l.target);
    expect(targets).toEqual(['A1', 'B2', 'C3']);
  });

  it('parses aliases (F205)', () => {
    const link = parseWikilinks('[[Kira Vane|the captain]]')[0]!;
    expect(link.target).toBe('Kira Vane');
    expect(link.alias).toBe('the captain');
  });

  it('parses heading links, with and without alias (F207)', () => {
    const [a, b] = parseWikilinks('[[Ship Log#Engines]] and [[Ship Log#Crew|the crew]]');
    expect(a!.heading).toBe('Engines');
    expect(b!.heading).toBe('Crew');
    expect(b!.alias).toBe('the crew');
    expect(b!.target).toBe('Ship Log');
  });

  it('parses block links (F208)', () => {
    const link = parseWikilinks('[[Ship Log^abc123]]')[0]!;
    expect(link.target).toBe('Ship Log');
    expect(link.blockId).toBe('abc123');
    expect(link.heading).toBeNull();
  });

  it('rejects malformed block ids', () => {
    expect(parseWikilinks('[[Note^bad id]]')).toEqual([]);
    expect(parseWikilinks('[[Note^]]')).toEqual([]);
  });

  it('trims whitespace and drops empty targets', () => {
    expect(parseWikilinks('[[  Padded  ]]')[0]!.target).toBe('Padded');
    expect(parseWikilinks('[[]]')).toEqual([]);
    expect(parseWikilinks('[[   ]]')).toEqual([]);
    expect(parseWikilinks('[[|alias only]]')).toEqual([]);
    expect(parseWikilinks('[[#Heading only]]')).toEqual([]);
  });

  it('resolves nesting to the innermost link', () => {
    const links = parseWikilinks('[[outer [[Inner]] tail]]');
    expect(links).toHaveLength(1);
    expect(links[0]!.target).toBe('Inner');
  });

  it('ignores backslash-escaped links', () => {
    expect(parseWikilinks('\\[[Not A Link]]')).toEqual([]);
    const links = parseWikilinks('\\[[Escaped]] but [[Real]]');
    expect(links.map((l) => l.target)).toEqual(['Real']);
  });

  it('never spans lines', () => {
    expect(parseWikilinks('[[broken\nacross]]')).toEqual([]);
  });

  it('skips fenced code blocks and inline code', () => {
    const body = 'live [[Yes]]\n```\n[[Fenced]]\n```\nand `[[Inline]]` code';
    expect(parseWikilinks(body).map((l) => l.target)).toEqual(['Yes']);
  });

  it('treats an unclosed fence as covering the rest of the body', () => {
    expect(parseWikilinks('```\n[[Hidden]]')).toEqual([]);
  });

  it('handles ~~~ fences and mixed fence characters', () => {
    const body = '~~~\n[[Tilde]]\n~~~\n[[After]]';
    expect(parseWikilinks(body).map((l) => l.target)).toEqual(['After']);
  });

  it('is unicode-safe, with UTF-16 offsets (F210)', () => {
    const body = '🚀🚀 [[Café Notes]] / [[星図|star chart]]';
    const [a, b] = parseWikilinks(body);
    expect(a!.target).toBe('Café Notes');
    expect(body.slice(a!.start, a!.end)).toBe('[[Café Notes]]');
    expect(b!.target).toBe('星図');
    expect(b!.alias).toBe('star chart');
    expect(body.slice(b!.start, b!.end)).toBe('[[星図|star chart]]');
  });

  it('keeps raw text for every match', () => {
    expect(parseWikilinks('[[A#B|c]]')[0]!.raw).toBe('[[A#B|c]]');
  });
});

describe('formatWikilink', () => {
  it('round-trips every link shape', () => {
    for (const raw of ['[[A]]', '[[A|b]]', '[[A#H]]', '[[A#H|b]]', '[[A^x1]]', '[[A^x1|b]]']) {
      const link = parseWikilinks(raw)[0]!;
      expect(formatWikilink(link)).toBe(raw);
    }
  });
});

describe('rewriteWikilinkTargets (F209)', () => {
  it('rewrites matching targets case-insensitively, preserving parts', () => {
    const body = '[[old name]] and [[Old Name#Intro|alias]] and [[Other]]';
    expect(rewriteWikilinkTargets(body, 'Old Name', 'New Name')).toBe(
      '[[New Name]] and [[New Name#Intro|alias]] and [[Other]]',
    );
  });

  it('leaves code spans and escaped links untouched', () => {
    const body = '`[[Old]]` and \\[[Old]] stay; [[Old]] moves';
    expect(rewriteWikilinkTargets(body, 'Old', 'New')).toBe(
      '`[[Old]]` and \\[[Old]] stay; [[New]] moves',
    );
  });

  it('keeps offsets correct when the new title is longer', () => {
    const body = '[[A2]] mid [[A2]] end [[A2]]';
    expect(rewriteWikilinkTargets(body, 'A2', 'A Much Longer Title')).toBe(
      '[[A Much Longer Title]] mid [[A Much Longer Title]] end [[A Much Longer Title]]',
    );
  });
});

describe('code ranges', () => {
  it('reports fenced blocks including fence lines', () => {
    const body = 'a\n```\ncode\n```\nb';
    const [range] = fencedRanges(body);
    expect(body.slice(range!.start, range!.end)).toBe('```\ncode\n```');
  });

  it('merges fenced and inline ranges in order', () => {
    const body = '`x` then\n```\ny\n```';
    const ranges = codeRanges(body);
    expect(ranges).toHaveLength(2);
    expect(ranges[0]!.start).toBeLessThan(ranges[1]!.start);
  });

  it('matches inline code only on equal backtick runs', () => {
    const body = '``a `b` c`` and [[Live]]';
    expect(parseWikilinks(body).map((l) => l.target)).toEqual(['Live']);
  });
});
