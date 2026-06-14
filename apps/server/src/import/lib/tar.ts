/**
 * Minimal tar reader (ustar) — for Joplin `.jex` exports, which are tarballs.
 *
 * Reads 512-byte ustar headers + data blocks. No compression (JEX is an
 * uncompressed tar), no PAX extensions beyond long-name handling via the basic
 * `prefix` field. Scope is deliberately small and dependency-free.
 */

export interface TarEntry {
  name: string;
  data: Buffer;
  isFile: boolean;
}

const BLOCK = 512;

/** Parse an uncompressed tar archive buffer into its file entries. */
export function readTar(buf: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset + BLOCK <= buf.length) {
    const header = buf.subarray(offset, offset + BLOCK);
    // Two consecutive zero blocks mark the end of the archive.
    if (header.every((b) => b === 0)) break;

    const name = cstr(header, 0, 100);
    const prefix = cstr(header, 345, 155);
    const size = parseOctal(header, 124, 12);
    const typeflag = String.fromCharCode(header[156] ?? 0);
    const fullName = prefix ? `${prefix}/${name}` : name;

    const dataStart = offset + BLOCK;
    const data = buf.subarray(dataStart, dataStart + size);

    // typeflag '0' or '\0' = regular file; '5' = directory; others skipped.
    const isFile = typeflag === '0' || typeflag === '\0';
    if (fullName && (isFile || typeflag === '5')) {
      entries.push({ name: fullName, data: Buffer.from(data), isFile });
    }

    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;
  }

  return entries;
}

function cstr(buf: Buffer, start: number, len: number): string {
  const slice = buf.subarray(start, start + len);
  const end = slice.indexOf(0);
  return slice.toString('utf8', 0, end === -1 ? slice.length : end).trim();
}

function parseOctal(buf: Buffer, start: number, len: number): number {
  const s = cstr(buf, start, len).replace(/[^0-7]/g, '');
  return s === '' ? 0 : parseInt(s, 8);
}
