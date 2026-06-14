/**
 * ZIP reader tests — stored + deflate entries, directory entries, and the
 * not-a-zip guard. Builds archives in-process so there's no binary fixture.
 */

import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readZip } from './zip.js';

interface Entry {
  name: string;
  data: Buffer;
  deflate?: boolean;
}

/** Minimal ZIP writer (CRC left 0 — the reader doesn't validate it). */
function writeZip(entries: Entry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const method = e.deflate ? 8 : 0;
    const stored = e.deflate ? zlib.deflateRawSync(e.data) : e.data;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14); // crc
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(Buffer.concat([local, name, stored]));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0, 16); // crc
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));

    offset += 30 + name.length + stored.length;
  }

  const localBlock = Buffer.concat(locals);
  const centralBlock = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBlock.length, 12);
  eocd.writeUInt32LE(localBlock.length, 16);
  return Buffer.concat([localBlock, centralBlock, eocd]);
}

describe('readZip', () => {
  it('reads stored + deflate entries', () => {
    const zip = writeZip([
      { name: 'a.txt', data: Buffer.from('hello stored') },
      { name: 'b.txt', data: Buffer.from('hello deflate, '.repeat(20)), deflate: true },
    ]);
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'b.txt']);
    expect(entries[0]!.data.toString()).toBe('hello stored');
    expect(entries[1]!.data.toString()).toBe('hello deflate, '.repeat(20));
  });

  it('marks directory entries', () => {
    const zip = writeZip([{ name: 'folder/', data: Buffer.alloc(0) }]);
    expect(readZip(zip)[0]!.isDirectory).toBe(true);
  });

  it('throws on a non-zip buffer', () => {
    expect(() => readZip(Buffer.from('not a zip at all'))).toThrow(/not a zip/);
  });
});
