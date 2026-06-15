/**
 * Story archive tests (F1881/F1885/F1886/F1884).
 */

import { describe, expect, it } from 'vitest';
import { buildArchive, verifyArchive, preservationChecklist } from './archive.js';
import { packFable } from '../fablepack/pack.js';

function samplePack(id: string, withAudio = false) {
  return packFable({
    story: { id, title: `Story ${id}`, description: 'desc' },
    source: { 'main.fable': '=== intro ===\nHi.\n-> END\n' },
    casting: { narrator: { voiceId: 'amy' } },
    ...(withAudio
      ? { capabilities: ['audio'] as const, assets: { 'line.ogg': new Uint8Array([1, 2, 3]) } }
      : {}),
  });
}

describe('buildArchive + verifyArchive (F1881/F1885/F1886)', () => {
  it('bundles packs and verifies fixity', () => {
    const archive = buildArchive({
      packs: [
        { name: 'a.fablepack', bytes: samplePack('a') },
        { name: 'b.fablepack', bytes: samplePack('b') },
      ],
    });
    const result = verifyArchive(archive);
    expect(result.valid).toBe(true);
    expect(result.packs).toHaveLength(2);
    expect(result.version).toBe(1);
  });

  it('is deterministic', () => {
    const packs = [{ name: 'a.fablepack', bytes: samplePack('a') }];
    expect(buildArchive({ packs }).equals(buildArchive({ packs }))).toBe(true);
  });

  it('detects fixity tampering', () => {
    const archive = buildArchive({ packs: [{ name: 'a.fablepack', bytes: samplePack('a') }] });
    const tampered = Buffer.from(archive);
    tampered[tampered.length - 25] = tampered[tampered.length - 25]! ^ 0xff;
    expect(verifyArchive(tampered).valid).toBe(false);
  });

  it('rejects a non-archive', () => {
    expect(verifyArchive(Buffer.from('nope')).valid).toBe(false);
  });
});

describe('preservationChecklist (F1884)', () => {
  it('flags missing audio assets when audio is declared', () => {
    // A pack declaring audio but with no audio assets fails that check.
    const noAudioAssets = packFable({
      story: { id: 's', title: 'S', description: '' },
      source: { 'main.fable': '=== a ===\n-> END\n' },
      capabilities: ['audio'],
    });
    const checklist = preservationChecklist(noAudioAssets);
    const audioItem = checklist.find((c) => c.item === 'audio assets')!;
    expect(audioItem.present).toBe(false);

    // A pack with audio assets passes.
    const withAudio = samplePack('s2', true);
    const ok = preservationChecklist(withAudio).find((c) => c.item === 'audio assets')!;
    expect(ok.present).toBe(true);
  });

  it('confirms source + fixity are present', () => {
    const checklist = preservationChecklist(samplePack('s'));
    expect(checklist.find((c) => c.item === 'story source')!.present).toBe(true);
    expect(checklist.find((c) => c.item === 'fixity hashes')!.present).toBe(true);
  });
});
