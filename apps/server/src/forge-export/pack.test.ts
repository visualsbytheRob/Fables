/**
 * Tests for .fable.bin pack/unpack (F582, F584).
 */

import { describe, expect, it } from 'vitest';

import { FableBinError, crc32, packFableBin, unpackFableBin, validateFableBin } from './pack.js';

// ---------------------------------------------------------------------------
// Minimal valid story source
// ---------------------------------------------------------------------------

const HELLO_SOURCE = 'A fox trotted through the quiet wood.';
const META = { title: 'Hello Story', author: 'Test Author', createdAt: '2026-01-01T00:00:00.000Z' };

// ---------------------------------------------------------------------------
// CRC-32 tests
// ---------------------------------------------------------------------------

describe('crc32', () => {
  it('returns a number in [0, 2^32)', () => {
    const val = crc32(new Uint8Array([1, 2, 3]));
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThan(2 ** 32);
  });

  it('is deterministic', () => {
    const a = crc32(new Uint8Array([10, 20, 30, 40]));
    const b = crc32(new Uint8Array([10, 20, 30, 40]));
    expect(a).toBe(b);
  });

  it('known value: empty bytes has canonical CRC32 0x00000000', () => {
    // CRC32 of empty = 0x00000000
    expect(crc32(new Uint8Array([]))).toBe(0x00000000);
  });

  it('known value: CRC32 of [0x31..0x39] = 0xCBF43926', () => {
    // Standard test vector: "123456789"
    const bytes = new Uint8Array([0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39]);
    expect(crc32(bytes)).toBe(0xcbf43926);
  });

  it('changes when a byte changes', () => {
    const a = crc32(new Uint8Array([1, 2, 3]));
    const b = crc32(new Uint8Array([1, 2, 4]));
    expect(a).not.toBe(b);
  });

  it('respects start/end parameters', () => {
    const bytes = new Uint8Array([
      0xff, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0xff,
    ]);
    const slice = bytes.subarray(1, 10);
    expect(crc32(bytes, 1, 10)).toBe(crc32(slice));
  });
});

// ---------------------------------------------------------------------------
// packFableBin / unpackFableBin round-trip
// ---------------------------------------------------------------------------

describe('packFableBin', () => {
  it('returns a Uint8Array', () => {
    const bin = packFableBin(HELLO_SOURCE, META);
    expect(bin).toBeInstanceOf(Uint8Array);
    expect(bin.length).toBeGreaterThan(0);
  });

  it('starts with FABLEBIN magic bytes', () => {
    const bin = packFableBin(HELLO_SOURCE, META);
    const magic = [0x46, 0x41, 0x42, 0x4c, 0x45, 0x42, 0x49, 0x4e];
    for (let i = 0; i < magic.length; i++) {
      expect(bin[i]).toBe(magic[i]);
    }
  });

  it('is deterministic for same inputs', () => {
    const a = packFableBin(HELLO_SOURCE, META);
    const b = packFableBin(HELLO_SOURCE, META);
    expect(a).toEqual(b);
  });

  it('produces different output for different titles', () => {
    const a = packFableBin(HELLO_SOURCE, { ...META, title: 'Title A' });
    const b = packFableBin(HELLO_SOURCE, { ...META, title: 'Title B' });
    expect(a).not.toEqual(b);
  });

  it('throws FableBinError with COMPILE_ERROR for invalid source', () => {
    expect(() => packFableBin('-> nonexistent_knot_xyz', META)).toThrow(FableBinError);
    try {
      packFableBin('-> nonexistent_knot_xyz', META);
    } catch (e) {
      expect(e).toBeInstanceOf(FableBinError);
      expect((e as FableBinError).code).toBe('COMPILE_ERROR');
    }
  });

  it('works without optional author/createdAt', () => {
    const bin = packFableBin(HELLO_SOURCE, { title: 'Minimal' });
    expect(bin).toBeInstanceOf(Uint8Array);
    const result = unpackFableBin(bin);
    expect(result.meta.title).toBe('Minimal');
    expect(result.meta.author).toBeUndefined();
  });
});

