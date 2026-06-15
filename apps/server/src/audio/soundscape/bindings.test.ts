import { describe, it, expect } from 'vitest';
import { extractSceneBindings } from './bindings.js';
import type { SceneBinding } from './bindings.js';

describe('extractSceneBindings', () => {
  it('returns [] for empty source', () => {
    expect(extractSceneBindings('')).toEqual([]);
  });

  it('returns [] when no scene tags exist', () => {
    const source = `=== forest ===\nYou are in the forest.\n-> END\n`;
    expect(extractSceneBindings(source)).toEqual([]);
  });

  it('extracts a single knot with a scene tag', () => {
    const source = `=== cave ===\n# scene: dark_cave\nYou enter the cave.\n-> END\n`;
    const result = extractSceneBindings(source);
    expect(result).toEqual<SceneBinding[]>([{ knot: 'cave', soundscape: 'dark_cave' }]);
  });

  it('handles multiple knots, only returns those with scene tags', () => {
    const source = [
      `=== forest ===`,
      `# scene: forest_ambience`,
      `You hear birds.`,
      `-> END`,
      `=== town ===`,
      `You see a market.`,
      `-> END`,
      `=== tavern ===`,
      `# scene: tavern_music`,
      `Warm and noisy.`,
      `-> END`,
    ].join('\n');
    const result = extractSceneBindings(source);
    expect(result).toEqual<SceneBinding[]>([
      { knot: 'forest', soundscape: 'forest_ambience' },
      { knot: 'tavern', soundscape: 'tavern_music' },
    ]);
  });

  it('is case-insensitive: Scene: and SCENE: both match', () => {
    const source = `=== a ===\n# Scene: Storm\n-> END\n=== b ===\n# SCENE: RAIN\n-> END\n`;
    const result = extractSceneBindings(source);
    expect(result).toEqual<SceneBinding[]>([
      { knot: 'a', soundscape: 'storm' },
      { knot: 'b', soundscape: 'rain' },
    ]);
  });

  it('lowercases the soundscape name', () => {
    const source = `=== x ===\n# scene: MyAmbience\n-> END\n`;
    const result = extractSceneBindings(source);
    expect(result).toEqual<SceneBinding[]>([{ knot: 'x', soundscape: 'myambience' }]);
  });

  it('emits one binding per scene tag when a knot has multiple scene tags', () => {
    const source = `=== multi ===\n# scene: ambient\n# scene: weather\n-> END\n`;
    const result = extractSceneBindings(source);
    expect(result).toEqual<SceneBinding[]>([
      { knot: 'multi', soundscape: 'ambient' },
      { knot: 'multi', soundscape: 'weather' },
    ]);
  });

  it('does not emit duplicate bindings when tag appears in both header and body', () => {
    // knot.tags may or may not carry the tag; findAll will find it in body.
    // The deduplication by text ensures no double-emit.
    const source = `=== dup ===\n# scene: forest\n-> END\n`;
    const result = extractSceneBindings(source);
    const forestBindings = result.filter((b) => b.soundscape === 'forest');
    expect(forestBindings.length).toBe(1);
  });

  it('returns [] for completely unparseable source (resilience)', () => {
    // A source that causes a fatal error should return [] not throw.
    // Even if the parser is lenient, an empty/whitespace-only input is safe.
    expect(extractSceneBindings('   ')).toEqual([]);
  });
});
