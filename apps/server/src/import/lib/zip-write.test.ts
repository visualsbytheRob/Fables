/**
 * ZIP writer tests — valid CRC + reader round-trip (the writer's output must be
 * accepted by real unzip tools, so the CRC and structure must be correct).
 */

import { describe, expect, it } from 'vitest';
import { writeZip, crc32 } from './zip-write.js';
import { readZip } from './zip.js';

describe('writeZip', () => {
  it('produces an archive the reader round-trips', () => {
    const zip = writeZip([
      { name: 'a/b.txt', data: Buffer.from('hello') },
      { name: 'c.md', data: Buffer.from('# title\n\nbody') },
    ]);
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['a/b.txt', 'c.md']);
    expect(entries[0]!.data.toString()).toBe('hello');
    expect(entries[1]!.data.toString()).toContain('# title');
  });

  it('computes a stable CRC-32', () => {
    // Known CRC-32 of "123456789" is 0xCBF43926.
    expect(crc32(Buffer.from('123456789')).toString(16)).toBe('cbf43926');
  });
});
