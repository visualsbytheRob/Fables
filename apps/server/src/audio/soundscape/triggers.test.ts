import { describe, it, expect } from 'vitest';
import { extractSoundTriggers } from './triggers.js';
import type { SoundTrigger } from './triggers.js';

describe('extractSoundTriggers', () => {
  it('returns [] for empty source', () => {
    expect(extractSoundTriggers('')).toEqual([]);
  });

  it('extracts a single play() trigger', () => {
    const source = `=== door_scene ===\n~ play("door")\n-> END\n`;
    const result = extractSoundTriggers(source);
    expect(result).toEqual<SoundTrigger[]>([{ knot: 'door_scene', sound: 'door', fn: 'play' }]);
  });

  it('extracts sound() and sfx() triggers by default', () => {
    const source = `=== a ===\n~ sound("thunder")\n~ sfx("rain")\n-> END\n`;
    const result = extractSoundTriggers(source);
    expect(result).toEqual<SoundTrigger[]>([
      { knot: 'a', sound: 'thunder', fn: 'sound' },
      { knot: 'a', sound: 'rain', fn: 'sfx' },
    ]);
  });

  it('accepts custom fn list via the fns parameter', () => {
    const source = `=== b ===\n~ music("lullaby")\n~ play("ignored")\n-> END\n`;
    const result = extractSoundTriggers(source, ['music']);
    expect(result).toEqual<SoundTrigger[]>([{ knot: 'b', sound: 'lullaby', fn: 'music' }]);
  });

  it('skips calls with no string-literal first arg', () => {
    const source = `=== c ===\n~ play(myVar)\n~ play(42)\n~ play("ok")\n-> END\n`;
    const result = extractSoundTriggers(source);
    expect(result).toEqual<SoundTrigger[]>([{ knot: 'c', sound: 'ok', fn: 'play' }]);
  });

  it('skips calls with no args at all', () => {
    const source = `=== d ===\n~ play()\n-> END\n`;
    const result = extractSoundTriggers(source);
    expect(result).toEqual<SoundTrigger[]>([]);
  });

  it('ignores unknown function names', () => {
    const source = `=== e ===\n~ unknown("something")\n~ play("correct")\n-> END\n`;
    const result = extractSoundTriggers(source);
    expect(result).toEqual<SoundTrigger[]>([{ knot: 'e', sound: 'correct', fn: 'play' }]);
  });

  it('preserves source order across multiple knots', () => {
    const source = [
      `=== first ===`,
      `~ play("alpha")`,
      `~ play("beta")`,
      `-> END`,
      `=== second ===`,
      `~ sfx("gamma")`,
      `-> END`,
    ].join('\n');
    const result = extractSoundTriggers(source);
    expect(result).toEqual<SoundTrigger[]>([
      { knot: 'first', sound: 'alpha', fn: 'play' },
      { knot: 'first', sound: 'beta', fn: 'play' },
      { knot: 'second', sound: 'gamma', fn: 'sfx' },
    ]);
  });

  it('returns [] for whitespace-only source (resilience)', () => {
    expect(extractSoundTriggers('   ')).toEqual([]);
  });
});
