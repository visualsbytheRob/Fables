/**
 * Pure QR-code encoder — no external dependencies (F588).
 *
 * Supports byte-mode encoding, versions 1–10, error-correction levels L/M/Q/H.
 * Reed-Solomon ECC implemented over GF(256) with the QR standard generator poly
 * (primitive element α, polynomial x^8 + x^4 + x^3 + x^2 + 1, i.e. 0x11D).
 *
 * Exported API:
 *   encodeQr(text, opts?)  → { size, modules }
 *   qrToSvg(text, opts?)  → SVG string
 *
 * Feature coverage: F588
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EccLevel = 'L' | 'M' | 'Q' | 'H';

export interface QrResult {
  /** Side length in modules (including quiet zone is handled by the SVG). */
  size: number;
  /** Row-major boolean matrix. modules[row][col] = true means dark. */
  modules: boolean[][];
}

export interface QrOptions {
  ecc?: EccLevel | undefined;
}

// ---------------------------------------------------------------------------
// QR constants
// ---------------------------------------------------------------------------

// Number of EC codewords per block, and number of blocks, for versions 1–10
// Source: ISO 18004:2015 Table 9. Format: [eccPerBlock, b1, c1, b2?, c2?]
// where b1 = number of type-1 blocks with c1 data codewords each,
//       b2 = number of type-2 blocks with c2 = c1+1 data codewords.
// Total codewords per version: listed in Table 1.

interface EcTable {
  totalCodewords: number;
  eccPerBlock: number;
  group1Blocks: number;
  group1DataPerBlock: number;
  group2Blocks: number;
  group2DataPerBlock: number;
}

