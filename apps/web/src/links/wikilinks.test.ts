import { describe, expect, it } from 'vitest';
import {
  buildTitleIndex,
  decodeWikilinkHref,
  parseWikilinks,
  preprocessWikilinks,
  resolveTitle,
  wikilinkAt,
  wikilinkHref,
} from './wikilinks.js';

describe('parseWikilinks (client mirror of the server grammar)', () => {
  it('parses plain, alias, heading, and block links', () => {
    const body = 'See [[Alpha]], [[Beta|the B note]], [[Gamma#Intro]], [[Delta^abc-1]].';
    const links = parseWikilinks(body);
    expect(links.map((l) => l.target)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta']);
    expect(links[1]!.alias).toBe('the B note');
    expect(links[2]!.heading).toBe('Intro');
    expect(links[3]!.blockId).toBe('abc-1');
  });

  it('skips escaped links and code spans', () => {
    const body = '\\[[escaped]] and `[[inline]]`\n```\n[[fenced]]\n```\n[[real]]';
    expect(parseWikilinks(body).map((l) => l.target)).toEqual(['real']);
  });

  it('records offsets usable for hit-testing', () => {
    const body = 'ab [[Target]] cd';
    const link = parseWikilinks(body)[0]!;
    expect(body.slice(link.start, link.end)).toBe('[[Target]]');
    expect(wikilinkAt(body, link.start + 3)?.target).toBe('Target');
    expect(wikilinkAt(body, 0)).toBeNull();
  });
});

describe('preprocessWikilinks', () => {
  it('rewrites links to #wikilink= markdown links with display labels', () => {
    const out = preprocessWikilinks('go to [[My Note|here]] now');
    expect(out).toBe('go to [here](#wikilink=My%20Note%7Chere) now');
  });

  it('keeps line counts identical for task line mapping', () => {
    const src = '- [ ] task\n[[A]]\ntext';
    expect(preprocessWikilinks(src).split('\n').length).toBe(src.split('\n').length);
  });

  it('round-trips through the href decode', () => {
    const out = preprocessWikilinks('x [[Note#Head|alias]] y');
    const href = /\((#wikilink=[^)]+)\)/.exec(out)![1]!;
    const link = decodeWikilinkHref(href)!;
    expect(link.target).toBe('Note');
    expect(link.heading).toBe('Head');
    expect(link.alias).toBe('alias');
  });

  it('leaves text without links untouched', () => {
    expect(preprocessWikilinks('plain text')).toBe('plain text');
  });
});

describe('title resolution', () => {
  it('resolves case-insensitively, first title wins', () => {
    const index = buildTitleIndex([
      { id: 'n1', title: 'My Note' },
      { id: 'n2', title: 'my note' },
      { id: 'n3', title: '' },
    ]);
    expect(resolveTitle(index, 'MY NOTE')).toBe('n1');
    expect(resolveTitle(index, '  my note ')).toBe('n1');
    expect(resolveTitle(index, 'missing')).toBeNull();
  });

  it('href encoding survives unicode targets', () => {
    const link = parseWikilinks('[[Über Note]]')[0]!;
    expect(decodeWikilinkHref(wikilinkHref(link))!.target).toBe('Über Note');
  });
});
