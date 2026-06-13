import { describe, expect, it } from 'vitest';

import {
  BytecodeError,
  checksum,
  deserializeProgram,
  programFingerprint,
  readHeader,
  serializeProgram,
} from './bytecode.js';
import { dumpIr } from './dump.js';
import { BYTECODE_VERSION } from './ir.js';
import { compileToIr } from './lower.js';
import { createStory } from './vm.js';
import { fixture, corpusFiles } from './test-helpers.js';

/** F411–F420: bytecode container format. */

const FIXTURES = ['01-hello', '07-variables', '14-lists', '23-fox-and-crow', '24-lion-court-epic'];

function program(name: string) {
  return compileToIr(fixture(name), { files: corpusFiles() }).program;
}

describe('serialization round-trip (F420)', () => {
  for (const name of FIXTURES) {
    it(`round-trips ${name} to an identical program`, () => {
      const original = program(name);
      const bytes = serializeProgram(original);
      const decoded = deserializeProgram(bytes);
      expect(dumpIr(decoded, { sourceMap: true })).toBe(dumpIr(original, { sourceMap: true }));
      // Identical execution, not just identical listing.
      expect(serializeProgram(decoded)).toEqual(bytes);
    });
  }

  it('round-tripped bytecode executes identically (F420)', () => {
    const original = program('23-fox-and-crow');
    const decoded = deserializeProgram(serializeProgram(original));
    const play = (p: typeof original): string => {
      const story = createStory(p, { seed: 11, maxSteps: 20_000 });
      const out: string[] = [story.continue()];
      let guard = 0;
      while (story.status === 'choices' && guard++ < 5) {
        story.choose(story.choices().length - 1); // "Walk away." — the terminating path
        out.push(story.continue());
      }
      return out.join('|') + story.status;
    };
    expect(play(decoded)).toBe(play(original));
  });
});

describe('header, version, and corruption detection (F414/F419)', () => {
  it('writes a parseable header', () => {
    const bytes = serializeProgram(program('01-hello'));
    const header = readHeader(bytes);
    expect(header.version).toBe(BYTECODE_VERSION);
    expect(header.payloadLength).toBe(bytes.length - 16);
    expect(header.checksum).toBe(checksum(bytes.subarray(16)));
  });

  it('rejects non-bytecode input', () => {
    expect(() => deserializeProgram(new Uint8Array([1, 2, 3]))).toThrow(BytecodeError);
    expect(() => deserializeProgram(new Uint8Array(64))).toThrow(/bad magic/);
  });

  it('rejects unsupported versions with a recompile hint', () => {
    const bytes = serializeProgram(program('01-hello'));
    const tampered = bytes.slice();
    new DataView(tampered.buffer).setUint16(4, 99, true);
    expect(() => deserializeProgram(tampered)).toThrow(/unsupported bytecode version 99/);
    expect(() => deserializeProgram(tampered)).toThrow(/recompile/);
  });

  it('detects payload corruption via checksum', () => {
    const bytes = serializeProgram(program('07-variables'));
    const tampered = bytes.slice();
    tampered[tampered.length - 3] = (tampered[tampered.length - 3] as number) ^ 0xff;
    expect(() => deserializeProgram(tampered)).toThrow(/checksum mismatch/);
  });

  it('detects truncation', () => {
    const bytes = serializeProgram(program('07-variables'));
    expect(() => deserializeProgram(bytes.subarray(0, bytes.length - 4))).toThrow(/truncated/);
  });
});

describe('string/constant pool deduplication (F415)', () => {
  it('interns repeated strings exactly once', () => {
    const src = 'Echo one.\nEcho one.\nEcho one.\n-> END\n';
    const p = compileToIr(src).program;
    expect(p.strings.filter((s) => s === 'Echo one.')).toHaveLength(1);
  });

  it('interns repeated constants exactly once', () => {
    const p = compileToIr('VAR a = 42\nVAR b = 42\n{a} {b} {42}\n-> END\n', { optimize: false }).program;
    expect(p.consts.filter((c) => c.kind === 'number' && c.value === 42)).toHaveLength(1);
  });
});

describe('source map section (F416)', () => {
  it('preserves instruction → source spans across serialization', () => {
    const original = program('12-stitches');
    const decoded = deserializeProgram(serializeProgram(original));
    const knot = decoded.containers.find((c) => c.name === 'court');
    const spans = (knot?.spans ?? []).filter((s) => s !== null);
    expect(spans.length).toBeGreaterThan(0);
    expect(spans[0]?.line).toBeGreaterThan(1);
    expect(decoded.files).toEqual(original.files);
  });
});

describe('knowledge binding table section (F417)', () => {
  it('preserves entity/note bindings across serialization', () => {
    const original = program('16-bindings');
    const decoded = deserializeProgram(serializeProgram(original));
    expect(decoded.bindings).toEqual(original.bindings);
    expect(decoded.bindings.some((b) => b.kind === 'note')).toBe(true);
    expect(decoded.bindings.some((b) => b.kind === 'entity' && b.field === 'health')).toBe(true);
  });
});

describe('fingerprint (F449 support)', () => {
  it('is stable for identical programs and differs across programs', () => {
    expect(programFingerprint(program('01-hello'))).toBe(programFingerprint(program('01-hello')));
    expect(programFingerprint(program('01-hello'))).not.toBe(programFingerprint(program('02-two-knots')));
  });
});