// [version][level] — levels L=0, M=1, Q=2, H=3
const EC_TABLE: EcTable[][] = [
  // version 1
  [
    {
      totalCodewords: 26,
      eccPerBlock: 7,
      group1Blocks: 1,
      group1DataPerBlock: 19,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
    {
      totalCodewords: 26,
      eccPerBlock: 10,
      group1Blocks: 1,
      group1DataPerBlock: 16,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
    {
      totalCodewords: 26,
      eccPerBlock: 13,
      group1Blocks: 1,
      group1DataPerBlock: 13,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
    {
      totalCodewords: 26,
      eccPerBlock: 17,
      group1Blocks: 1,
      group1DataPerBlock: 9,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
  ],
  // version 2
  [
    {
      totalCodewords: 44,
      eccPerBlock: 10,
      group1Blocks: 1,
      group1DataPerBlock: 34,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
    {
      totalCodewords: 44,
      eccPerBlock: 16,
      group1Blocks: 1,
      group1DataPerBlock: 28,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
    {
      totalCodewords: 44,
      eccPerBlock: 22,
      group1Blocks: 1,
      group1DataPerBlock: 22,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
    {
      totalCodewords: 44,
      eccPerBlock: 28,
      group1Blocks: 1,
      group1DataPerBlock: 16,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
  ],
  // version 3
  [
    {
      totalCodewords: 70,
      eccPerBlock: 15,
      group1Blocks: 1,
      group1DataPerBlock: 55,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
    {
      totalCodewords: 70,
      eccPerBlock: 26,
      group1Blocks: 1,
      group1DataPerBlock: 44,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
    {
      totalCodewords: 70,
      eccPerBlock: 18,
      group1Blocks: 2,
      group1DataPerBlock: 17,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
    {
      totalCodewords: 70,
      eccPerBlock: 22,
      group1Blocks: 2,
      group1DataPerBlock: 13,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
  ],
  // version 4
  [
    {
      totalCodewords: 100,
      eccPerBlock: 20,
      group1Blocks: 1,
      group1DataPerBlock: 80,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
    {
      totalCodewords: 100,
      eccPerBlock: 18,
      group1Blocks: 2,
      group1DataPerBlock: 32,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
    {
      totalCodewords: 100,
      eccPerBlock: 26,
      group1Blocks: 2,
      group1DataPerBlock: 24,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
    {
      totalCodewords: 100,
      eccPerBlock: 16,
      group1Blocks: 4,
      group1DataPerBlock: 9,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
  ],
  // version 5
  [
    {
      totalCodewords: 134,
      eccPerBlock: 26,
      group1Blocks: 1,
      group1DataPerBlock: 108,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
    {
      totalCodewords: 134,
      eccPerBlock: 24,
      group1Blocks: 2,
      group1DataPerBlock: 43,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
    {
      totalCodewords: 134,
      eccPerBlock: 18,
      group1Blocks: 2,
      group1DataPerBlock: 15,
      group2Blocks: 2,
      group2DataPerBlock: 16,
    },
    {
      totalCodewords: 134,
      eccPerBlock: 22,
      group1Blocks: 2,
      group1DataPerBlock: 11,
      group2Blocks: 2,
      group2DataPerBlock: 12,
    },
  ],
  // version 6
  [
    {
      totalCodewords: 172,
      eccPerBlock: 18,
      group1Blocks: 2,
      group1DataPerBlock: 68,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
    {
      totalCodewords: 172,
      eccPerBlock: 16,
      group1Blocks: 4,
      group1DataPerBlock: 27,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
    {
      totalCodewords: 172,
      eccPerBlock: 24,
      group1Blocks: 4,
      group1DataPerBlock: 19,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
    {
      totalCodewords: 172,
      eccPerBlock: 28,
      group1Blocks: 4,
      group1DataPerBlock: 15,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
  ],
  // version 7
  [
    {
      totalCodewords: 196,
      eccPerBlock: 20,
      group1Blocks: 2,
      group1DataPerBlock: 78,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
    {
      totalCodewords: 196,
      eccPerBlock: 18,
      group1Blocks: 4,
      group1DataPerBlock: 31,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
    {
      totalCodewords: 196,
      eccPerBlock: 18,
      group1Blocks: 2,
      group1DataPerBlock: 14,
      group2Blocks: 4,
      group2DataPerBlock: 15,
    },
    {
      totalCodewords: 196,
      eccPerBlock: 26,
      group1Blocks: 4,
      group1DataPerBlock: 13,
      group2Blocks: 1,
      group2DataPerBlock: 14,
    },
  ],
  // version 8
  [
    {
      totalCodewords: 242,
      eccPerBlock: 24,
      group1Blocks: 2,
      group1DataPerBlock: 97,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
    {
      totalCodewords: 242,
      eccPerBlock: 22,
      group1Blocks: 2,
      group1DataPerBlock: 38,
      group2Blocks: 2,
      group2DataPerBlock: 39,
    },
    {
      totalCodewords: 242,
      eccPerBlock: 22,
      group1Blocks: 4,
      group1DataPerBlock: 18,
      group2Blocks: 2,
      group2DataPerBlock: 19,
    },
    {
      totalCodewords: 242,
      eccPerBlock: 26,
      group1Blocks: 4,
      group1DataPerBlock: 14,
      group2Blocks: 2,
      group2DataPerBlock: 15,
    },
  ],
  // version 9
  [
    {
      totalCodewords: 292,
      eccPerBlock: 30,
      group1Blocks: 2,
      group1DataPerBlock: 116,
      group2Blocks: 0,
      group2DataPerBlock: 0,
    },
    {
      totalCodewords: 292,
      eccPerBlock: 22,
      group1Blocks: 3,
      group1DataPerBlock: 36,
      group2Blocks: 2,
      group2DataPerBlock: 37,
    },
    {
      totalCodewords: 292,
      eccPerBlock: 20,
      group1Blocks: 4,
      group1DataPerBlock: 16,
      group2Blocks: 4,
      group2DataPerBlock: 17,
    },
    {
      totalCodewords: 292,
      eccPerBlock: 24,
      group1Blocks: 4,
      group1DataPerBlock: 12,
      group2Blocks: 4,
      group2DataPerBlock: 13,
    },
  ],
  // version 10
  [
    {
      totalCodewords: 346,
      eccPerBlock: 18,
      group1Blocks: 2,
      group1DataPerBlock: 68,
      group2Blocks: 2,
      group2DataPerBlock: 69,
    },
    {
      totalCodewords: 346,
      eccPerBlock: 26,
      group1Blocks: 4,
      group1DataPerBlock: 43,
      group2Blocks: 1,
      group2DataPerBlock: 44,
    },
    {
      totalCodewords: 346,
      eccPerBlock: 24,
      group1Blocks: 6,
      group1DataPerBlock: 19,
      group2Blocks: 2,
      group2DataPerBlock: 20,
    },
    {
      totalCodewords: 346,
      eccPerBlock: 28,
      group1Blocks: 6,
      group1DataPerBlock: 15,
      group2Blocks: 2,
      group2DataPerBlock: 16,
    },
  ],
];

const ECC_LEVEL_INDEX: Record<EccLevel, number> = { L: 0, M: 1, Q: 2, H: 3 };

// Format info strings (15 bits, with BCH error correction) keyed by [eccLevelIndex][maskPattern]
// Pre-computed from ISO 18004. XOR with mask 101010000010010.
const FORMAT_INFO: number[][] = [
  // L
  [0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976],
  // M
  [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0],
  // Q
  [0x355f, 0x3068, 0x3f31, 0x3a06, 0x24b4, 0x2183, 0x2eda, 0x2bed],
  // H
  [0x1689, 0x13be, 0x1ce7, 0x19d0, 0x0762, 0x0255, 0x0d0c, 0x083b],
];

// ---------------------------------------------------------------------------
// GF(256) arithmetic (primitive poly x^8+x^4+x^3+x^2+1 = 0x11D)
// ---------------------------------------------------------------------------

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGF(): void {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
    x &= 0xff;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255]!;
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[(GF_LOG[a]! + GF_LOG[b]!) % 255]!;
}

/** Polynomial multiplication in GF(256). Both are coefficient arrays (index = degree). */
function gfPolyMul(p: Uint8Array, q: Uint8Array): Uint8Array {
  const result = new Uint8Array(p.length + q.length - 1);
  for (let i = 0; i < p.length; i++) {
    for (let j = 0; j < q.length; j++) {
      const idx = i + j;
      result[idx] = (result[idx] ?? 0) ^ gfMul(p[i]!, q[j]!);
    }
  }
  return result;
}

/** Build RS generator polynomial of degree `n`. */
function rsGeneratorPoly(n: number): Uint8Array<ArrayBuffer> {
  let poly: Uint8Array<ArrayBuffer> = new Uint8Array([1]);
  for (let i = 0; i < n; i++) {
    const next = gfPolyMul(poly, new Uint8Array([1, GF_EXP[i]!]));
    poly = new Uint8Array(next);
  }
  return poly;
}

/** Compute RS error-correction codewords. Returns `ecCount` bytes. */
function rsComputeEc(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = rsGeneratorPoly(ecCount);
  // Polynomial long-division in GF(256)
  const msg = new Uint8Array(data.length + ecCount);
  msg.set(data);
  for (let i = 0; i < data.length; i++) {
    const coeff = msg[i]!;
    if (coeff === 0) continue;
    for (let j = 0; j < gen.length; j++) {
      const idx = i + j;
      msg[idx] = (msg[idx] ?? 0) ^ gfMul(gen[j]!, coeff);
    }
  }
  return msg.subarray(data.length);
}

// ---------------------------------------------------------------------------
// Data encoding
// ---------------------------------------------------------------------------

/** Byte-mode encode `text` → bit array. */
function encodeByte(text: string, totalDataBits: number): Uint8Array {
  const textBytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i) ?? 0;
    if (cp > 0xffff) i++;
    if (cp < 0x80) {
      textBytes.push(cp);
    } else if (cp < 0x800) {
      textBytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      textBytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      textBytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }

  // Build bit stream
  const bits: number[] = [];
  const push = (val: number, len: number): void => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };

  push(0b0100, 4); // mode indicator: byte
  push(textBytes.length, 8); // character count (byte mode, v1-9: 8 bits)
  for (const b of textBytes) push(b, 8);

  // Terminator
  const remaining = totalDataBits - bits.length;
  const termLen = Math.min(4, remaining);
  for (let i = 0; i < termLen; i++) bits.push(0);

  // Pad to byte boundary
  while (bits.length % 8 !== 0) bits.push(0);

  // Pad bytes: alternating 0xEC, 0x11
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bits.length < totalDataBits) {
    push(padBytes[padIdx % 2]!, 8);
    padIdx++;
  }

  // Pack bits into bytes
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) {
      const byteIdx = Math.floor(i / 8);
      out[byteIdx] = (out[byteIdx] ?? 0) | (1 << (7 - (i % 8)));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Module matrix builder
// ---------------------------------------------------------------------------

const FINDER = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1],
];

// Alignment pattern centers for versions 2–10
const ALIGNMENT_CENTERS: number[][] = [
  [], // v1
  [6, 18], // v2
  [6, 22], // v3
  [6, 26], // v4
  [6, 30], // v5
  [6, 34], // v6
  [6, 22, 38], // v7
  [6, 24, 42], // v8
  [6, 26, 46], // v9
  [6, 28, 50], // v10
];

function makeMatrix(version: number): {
  modules: Uint8Array[];
  reserved: Uint8Array[];
} {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Uint8Array(size));
  const reserved = Array.from({ length: size }, () => new Uint8Array(size));

  const setModule = (r: number, c: number, dark: boolean, isReserved = false): void => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    (modules[r] as Uint8Array)[c] = dark ? 1 : 0;
    if (isReserved) (reserved[r] as Uint8Array)[c] = 1;
  };

  // Finder patterns
  const placeFinderAt = (topRow: number, topCol: number): void => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        setModule(topRow + r, topCol + c, FINDER[r]![c] === 1, true);
      }
    }
    // Separator (light row/col around finder)
    for (let i = 0; i <= 7; i++) {
      setModule(topRow + 7, topCol + i, false, true);
      setModule(topRow + i, topCol + 7, false, true);
    }
  };

  placeFinderAt(0, 0); // top-left
  placeFinderAt(0, size - 7); // top-right
  placeFinderAt(size - 7, 0); // bottom-left

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0;
    setModule(6, i, dark, true);
    setModule(i, 6, dark, true);
  }

  // Dark module
  setModule(size - 8, 8, true, true);

  // Alignment patterns (v2+)
  const centers = ALIGNMENT_CENTERS[version - 1] ?? [];
  for (let ri = 0; ri < centers.length; ri++) {
    for (let ci = 0; ci < centers.length; ci++) {
      const row = centers[ri]!;
      const col = centers[ci]!;
      // Skip if overlaps a finder pattern
      if ((row <= 8 && col <= 8) || (row <= 8 && col >= size - 8) || (row >= size - 8 && col <= 8))
        continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const isEdge = Math.abs(dr) === 2 || Math.abs(dc) === 2;
          const isCenter = dr === 0 && dc === 0;
          setModule(row + dr, col + dc, isEdge || isCenter, true);
        }
      }
    }
  }

  // Format info placeholders (reserved but value set later)
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      reserved[0]![i] = 1;
      reserved[i]![0] = 1;
    }
    if (i !== 6) {
      reserved[8]![i] = 1;
      reserved[i]![8] = 1;
    }
  }
  for (let i = size - 8; i < size; i++) {
    reserved[8]![i] = 1;
    reserved[i]![8] = 1;
  }

  return { modules, reserved };
}

/** Place data bits into the matrix using the standard zigzag pattern. */
function placeData(modules: Uint8Array[], reserved: Uint8Array[], data: Uint8Array): void {
  const size = modules.length;
  let bitIdx = 0;

  // Columns right to left, skipping timing column 6
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip timing column
    const upward = ((size - 1 - right) / 2) % 2 === 0 ? true : false;
    // Actually: column pair index from right: pairs are (size-1,size-2), (size-3,size-4)...
    // upward when pair index is even, downward when odd
    const pairIndex = Math.floor((size - 1 - right) / 2);
    const goUp = pairIndex % 2 === 0;
    void upward; // suppress unused warning

    for (let rowOffset = 0; rowOffset < size; rowOffset++) {
      const row = goUp ? size - 1 - rowOffset : rowOffset;
      for (let dcol = 0; dcol <= 1; dcol++) {
        const col = right - dcol;
        if (col < 0 || col >= size) continue;
        if (reserved[row]![col]) continue;
        const byte = data[Math.floor(bitIdx / 8)] ?? 0;
        const bit = (byte >> (7 - (bitIdx % 8))) & 1;
        modules[row]![col] = bit;
        bitIdx++;
      }
    }
  }
}

/** Apply mask pattern to non-reserved modules. Returns mutated copy. */
function applyMask(
  modules: Uint8Array[],
  reserved: Uint8Array[],
  maskPattern: number,
): Uint8Array[] {
  const size = modules.length;
  const masked = modules.map((row) => new Uint8Array(row));

  const shouldFlip = (r: number, c: number): boolean => {
    switch (maskPattern) {
      case 0:
        return (r + c) % 2 === 0;
      case 1:
        return r % 2 === 0;
      case 2:
        return c % 3 === 0;
      case 3:
        return (r + c) % 3 === 0;
      case 4:
        return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5:
        return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6:
        return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      case 7:
        return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
      default:
        return false;
    }
  };

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (reserved[r]![c]) continue;
      if (shouldFlip(r, c)) {
        const row = masked[r]!;
        row[c] = (row[c] ?? 0) ^ 1;
      }
    }
  }
  return masked;
}

/** Write format info bits into the matrix. */
function writeFormatInfo(modules: Uint8Array[], formatInfo: number): void {
  const size = modules.length;
  // Format info is 15 bits
  // Top-left horizontal (cols 0..8, row 8, skip col 6)
  const bits: number[] = [];
  for (let i = 14; i >= 0; i--) bits.push((formatInfo >> i) & 1);

  let bi = 0;
  for (let c = 0; c <= 8; c++) {
    if (c === 6) continue;
    modules[8]![c] = bits[bi++]!;
  }
  // Top-left vertical (rows 8..0, col 8, skip row 6)
  for (let r = 7; r >= 0; r--) {
    if (r === 6) continue;
    modules[r]![8] = bits[bi++]!;
  }

  // Top-right (row 8, cols size-8..size-1)
  bi = 0;
  for (let c = size - 1; c >= size - 8; c--) {
    modules[8]![c] = bits[bi++]!;
  }
  // Bottom-left (rows size-7..size-1, col 8)
  for (let r = size - 7; r < size; r++) {
    modules[r]![8] = bits[bi++]!;
  }
}

/** Score a masked matrix (lower is better). We use penalty rules P1-P4. */
function penalty(modules: Uint8Array[]): number {
  const size = modules.length;
  let score = 0;

  // P1: runs of 5+ same-color
  for (let r = 0; r < size; r++) {
    for (const isRow of [true, false]) {
      let run = 1;
      let prev = isRow ? modules[r]![0] : modules[0]![r];
      for (let i = 1; i < size; i++) {
        const cur = isRow ? modules[r]![i] : modules[i]![r];
        if (cur === prev) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score++;
        } else {
          run = 1;
          prev = cur;
        }
      }
    }
  }

  // P2: 2x2 blocks
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r]![c];
      if (v === modules[r]![c + 1] && v === modules[r + 1]![c] && v === modules[r + 1]![c + 1]) {
        score += 3;
      }
    }
  }

  // P3: finder-like patterns
  const P3A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const P3B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 11; c++) {
      const row = modules[r]!;
      let matchA = true,
        matchB = true;
      for (let i = 0; i < 11; i++) {
        if (row[c + i] !== P3A[i]) matchA = false;
        if (row[c + i] !== P3B[i]) matchB = false;
      }
      if (matchA) score += 40;
      if (matchB) score += 40;
    }
  }
  for (let c = 0; c < size; c++) {
    for (let r = 0; r <= size - 11; r++) {
      let matchA = true,
        matchB = true;
      for (let i = 0; i < 11; i++) {
        const v = modules[r + i]![c];
        if (v !== P3A[i]) matchA = false;
        if (v !== P3B[i]) matchB = false;
      }
      if (matchA) score += 40;
      if (matchB) score += 40;
    }
  }

  // P4: proportion of dark modules
  let dark = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r]![c]) dark++;
    }
  }
  const pct = (dark / (size * size)) * 100;
  const prev5 = Math.floor(pct / 5) * 5;
  const next5 = prev5 + 5;
  score += Math.min(Math.abs(prev5 - 50), Math.abs(next5 - 50)) * 2;

  return score;
}

