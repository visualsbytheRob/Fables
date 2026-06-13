/**
 * Minimal VarUint + VarUint8Array encoding/decoding — matching the lib0
 * binary format used by y-protocols, so we can build sync messages without
 * importing lib0 directly (which is not a listed dep of apps/web).
 *
 * VarUint: unsigned LEB128 (variable-length encoding of a non-negative integer).
 * VarUint8Array: 4-byte length prefix (network order) followed by the bytes.
 *   Actually lib0 uses varUint as the length prefix for Uint8Arrays too.
 */

// ---- VarUint helpers ----

/** Max bytes for a 32-bit varUint. */
const MAX_VARUINT_BYTES = 5;

// ---- Encoder ----

export class Encoder {
  private _buf: Uint8Array;
  private _pos = 0;

  constructor(capacity = 64) {
    this._buf = new Uint8Array(capacity);
  }

  private _ensureCapacity(extra: number) {
    const needed = this._pos + extra;
    if (needed > this._buf.length) {
      const next = new Uint8Array(Math.max(this._buf.length * 2, needed));
      next.set(this._buf);
      this._buf = next;
    }
  }

  writeVarUint(n: number) {
    this._ensureCapacity(MAX_VARUINT_BYTES);
    n = n >>> 0; // treat as unsigned
    while (n >= 128) {
      this._buf[this._pos++] = (n & 0x7f) | 0x80;
      n >>>= 7;
    }
    this._buf[this._pos++] = n;
  }

  writeVarUint8Array(data: Uint8Array) {
    this.writeVarUint(data.byteLength);
    this._ensureCapacity(data.byteLength);
    this._buf.set(data, this._pos);
    this._pos += data.byteLength;
  }

  toUint8Array(): Uint8Array {
    return this._buf.subarray(0, this._pos);
  }

  get length(): number {
    return this._pos;
  }
}

// ---- Decoder ----

export class Decoder {
  private _pos = 0;

  constructor(private readonly _buf: Uint8Array) {}

  readVarUint(): number {
    let result = 0;
    let shift = 0;
    while (shift < 35) {
      const byte = this._buf[this._pos++] ?? 0;
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return result >>> 0;
  }

  readVarUint8Array(): Uint8Array {
    const len = this.readVarUint();
    const slice = this._buf.subarray(this._pos, this._pos + len);
    this._pos += len;
    return slice;
  }

  get hasMore(): boolean {
    return this._pos < this._buf.length;
  }
}
