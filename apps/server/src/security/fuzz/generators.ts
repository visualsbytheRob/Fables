// Pure deterministic input generators for fuzzing (F1267).
// Uses seeded PRNGs so every run is reproducible given the same seed.

// ---------------------------------------------------------------------------
// Seeded PRNG — mulberry32 (fast, well-distributed, 32-bit state)
// ---------------------------------------------------------------------------

export interface Rng {
  (): number; // returns a float in [0, 1)
}

/**
 * Create a deterministic pseudo-random number generator seeded with the
 * given 32-bit integer.  Returns a function that produces floats in [0, 1).
 */
export function makeRng(seed: number): Rng {
  let s = seed >>> 0; // ensure 32-bit unsigned
  return function rng(): number {
    s += 0x6d2b79f5;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    z = ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
    return z;
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function randInt(rng: Rng, min: number, max: number): number {
  // Returns an integer in [min, max] inclusive.
  return min + Math.floor(rng() * (max - min + 1));
}

function pickFrom<T>(rng: Rng, arr: readonly T[]): T {
  const idx = Math.floor(rng() * arr.length);
  // arr.length > 0 is a precondition; caller must guarantee it.
  return arr[idx] ?? arr[0]!;
}

// ---------------------------------------------------------------------------
// Random ASCII + Unicode strings
// ---------------------------------------------------------------------------

const ASCII_PRINTABLE =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';

const UNICODE_EXTRAS = [
  // zero-width / BOM / RTL
  '​', // zero-width space
  '‌', // zero-width non-joiner
  '‍', // zero-width joiner
  '﻿', // BOM / zero-width no-break space
  '‮', // right-to-left override
  '‏', // right-to-left mark
  // emoji
  '\u{1F600}', // 😀
  '\u{1F4A5}', // 💥
  // Supplementary characters (surrogate pair range in UTF-16)
  '\u{10FFFF}',
  // Arabic RTL
  'العربية',
  // CJK
  '中文',
  // combining diacritics
  '́̂̃',
];

/**
 * Generate a random string of up to `maxLen` characters drawn from a mix of
 * printable ASCII and Unicode edge-cases.
 */
export function randomString(rng: Rng, maxLen: number): string {
  const len = randInt(rng, 0, maxLen);
  const chars: string[] = [];
  for (let i = 0; i < len; i++) {
    if (rng() < 0.1) {
      // 10% chance of a Unicode extra
      chars.push(pickFrom(rng, UNICODE_EXTRAS));
    } else {
      chars.push(ASCII_PRINTABLE[Math.floor(rng() * ASCII_PRINTABLE.length)] ?? ' ');
    }
  }
  return chars.join('');
}

// ---------------------------------------------------------------------------
// FQL-shaped query generator
// ---------------------------------------------------------------------------

const FQL_FIELDS = [
  'tag',
  'notebook',
  'title',
  'body',
  'has',
  'linksto',
  'pinned',
  'created',
  'updated',
  'sort',
];
const FQL_OPS = ['AND', 'OR', 'NOT', 'and', 'or', 'not', ''];
const FQL_SORT_VALS = ['updated', 'created', 'title', 'junk'];
const FQL_DATE_VALS = ['2024-01', '2024-01-15', '>7d', '<30d', 'NOTADATE', ''];
const FQL_BOOL_VALS = ['true', 'false', 'maybe'];
const FQL_WORDS = ['hello', 'world', 'note', 'test', 'foo', 'bar', '#tag', '"phrase here"', ''];

/**
 * Generate a random FQL-shaped query string.  Mixes valid field:value tokens
 * with unbalanced delimiters, unknown fields, and boolean operator variants.
 */
export function randomFqlQuery(rng: Rng): string {
  const parts: string[] = [];
  const termCount = randInt(rng, 1, 6);

  for (let i = 0; i < termCount; i++) {
    const roll = rng();

    if (roll < 0.15) {
      // Raw word
      parts.push(pickFrom(rng, FQL_WORDS));
    } else if (roll < 0.3) {
      // Boolean operator
      parts.push(pickFrom(rng, FQL_OPS));
    } else if (roll < 0.45) {
      // Known field
      const field = pickFrom(rng, FQL_FIELDS);
      let val: string;
      if (field === 'sort') {
        val = pickFrom(rng, FQL_SORT_VALS);
      } else if (field === 'pinned') {
        val = pickFrom(rng, FQL_BOOL_VALS);
      } else if (field === 'created' || field === 'updated') {
        val = pickFrom(rng, FQL_DATE_VALS);
      } else {
        val = pickFrom(rng, FQL_WORDS);
      }
      parts.push(`${field}:${val}`);
    } else if (roll < 0.55) {
      // Wikilink field
      const field = pickFrom(rng, ['linksto', 'title']);
      const inner = rng() < 0.5 ? 'Some Note' : randomString(rng, 20);
      parts.push(`${field}:[[${inner}]]`);
    } else if (roll < 0.65) {
      // Unknown / typo field
      const badField = randomString(rng, 8).replace(/\s/g, '_');
      parts.push(`${badField}:value`);
    } else if (roll < 0.75) {
      // Paren wrapping
      parts.push('(');
      parts.push(pickFrom(rng, FQL_WORDS));
      if (rng() < 0.7) parts.push(')');
    } else if (roll < 0.85) {
      // Quoted phrase (possibly unterminated)
      const inner = randomString(rng, 15).replace(/"/g, "'");
      parts.push(rng() < 0.8 ? `"${inner}"` : `"${inner}`);
    } else {
      // Raw unicode / pathological
      parts.push(randomString(rng, 20));
    }
  }

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Forge-shaped source generator
// ---------------------------------------------------------------------------

const FORGE_KEYWORDS = ['=== ', '== ', '* ', '- ', '-> ', '<-> ', '~ ', '// ', '/* '];
const FORGE_DIVERT_TARGETS = ['START', 'END', 'knot_a', 'knot.b', 'DONE', ''];
const FORGE_VAR_NAMES = ['score', 'flag', 'count', 'x', 'player_name'];
const FORGE_EXPRS = ['1 + 2', 'true', '"hello"', 'x > 0', 'score == 100', ''];

/**
 * Generate a random Forge-shaped source string.  Uses scene/choice/divert
 * keywords mixed with random punctuation and garbage tokens.
 */
export function randomForgeSource(rng: Rng): string {
  const lines: string[] = [];
  const lineCount = randInt(rng, 1, 10);

  for (let i = 0; i < lineCount; i++) {
    const roll = rng();

    if (roll < 0.15) {
      // Knot declaration
      lines.push(`=== ${pickFrom(rng, FORGE_DIVERT_TARGETS)} ===`);
    } else if (roll < 0.25) {
      // Stitch
      lines.push(`== ${randomString(rng, 8).replace(/\s/g, '_')}`);
    } else if (roll < 0.4) {
      // Choice
      const bullet = rng() < 0.5 ? '*' : '-';
      lines.push(`${bullet} ${randomString(rng, 20)}`);
    } else if (roll < 0.55) {
      // Divert
      lines.push(`-> ${pickFrom(rng, FORGE_DIVERT_TARGETS)}`);
    } else if (roll < 0.65) {
      // Var assign
      const v = pickFrom(rng, FORGE_VAR_NAMES);
      lines.push(`~ ${v} = ${pickFrom(rng, FORGE_EXPRS)}`);
    } else if (roll < 0.75) {
      // Comment
      lines.push(`// ${randomString(rng, 30)}`);
    } else if (roll < 0.82) {
      // Random keyword prefix
      lines.push(`${pickFrom(rng, FORGE_KEYWORDS)}${randomString(rng, 20)}`);
    } else {
      // Pure garbage line
      lines.push(randomString(rng, 40));
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Pathological / ReDoS-shaped constants
// ---------------------------------------------------------------------------

/** A fixed catalogue of inputs known to stress parsers, tokenizers, or regexes. */
export function pathologicalInputs(): string[] {
  return [
    // Very long strings
    'a'.repeat(100_000),
    ' '.repeat(50_000),
    'A'.repeat(50_000),

    // Null-byte and control characters
    '\0'.repeat(1000),
    '\x01\x02\x03\x04\x05'.repeat(500),
    String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)),

    // Many backslashes
    '\\'.repeat(10_000),

    // RTL / zero-width flood
    '‮'.repeat(5_000),
    '​'.repeat(5_000),
    '﻿'.repeat(5_000),

    // Deeply nested brackets
    '('.repeat(500) + ')'.repeat(500),
    '['.repeat(500) + ']'.repeat(500),
    '{'.repeat(500) + '}'.repeat(500),
    '[['.repeat(500) + ']]'.repeat(500),

    // Unbalanced delimiters
    '('.repeat(1000),
    ')'.repeat(1000),
    '"'.repeat(1001), // odd number → always unterminated
    '[['.repeat(1000),

    // ReDoS-shaped: catastrophic backtracking stressors
    // Pattern: (a+)+ style inputs
    'a'.repeat(30) + '!',
    `${'(a)*'.repeat(20)}b`,
    `${'aa'.repeat(15)}!`,

    // Very long field:value chains
    Array.from({ length: 200 }, (_, i) => `tag:word${i}`).join(' '),

    // Unicode boundary edge-cases
    '\uD800', // lone high surrogate
    '\uDFFF', // lone low surrogate
    '𐏿', // valid surrogate pair (outside BMP)
    '￿',
    '\u{10FFFF}',

    // Mixed valid + invalid
    'title:"' + 'x'.repeat(50_000) + '"',
    'tag:' + '#'.repeat(1000),
    ''.padEnd(0), // empty
    '   ', // whitespace only

    // Injection-shaped
    "'; DROP TABLE notes; --",
    '<script>alert(1)</script>',
    '${7*7}',
    '{{7*7}}',
    '%00%0a%0d',
    '../../../etc/passwd',
    'C:\\Windows\\System32\\cmd.exe',
  ];
}

// ---------------------------------------------------------------------------
// ReDoS-shaped inputs specifically
// ---------------------------------------------------------------------------

/**
 * Inputs specifically designed to stress regex backtracking.  Each is a
 * pattern that would cause catastrophic backtracking in a naive `(a+)+` regex
 * but should complete quickly in a well-written parser.
 */
export function redosInputs(): string[] {
  const base = 'a'.repeat(25);
  return [
    base + '!',
    `${'a?'.repeat(20)}${'a'.repeat(20)}`,
    `${'(a|a)'.repeat(15)}b`,
    `${'a*'.repeat(10)}c`,
    // Long runs of alternation-shaped tokens
    Array.from({ length: 100 }, () => 'aaa|bbb').join(''),
    // FQL with many nested parens that could stress backtracking recovery
    '('.repeat(50) + 'hello' + ')'.repeat(50),
    // Long field chains
    Array.from({ length: 100 }, (_, i) => `tag:foo${i}`).join(' OR '),
    // Phrase with near-unterminated quotes
    '"' + 'x '.repeat(500) + '"',
    // Alternating colon-laden string
    Array.from({ length: 200 }, () => 'a:b').join(' '),
  ];
}
