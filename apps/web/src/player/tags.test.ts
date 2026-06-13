/** Player tag vocabulary tests (F546/F547/F555–F557). */
import { describe, expect, it } from 'vitest';
import { classifyTags, parseSegments, parseStatTags, sceneHue, slugify } from './tags.js';

describe('parseStatTags (F546)', () => {
  it('parses header stat tags with optional maxima', () => {
    const source = `# title: T
# stat: health / 20
# stat: gold

-> start
=== start ===
Hi. # stat: notAHeaderLineMatchesAnyway?
-> END
`;
    expect(parseStatTags(source)).toEqual([
      { name: 'health', max: 20 },
      { name: 'gold', max: null },
    ]);
  });

  it('dedupes and ignores malformed entries', () => {
    expect(parseStatTags('# stat: hp\n# stat: hp\n# stat: 9bad\n# stat:\n')).toEqual([
      { name: 'hp', max: null },
    ]);
  });
});

describe('classifyTags (F555–F557)', () => {
  it('extracts scene, chapter, ending and effects', () => {
    const result = classifyTags(['scene: Forest', 'chapter: One', 'ending: good', 'shake', 'whisper']);
    expect(result.scene).toBe('forest');
    expect(result.chapter).toBe('One');
    expect(result.ending).toBe('good');
    expect(result.effects).toEqual(['shake', 'whisper']);
  });

  it('ignores unknown tags and handles undefined', () => {
    expect(classifyTags(['mood: sleepy', 'loud'])).toEqual({
      scene: null,
      chapter: null,
      ending: null,
      effects: [],
    });
    expect(classifyTags(undefined).effects).toEqual([]);
  });
});

describe('parseSegments (F547)', () => {
  it('splits prose around inline attachment images', () => {
    const segments = parseSegments('Before ![a map](/api/v1/attachments/abc) after.');
    expect(segments).toEqual([
      { kind: 'text', text: 'Before ' },
      { kind: 'image', alt: 'a map', src: '/api/v1/attachments/abc' },
      { kind: 'text', text: ' after.' },
    ]);
  });

  it('returns a single text segment when there is no image', () => {
    expect(parseSegments('Plain text.')).toEqual([{ kind: 'text', text: 'Plain text.' }]);
    expect(parseSegments('')).toEqual([{ kind: 'text', text: '' }]);
  });
});

describe('sceneHue (F555)', () => {
  it('maps known scenes to curated hues and hashes unknown ones stably', () => {
    expect(sceneHue('forest')).toBe(140);
    expect(sceneHue(null)).toBeNull();
    const odd = sceneHue('the-undercroft');
    expect(odd).toBe(sceneHue('the-undercroft'));
    expect(odd).toBeGreaterThanOrEqual(0);
    expect(odd).toBeLessThan(360);
  });
});

describe('slugify', () => {
  it('produces stable kebab ids', () => {
    expect(slugify('The Good Ending!')).toBe('the-good-ending');
    expect(slugify('***')).toBe('untitled');
  });
});
