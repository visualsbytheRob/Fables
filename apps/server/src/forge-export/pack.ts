/**
 * Forge story portability — .fable.bin container pack/unpack (F582, F584).
 *
 * Binary layout of a .fable.bin:
 *   [0..7]   Magic: ASCII "FABLEBIN" (8 bytes)
 *   [8..9]   uint16 LE: format version (current = 1)
 *   [10..13] uint32 LE: JSON metadata byte length
 *   [14..]   UTF-8 JSON metadata: { title, author?, createdAt, fingerprint }
 *   [..]     Raw serialized program bytes (forge-vm bytecode)
 *   [-4..]   uint32 LE: CRC32 over everything preceding the trailing 4 bytes
 *
 * Feature coverage:
 *   F582 — packFableBin: compile source → .fable.bin container
 *   F584 — unpackFableBin: deserialize + validate; validateFableBin non-throwing
 */

import { compileStory, deserializeProgram, programFingerprint } from '@fables/forge-vm';
import type { IrProgram } from '@fables/forge-vm';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAGIC = new Uint8Array([0x46, 0x41, 0x42, 0x4c, 0x45, 0x42, 0x49, 0x4e]); // "FABLEBIN"
const FORMAT_VERSION = 1;
const MIN_CONTAINER_SIZE = MAGIC.length + 2 + 4 + 4; // magic + version + meta-len + crc32

// ---------------------------------------------------------------------------
// CRC-32 (pure, no dependencies)
// ---------------------------------------------------------------------------

/** Pre-compute CRC-32 look-up table (standard polynomial 0xEDB88320). */
const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/**
 * Compute CRC-32 over a slice of bytes.
 * Compatible with standard CRC-32 (used by zip/png etc.).
 */
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) {
    const b = bytes[i] ?? 0;
    crc = (CRC32_TABLE[(crc ^ b) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// UTF-8 helpers (keep this module free of TextEncoder/TextDecoder for portability)
// ---------------------------------------------------------------------------

function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i) ?? 0;
    if (cp > 0xffff) i++;
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

function utf8Decode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i] ?? 0;
    let cp: number;
    if (b0 < 0x80) {
      cp = b0;
      i += 1;
    } else if ((b0 & 0xe0) === 0xc0) {
      cp = ((b0 & 0x1f) << 6) | ((bytes[i + 1] ?? 0) & 0x3f);
      i += 2;
    } else if ((b0 & 0xf0) === 0xe0) {
      cp = ((b0 & 0x0f) << 12) | (((bytes[i + 1] ?? 0) & 0x3f) << 6) | ((bytes[i + 2] ?? 0) & 0x3f);
      i += 3;
    } else {
      cp =
        ((b0 & 0x07) << 18) |
        (((bytes[i + 1] ?? 0) & 0x3f) << 12) |
        (((bytes[i + 2] ?? 0) & 0x3f) << 6) |
        ((bytes[i + 3] ?? 0) & 0x3f);
      i += 4;
    }
    s += String.fromCodePoint(cp);
  }
  return s;
}

// ---------------------------------------------------------------------------
// DataView helpers
// ---------------------------------------------------------------------------

function writeUint16LE(buf: Uint8Array, offset: number, value: number): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint16(offset, value, true);
}

function writeUint32LE(buf: Uint8Array, offset: number, value: number): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(offset, value, true);
}

function readUint16LE(buf: Uint8Array, offset: number): number {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return view.getUint16(offset, true);
}

