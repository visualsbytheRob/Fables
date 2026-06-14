/**
 * Minimal ZIP reader (shared by archive-based importers, e.g. Notion .zip).
 *
 * Reads the central directory and inflates each entry — supporting the two
 * methods real-world exports use: stored (0) and deflate (8), via Node's built-in
 * zlib. No external dependency. Scope is deliberately small: no encryption, no
 * ZIP64 (export archives from Notion/Evernote/etc. are well under 4 GB and
 * unencrypted). CRCs are not validated — we trust the local archive the user
 * pointed us at.
 */

import zlib from 'node:zlib';

export interface ZipEntry {
  /** Path within the archive, '/'-separated. */
  name: string;
  /** Decompressed bytes; directories have an empty buffer. */
  data: Buffer;
  isDirectory: boolean;
}

const EOCD_SIG = 0x06054b50;
const CDIR_SIG = 0x02014b50;

/** Parse a ZIP archive buffer into its entries. */
export function readZip(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf);
  if (eocd === -1) throw new Error('not a zip archive (no end-of-central-directory record)');

  const entryCount = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16); // central directory offset
  const entries: ZipEntry[] = [];

  for (let i = 0; i < entryCount; i += 1) {
    if (buf.readUInt32LE(ptr) !== CDIR_SIG) break;
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);

    // Local header → data offset (its name/extra lengths can differ from central).
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buf.subarray(dataStart, dataStart + compSize);

    const isDirectory = name.endsWith('/');
    let data: Buffer;
    if (isDirectory) {
      data = Buffer.alloc(0);
    } else if (method === 0) {
      data = Buffer.from(compressed);
    } else if (method === 8) {
      data = zlib.inflateRawSync(compressed);
    } else {
      throw new Error(`unsupported zip compression method ${method} for "${name}"`);
    }

    entries.push({ name, data, isDirectory });
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

/** Scan backwards for the EOCD signature (within the trailing 64 KB comment window). */
function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}
