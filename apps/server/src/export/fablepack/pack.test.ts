/**
 * .fablepack format conformance tests (F1801/F1802/F1808/F1810).
 */

import { describe, expect, it } from 'vitest';
import { packFable, unpackFable, validatePack, type PackInput } from './pack.js';

const base: PackInput = {
  story: { id: 'story1', title: 'The Tale', description: 'A test fable.' },
  release: 'v1',
  source: { 'main.fable': '=== intro ===\nHello.\n-> END\n' },
  casting: { narrator: { voiceId: 'amy' } },
  assets: { 'cover.txt': new TextEncoder().encode('cover bytes') },
  capabilities: ['audio'],
  contentWarnings: ['none'],
};

describe('pack / unpack round-trip (F1801/F1803)', () => {
  it('preserves source, casting, assets, and manifest', () => {
    const buf = packFable(base);
    const out = unpackFable(buf);
    expect(out.manifest.story.title).toBe('The Tale');
    expect(out.manifest.capabilities).toEqual(['audio']);
    expect(out.source['main.fable']).toContain('Hello.');
    expect(out.casting).toEqual({ narrator: { voiceId: 'amy' } });
    expect(out.assets['cover.txt']!.toString('utf8')).toBe('cover bytes');
  });
});

describe('deterministic packing (F1802)', () => {
  it('the same input produces byte-identical archives', () => {
    const a = packFable(base);
    const b = packFable(base);
    expect(a.equals(b)).toBe(true);
  });

  it('different content changes the bytes', () => {
    const a = packFable(base);
    const c = packFable({ ...base, source: { 'main.fable': 'different' } });
    expect(a.equals(c)).toBe(false);
  });
});

describe('integrity validation (F1806/F1808/F1810)', () => {
  it('a freshly packed pack validates', () => {
    const result = validatePack(packFable(base));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('detects tampering with the hash tree', () => {
    const buf = packFable(base);
    // Flip a byte well past the manifest (in the content region).
    const tampered = Buffer.from(buf);
    tampered[tampered.length - 30] = tampered[tampered.length - 30]! ^ 0xff;
    const result = validatePack(tampered);
    expect(result.valid).toBe(false);
  });

  it('rejects a non-pack buffer', () => {
    expect(validatePack(Buffer.from('not a zip')).valid).toBe(false);
  });
});

describe('signing (F1808)', () => {
  it('signs and verifies with a key', () => {
    const buf = packFable({ ...base, signingKey: 'secret' });
    const ok = validatePack(buf, 'secret');
    expect(ok.signatureValid).toBe(true);
    expect(ok.valid).toBe(true);

    const wrong = validatePack(buf, 'wrong-key');
    expect(wrong.signatureValid).toBe(false);
    expect(wrong.valid).toBe(false);
  });
});