// ---------------------------------------------------------------------------
// Main encode function
// ---------------------------------------------------------------------------

/**
 * Encode `text` into a QR code module matrix.
 * Automatically selects the smallest version that fits the data.
 */
export function encodeQr(text: string, opts: QrOptions = {}): QrResult {
  const ecc = opts.ecc ?? 'M';
  const eccIdx = ECC_LEVEL_INDEX[ecc];

  // UTF-8 encode to determine byte length
  const encoder = new TextEncoder();
  const textBytes = encoder.encode(text);
  const byteLen = textBytes.length;

  // Find minimum version
  let version = -1;
  let ecInfo: EcTable | undefined;
  for (let v = 0; v < EC_TABLE.length; v++) {
    const info = EC_TABLE[v]![eccIdx]!;
    const dataCodewords =
      info.group1Blocks * info.group1DataPerBlock + info.group2Blocks * info.group2DataPerBlock;
    // Byte mode overhead: 4 (mode) + 8 (count) + 4 (terminator) bits = 2 bytes overhead
    if (dataCodewords >= byteLen + 2) {
      version = v + 1;
      ecInfo = info;
      break;
    }
  }

  if (version === -1 || ecInfo === undefined) {
    throw new Error(`Text too long to encode in a version-10 QR code (${byteLen} bytes)`);
  }

  const dataCodewords =
    ecInfo.group1Blocks * ecInfo.group1DataPerBlock +
    ecInfo.group2Blocks * ecInfo.group2DataPerBlock;

  const dataBits = dataCodewords * 8;

  // Encode data bytes
  const dataBytes = encodeByte(text, dataBits);

  // Split into blocks and compute EC codewords
  const allDataCws: Uint8Array[] = [];
  const allEcCws: Uint8Array[] = [];

  let byteOffset = 0;
  for (let g = 0; g < 2; g++) {
    const numBlocks = g === 0 ? ecInfo.group1Blocks : ecInfo.group2Blocks;
    const cwPerBlock = g === 0 ? ecInfo.group1DataPerBlock : ecInfo.group2DataPerBlock;
    if (numBlocks === 0) continue;
    for (let b = 0; b < numBlocks; b++) {
      const block = dataBytes.subarray(byteOffset, byteOffset + cwPerBlock);
      byteOffset += cwPerBlock;
      allDataCws.push(block);
      allEcCws.push(rsComputeEc(block, ecInfo.eccPerBlock));
    }
  }

  // Interleave: data codewords column-by-column
  const interleaved: number[] = [];
  const maxDataLen = Math.max(...allDataCws.map((b) => b.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of allDataCws) {
      if (i < block.length) interleaved.push(block[i]!);
    }
  }
  for (let i = 0; i < ecInfo.eccPerBlock; i++) {
    for (const block of allEcCws) {
      if (i < block.length) interleaved.push(block[i]!);
    }
  }

  const finalData = new Uint8Array(interleaved);

  // Build matrix
  const { modules, reserved } = makeMatrix(version);
  placeData(modules, reserved, finalData);

  // Choose best mask
  let bestMask = 0;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    const masked = applyMask(modules, reserved, m);
    const fmtInfo = FORMAT_INFO[eccIdx]![m]!;
    writeFormatInfo(masked, fmtInfo);
    const s = penalty(masked);
    if (s < bestScore) {
      bestScore = s;
      bestMask = m;
    }
  }

  // Apply chosen mask and write final format info
  const finalModules = applyMask(modules, reserved, bestMask);
  writeFormatInfo(finalModules, FORMAT_INFO[eccIdx]![bestMask]!);

  const size = version * 4 + 17;

  // Convert to boolean[][]
  const boolModules: boolean[][] = finalModules.map((row) => Array.from(row).map((v) => v !== 0));

  return { size, modules: boolModules };
}

// ---------------------------------------------------------------------------
// SVG renderer
// ---------------------------------------------------------------------------

/**
 * Encode `text` as a QR code and render to SVG string.
 * Includes a 4-module quiet zone around the symbol.
 */
export function qrToSvg(text: string, opts: QrOptions = {}): string {
  const { size, modules } = encodeQr(text, opts);
  const quietZone = 4;
  const totalSize = size + quietZone * 2;
  const scale = 10; // pixels per module (SVG units)
  const viewBox = `0 0 ${totalSize * scale} ${totalSize * scale}`;

  const rects: string[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r]![c]) {
        const x = (c + quietZone) * scale;
        const y = (r + quietZone) * scale;
        rects.push(`<rect x="${x}" y="${y}" width="${scale}" height="${scale}"/>`);
      }
    }
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" shape-rendering="crispEdges">`,
    `<rect width="100%" height="100%" fill="white"/>`,
    `<g fill="black">`,
    ...rects,
    `</g>`,
    `</svg>`,
  ].join('\n');
}