function readUint32LE(buf: Uint8Array, offset: number): number {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return view.getUint32(offset, true);
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FableBinMeta {
  title: string;
  author?: string | undefined;
  createdAt: string;
  fingerprint: string;
}

export interface UnpackResult {
  meta: FableBinMeta;
  program: IrProgram;
  fingerprint: string;
}

export type ValidateFableBinResult =
  | { ok: true; meta: FableBinMeta }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class FableBinError extends Error {
  constructor(
    public readonly code:
      | 'BAD_MAGIC'
      | 'BAD_VERSION'
      | 'TRUNCATED'
      | 'BAD_CHECKSUM'
      | 'BAD_META'
      | 'COMPILE_ERROR',
    message: string,
  ) {
    super(message);
    this.name = 'FableBinError';
  }
}

// ---------------------------------------------------------------------------
// F582 — pack
// ---------------------------------------------------------------------------

/**
 * Compile a Forge source string and wrap it in a `.fable.bin` container.
 *
 * Throws `FableBinError` with code `COMPILE_ERROR` if the source has errors.
 */
export function packFableBin(
  source: string,
  meta: { title: string; author?: string | undefined; createdAt?: string | undefined },
): Uint8Array {
  // Compile source to bytecode (throws on compile error via compileStory's assertValidIr)
  let programBytes: Uint8Array;
  try {
    programBytes = compileStory(source);
  } catch (e) {
    throw new FableBinError(
      'COMPILE_ERROR',
      `Source did not compile: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Re-deserialize to compute fingerprint
  const program = deserializeProgram(programBytes);
  const fingerprint = programFingerprint(program);

  const createdAt = meta.createdAt ?? new Date().toISOString();

  const metaObj: FableBinMeta = {
    title: meta.title,
    ...(meta.author !== undefined ? { author: meta.author } : {}),
    createdAt,
    fingerprint,
  };
  const metaJson = JSON.stringify(metaObj);
  const metaBytes = utf8Encode(metaJson);

  // Layout: magic(8) + version(2) + metaLen(4) + metaBytes + programBytes + crc32(4)
  const totalSize = MAGIC.length + 2 + 4 + metaBytes.length + programBytes.length + 4;
  const out = new Uint8Array(totalSize);

  let pos = 0;
  out.set(MAGIC, pos);
  pos += MAGIC.length;

  writeUint16LE(out, pos, FORMAT_VERSION);
  pos += 2;

  writeUint32LE(out, pos, metaBytes.length);
  pos += 4;

  out.set(metaBytes, pos);
  pos += metaBytes.length;

  out.set(programBytes, pos);
  pos += programBytes.length;

  // CRC32 over everything except the trailing 4-byte checksum
  const checkVal = crc32(out, 0, pos);
  writeUint32LE(out, pos, checkVal);

  return out;
}

// ---------------------------------------------------------------------------
// F584 — unpack + validate
// ---------------------------------------------------------------------------

/** Parse and validate a .fable.bin buffer. Throws `FableBinError` on any problem. */
export function unpackFableBin(bytes: Uint8Array): UnpackResult {
  if (bytes.length < MIN_CONTAINER_SIZE) {
    throw new FableBinError(
      'TRUNCATED',
      `Buffer too small to be a .fable.bin (${bytes.length} bytes)`,
    );
  }

  // Check magic
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) {
      throw new FableBinError('BAD_MAGIC', 'Not a .fable.bin container (magic bytes mismatch)');
    }
  }

  let pos = MAGIC.length;

  // Version
  const version = readUint16LE(bytes, pos);
  pos += 2;
  if (version !== FORMAT_VERSION) {
    throw new FableBinError(
      'BAD_VERSION',
      `Unsupported .fable.bin version ${version} (expected ${FORMAT_VERSION})`,
    );
  }

  // Meta length
  const metaLen = readUint32LE(bytes, pos);
  pos += 4;

  const payloadEnd = bytes.length - 4; // position of trailing CRC
  if (pos + metaLen > payloadEnd) {
    throw new FableBinError('TRUNCATED', 'Metadata extends beyond buffer bounds');
  }

  // Verify CRC32
  const storedCrc = readUint32LE(bytes, bytes.length - 4);
  const computedCrc = crc32(bytes, 0, bytes.length - 4);
  if (storedCrc !== computedCrc) {
    throw new FableBinError(
      'BAD_CHECKSUM',
      `Checksum mismatch: stored 0x${storedCrc.toString(16)}, computed 0x${computedCrc.toString(16)}`,
    );
  }

  // Parse metadata
  const metaRaw = bytes.subarray(pos, pos + metaLen);
  pos += metaLen;

  let meta: FableBinMeta;
  try {
    const parsed: unknown = JSON.parse(utf8Decode(metaRaw));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>)['title'] !== 'string' ||
      typeof (parsed as Record<string, unknown>)['createdAt'] !== 'string' ||
      typeof (parsed as Record<string, unknown>)['fingerprint'] !== 'string'
    ) {
      throw new Error('Missing required fields');
    }
    const p = parsed as Record<string, unknown>;
    meta = {
      title: p['title'] as string,
      createdAt: p['createdAt'] as string,
      fingerprint: p['fingerprint'] as string,
      ...(typeof p['author'] === 'string' ? { author: p['author'] } : {}),
    };
  } catch (e) {
    throw new FableBinError(
      'BAD_META',
      `Invalid metadata JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Program bytes
  const programBytes = bytes.subarray(pos, payloadEnd);
  let program: IrProgram;
  try {
    program = deserializeProgram(programBytes);
  } catch (e) {
    throw new FableBinError(
      'BAD_META',
      `Failed to deserialize program: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Cross-check fingerprint
  const recomputedFingerprint = programFingerprint(program);
  if (recomputedFingerprint !== meta.fingerprint) {
    throw new FableBinError(
      'BAD_CHECKSUM',
      `Fingerprint mismatch: stored "${meta.fingerprint}", computed "${recomputedFingerprint}"`,
    );
  }

  return { meta, program, fingerprint: recomputedFingerprint };
}

/** Non-throwing validation. Returns `{ ok: true, meta }` or `{ ok: false, error }`. */
export function validateFableBin(bytes: Uint8Array): ValidateFableBinResult {
  try {
    const { meta } = unpackFableBin(bytes);
    return { ok: true, meta };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