describe('unpackFableBin round-trip', () => {
  it('recovers metadata exactly', () => {
    const bin = packFableBin(HELLO_SOURCE, META);
    const { meta } = unpackFableBin(bin);
    expect(meta.title).toBe(META.title);
    expect(meta.author).toBe(META.author);
    expect(meta.createdAt).toBe(META.createdAt);
  });

  it('recovers a valid program', () => {
    const bin = packFableBin(HELLO_SOURCE, META);
    const { program } = unpackFableBin(bin);
    expect(program).toBeDefined();
    expect(typeof program.version).toBe('number');
    expect(Array.isArray(program.containers)).toBe(true);
  });

  it('returns a fingerprint that matches the stored fingerprint', () => {
    const bin = packFableBin(HELLO_SOURCE, META);
    const { meta, fingerprint } = unpackFableBin(bin);
    expect(fingerprint).toBe(meta.fingerprint);
  });
});

// ---------------------------------------------------------------------------
// validateFableBin error cases
// ---------------------------------------------------------------------------

describe('validateFableBin', () => {
  it('returns ok:true for valid bin', () => {
    const bin = packFableBin(HELLO_SOURCE, META);
    const result = validateFableBin(bin);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta.title).toBe(META.title);
    }
  });

  it('returns ok:false for empty buffer', () => {
    const result = validateFableBin(new Uint8Array(0));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeTruthy();
    }
  });

  it('returns ok:false for bad magic bytes', () => {
    const bin = packFableBin(HELLO_SOURCE, META);
    const corrupted = new Uint8Array(bin);
    corrupted[0] = 0xff;
    const result = validateFableBin(corrupted);
    expect(result.ok).toBe(false);
  });

  it('returns ok:false for truncated buffer', () => {
    const bin = packFableBin(HELLO_SOURCE, META);
    const truncated = bin.subarray(0, 20);
    const result = validateFableBin(truncated);
    expect(result.ok).toBe(false);
  });

  it('returns ok:false for corrupted checksum (byte flipped in body)', () => {
    const bin = packFableBin(HELLO_SOURCE, META);
    const corrupted = new Uint8Array(bin);
    // Flip a byte in the middle of the payload (after the header)
    const midIdx = Math.floor(corrupted.length / 2);
    corrupted[midIdx] = (corrupted[midIdx] ?? 0) ^ 0xff;
    const result = validateFableBin(corrupted);
    expect(result.ok).toBe(false);
  });

  it('returns ok:false for wrong version', () => {
    const bin = packFableBin(HELLO_SOURCE, META);
    const corrupted = new Uint8Array(bin);
    // Version is at offset 8 (after 8-byte magic)
    const view = new DataView(corrupted.buffer, corrupted.byteOffset, corrupted.byteLength);
    view.setUint16(8, 99, true);
    const result = validateFableBin(corrupted);
    expect(result.ok).toBe(false);
  });

  it('never throws — always returns a result object', () => {
    const garbage = new Uint8Array(100).fill(0xde);
    expect(() => validateFableBin(garbage)).not.toThrow();
    const result = validateFableBin(garbage);
    expect(typeof result.ok).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// unpackFableBin error classes
// ---------------------------------------------------------------------------

describe('unpackFableBin error handling', () => {
  it('throws FableBinError on bad magic', () => {
    const bad = new Uint8Array(50).fill(0x41); // "AAAAAA..."
    expect(() => unpackFableBin(bad)).toThrow(FableBinError);
  });

  it('has the BAD_MAGIC code on bad magic', () => {
    const bad = new Uint8Array(50).fill(0x41);
    try {
      unpackFableBin(bad);
    } catch (e) {
      expect(e).toBeInstanceOf(FableBinError);
      expect((e as FableBinError).code).toBe('BAD_MAGIC');
    }
  });

  it('has the TRUNCATED code on too-short buffer', () => {
    try {
      unpackFableBin(new Uint8Array(5));
    } catch (e) {
      expect(e).toBeInstanceOf(FableBinError);
      expect((e as FableBinError).code).toBe('TRUNCATED');
    }
  });

  it('has the BAD_CHECKSUM code on corrupted data', () => {
    const bin = packFableBin(HELLO_SOURCE, META);
    const corrupted = new Uint8Array(bin);
    // Corrupt the trailing CRC itself
    const lastIdx = corrupted.length - 1;
    corrupted[lastIdx] = (corrupted[lastIdx] ?? 0) ^ 0x01;
    try {
      unpackFableBin(corrupted);
    } catch (e) {
      expect(e).toBeInstanceOf(FableBinError);
      expect((e as FableBinError).code).toBe('BAD_CHECKSUM');
    }
  });
});
