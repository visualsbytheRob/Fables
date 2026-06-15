/**
 * CC0 sound library tests (F1634).
 */

import { describe, expect, it } from 'vitest';
import { SOUND_LIBRARY, attributionManifest, findSound, soundsOfKind } from './library.js';

describe('SOUND_LIBRARY (F1634)', () => {
  it('every entry is CC0 with a source and unique id', () => {
    const ids = new Set<string>();
    for (const s of SOUND_LIBRARY) {
      expect(s.license).toBe('CC0');
      expect(s.source.length).toBeGreaterThan(0);
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
    }
  });

  it('looks up by id and filters by kind', () => {
    expect(findSound('storm')?.kind).toBe('ambient');
    expect(findSound('door')?.kind).toBe('oneshot');
    expect(findSound('nope')).toBeUndefined();
    expect(soundsOfKind('ambient').every((s) => s.kind === 'ambient')).toBe(true);
    expect(soundsOfKind('oneshot').length).toBeGreaterThan(0);
  });

  it('attribution manifest covers the whole library', () => {
    const manifest = attributionManifest();
    expect(manifest).toHaveLength(SOUND_LIBRARY.length);
    expect(manifest.every((m) => m.license === 'CC0')).toBe(true);
  });
});
