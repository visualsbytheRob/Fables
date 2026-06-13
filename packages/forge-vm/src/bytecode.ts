/**
 * Bytecode serializer/deserializer (F413–F417). The container format is
 * documented in `bytecode.md`; the compatibility policy (F419) lives there
 * too. Round-trip identity is covered by F420 tests.
 */

import type { BindingEntry, ContainerKind, IrConst, IrContainer, IrGlobal, IrProgram, SrcSpan , Op } from './ir.js';
import { BYTECODE_VERSION, OPCODES } from './ir.js';

export class BytecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BytecodeError';
  }
}

// Minimal UTF-8 codec (keeps this package free of platform globals).
function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i) as number;
    if (cp > 0xffff) i++; // surrogate pair consumed
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else {
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
  }
  return Uint8Array.from(out);
}

function utf8Decode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i] as number;
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

const MAGIC = [0x46, 0x56, 0x42, 0x43]; // "FVBC"
const HEADER_SIZE = 16;

const SECTION = { strings: 1, consts: 2, globals: 3, containers: 4, sourcemap: 5, bindings: 6, meta: 7 } as const;

const CONTAINER_KINDS: ContainerKind[] = [
  'preamble',
  'knot',
  'stitch',
  'gather',
  'choiceBody',
  'choiceText',
  'eval',
  'init',
];

/** FNV-1a 32-bit checksum (corruption detection, F414). */
export function checksum(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let h = 0x811c9dc5;
  for (let i = start; i < end; i++) {
    h ^= bytes[i] as number;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ── byte writer / reader ─────────────────────────────────────────────────────

class Writer {
  private buf = new Uint8Array(1024);
  private len = 0;

  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf[this.len++] = v & 0xff;
  }

  varint(v: number): void {
    if (v < 0 || !Number.isInteger(v)) throw new BytecodeError(`cannot encode varint ${v}`);
    let x = v;
    do {
      let byte = x & 0x7f;
      x = Math.floor(x / 128);
      if (x > 0) byte |= 0x80;
      this.u8(byte);
    } while (x > 0);
  }

  f64(v: number): void {
    this.ensure(8);
    new DataView(this.buf.buffer, this.buf.byteOffset + this.len, 8).setFloat64(0, v, true);
    this.len += 8;
  }

  utf8(s: string): void {
    const bytes = utf8Encode(s);
    this.varint(bytes.length);
    this.ensure(bytes.length);
    this.buf.set(bytes, this.len);
    this.len += bytes.length;
  }

  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

class Reader {
  pos = 0;
  constructor(private readonly buf: Uint8Array) {}

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  u8(): number {
    if (this.pos >= this.buf.length) throw new BytecodeError('unexpected end of bytecode');
    return this.buf[this.pos++] as number;
  }

  varint(): number {
    let result = 0;
    let shift = 1;
    for (;;) {
      const byte = this.u8();
      result += (byte & 0x7f) * shift;
      if ((byte & 0x80) === 0) return result;
      shift *= 128;
      if (shift > 2 ** 53) throw new BytecodeError('varint too large');
    }
  }

  f64(): number {
    if (this.pos + 8 > this.buf.length) throw new BytecodeError('unexpected end of bytecode');
    const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8).getFloat64(0, true);
    this.pos += 8;
    return v;
  }

  utf8(): string {
    const len = this.varint();
    if (this.pos + len > this.buf.length) throw new BytecodeError('unexpected end of bytecode');
    const s = utf8Decode(this.buf.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }

  sub(len: number): Reader {
    if (this.pos + len > this.buf.length) throw new BytecodeError('unexpected end of bytecode');
    const r = new Reader(this.buf.subarray(this.pos, this.pos + len));
    this.pos += len;
    return r;
  }
}

// ── serialize (F413) ─────────────────────────────────────────────────────────

export function serializeProgram(program: IrProgram): Uint8Array {
  const payload = new Writer();
  const sections: { id: number; bytes: Uint8Array }[] = [];
  const section = (id: number, write: (w: Writer) => void): void => {
    const w = new Writer();
    write(w);
    sections.push({ id, bytes: w.finish() });
  };

  section(SECTION.strings, (w) => {
    w.varint(program.strings.length);
    for (const s of program.strings) w.utf8(s);
  });

  section(SECTION.consts, (w) => {
    w.varint(program.consts.length);
    for (const c of program.consts) {
      if (c.kind === 'number') {
        w.u8(0);
        w.f64(c.value);
      } else if (c.kind === 'string') {
        w.u8(1);
        w.varint(c.value);
      } else if (c.kind === 'bool') {
        w.u8(2);
        w.u8(c.value ? 1 : 0);
      } else {
        w.u8(3);
        w.varint(c.value);
      }
    }
  });

  const strIdx = new Map(program.strings.map((s, i) => [s, i]));
  const str = (s: string): number => {
    const i = strIdx.get(s);
    if (i === undefined) throw new BytecodeError(`string "${s}" missing from table`);
    return i;
  };

  section(SECTION.globals, (w) => {
    w.varint(program.globals.length);
    for (const g of program.globals) {
      w.varint(str(g.name));
      w.u8(g.declKind === 'CONST' ? 1 : 0);
      w.varint(g.initContainer);
    }
  });

  section(SECTION.containers, (w) => {
    w.varint(program.containers.length);
    for (const c of program.containers) {
      w.varint(str(c.name));
      w.u8(CONTAINER_KINDS.indexOf(c.kind));
      w.u8(c.visitTracked ? 1 : 0);
      w.varint(c.instrs.length);
      for (const instr of c.instrs) {
        const info = OPCODES[instr.op];
        if (info === undefined) throw new BytecodeError(`cannot serialize unknown opcode ${instr.op}`);
        w.u8(instr.op);
        for (const a of instr.args) w.varint(a);
        if (info.hasList === true) {
          const list = instr.list ?? [];
          w.varint(list.length);
          for (const v of list) w.varint(v);
        }
      }
    }
  });

  section(SECTION.sourcemap, (w) => {
    for (const c of program.containers) {
      for (const span of c.spans) {
        if (span === null) {
          w.u8(0);
        } else {
          w.u8(1);
          w.varint(span.file);
          w.varint(span.line);
          w.varint(span.col);
          w.varint(span.endLine);
          w.varint(span.endCol);
        }
      }
    }
  });

  section(SECTION.bindings, (w) => {
    w.varint(program.bindings.length);
    for (const b of program.bindings) {
      w.u8(b.kind === 'entity' ? 0 : b.kind === 'note' ? 1 : 2);
      w.varint(str(b.name));
      if (b.field !== undefined) {
        w.u8(1);
        w.varint(str(b.field));
      } else {
        w.u8(0);
      }
    }
  });

  section(SECTION.meta, (w) => {
    w.varint(program.entryContainer);
    w.varint(program.maxTempSlots);
    w.varint(program.altCount);
    w.varint(program.files.length);
    for (const f of program.files) w.utf8(f);
    const metaKeys = Object.keys(program.meta);
    w.varint(metaKeys.length);
    for (const k of metaKeys) {
      w.utf8(k);
      w.utf8(program.meta[k] ?? '');
    }
    const tempKeys = Object.keys(program.tempNames);
    w.varint(tempKeys.length);
    for (const k of tempKeys) {
      w.utf8(k);
      const names = program.tempNames[k] ?? [];
      w.varint(names.length);
      for (const n of names) w.utf8(n);
    }
  });

  payload.varint(sections.length);
  for (const s of sections) {
    payload.varint(s.id);
    payload.varint(s.bytes.length);
    payload.bytes(s.bytes);
  }
  const body = payload.finish();

  const out = new Uint8Array(HEADER_SIZE + body.length);
  out.set(MAGIC, 0);
  const view = new DataView(out.buffer);
  view.setUint16(4, BYTECODE_VERSION, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, checksum(body), true);
  view.setUint32(12, body.length, true);
  out.set(body, HEADER_SIZE);
  return out;
}

// ── deserialize (F414) ───────────────────────────────────────────────────────

export interface BytecodeHeader {
  readonly version: number;
  readonly checksum: number;
  readonly payloadLength: number;
}

/** Parse and verify just the header (used for version negotiation, F419). */
export function readHeader(bytes: Uint8Array): BytecodeHeader {
  if (bytes.length < HEADER_SIZE || MAGIC.some((m, i) => bytes[i] !== m)) {
    throw new BytecodeError('not Forge bytecode (bad magic)');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    version: view.getUint16(4, true),
    checksum: view.getUint32(8, true),
    payloadLength: view.getUint32(12, true),
  };
}

export function deserializeProgram(bytes: Uint8Array): IrProgram {
  const header = readHeader(bytes);
  if (header.version !== BYTECODE_VERSION) {
    throw new BytecodeError(
      `unsupported bytecode version ${header.version} (this runtime supports ${BYTECODE_VERSION}); recompile the story from source`,
    );
  }
  if (HEADER_SIZE + header.payloadLength !== bytes.length) {
    throw new BytecodeError('bytecode is truncated or padded (length mismatch)');
  }
  const body = bytes.subarray(HEADER_SIZE);
  if (checksum(body) !== header.checksum) {
    throw new BytecodeError('bytecode checksum mismatch (corrupted)');
  }

  const top = new Reader(body);
  const sectionCount = top.varint();
  const sections = new Map<number, Reader>();
  for (let i = 0; i < sectionCount; i++) {
    const id = top.varint();
    const len = top.varint();
    sections.set(id, top.sub(len)); // unknown ids are skipped naturally
  }
  const need = (id: number, name: string): Reader => {
    const r = sections.get(id);
    if (r === undefined) throw new BytecodeError(`missing ${name} section`);
    return r;
  };

  const rs = need(SECTION.strings, 'strings');
  const strings: string[] = [];
  for (let i = rs.varint(); i > 0; i--) strings.push(rs.utf8());

  const rc = need(SECTION.consts, 'constants');
  const consts: IrConst[] = [];
  for (let i = rc.varint(); i > 0; i--) {
    const tag = rc.u8();
    if (tag === 0) consts.push({ kind: 'number', value: rc.f64() });
    else if (tag === 1) consts.push({ kind: 'string', value: rc.varint() });
    else if (tag === 2) consts.push({ kind: 'bool', value: rc.u8() === 1 });
    else if (tag === 3) consts.push({ kind: 'divert', value: rc.varint() });
    else throw new BytecodeError(`unknown constant tag ${tag}`);
  }

  const rg = need(SECTION.globals, 'globals');
  const globals: IrGlobal[] = [];
  for (let i = rg.varint(); i > 0; i--) {
    const name = strings[rg.varint()] ?? '';
    const declKind = rg.u8() === 1 ? 'CONST' : 'VAR';
    globals.push({ name, declKind, initContainer: rg.varint() });
  }

  const rk = need(SECTION.containers, 'containers');
  const containers: IrContainer[] = [];
  const containerCount = rk.varint();
  for (let ci = 0; ci < containerCount; ci++) {
    const name = strings[rk.varint()] ?? '';
    const kind = CONTAINER_KINDS[rk.u8()] ?? 'eval';
    const visitTracked = rk.u8() === 1;
    const instrCount = rk.varint();
    const instrs: IrContainer['instrs'] = [];
    for (let i = 0; i < instrCount; i++) {
      const op = rk.u8() as Op;
      const info = OPCODES[op];
      if (info === undefined) throw new BytecodeError(`unknown opcode ${op} in container ${name}`);
      const args: number[] = [];
      for (let a = 0; a < info.operands.length; a++) args.push(rk.varint());
      if (info.hasList === true) {
        const list: number[] = [];
        for (let n = rk.varint(); n > 0; n--) list.push(rk.varint());
        instrs.push({ op, args, list });
      } else {
        instrs.push({ op, args });
      }
    }
    containers.push({ index: ci, name, kind, visitTracked, instrs, spans: [] });
  }

  const rm = need(SECTION.sourcemap, 'source map');
  for (const c of containers) {
    for (let i = 0; i < c.instrs.length; i++) {
      if (rm.u8() === 0) {
        c.spans.push(null);
      } else {
        const span: SrcSpan = {
          file: rm.varint(),
          line: rm.varint(),
          col: rm.varint(),
          endLine: rm.varint(),
          endCol: rm.varint(),
        };
        c.spans.push(span);
      }
    }
  }

  const rb = need(SECTION.bindings, 'bindings');
  const bindings: BindingEntry[] = [];
  for (let i = rb.varint(); i > 0; i--) {
    const kindTag = rb.u8();
    const kind = kindTag === 0 ? 'entity' : kindTag === 1 ? 'note' : 'journal';
    const name = strings[rb.varint()] ?? '';
    const hasField = rb.u8() === 1;
    const field = hasField ? (strings[rb.varint()] ?? '') : undefined;
    bindings.push({ kind, name, ...(field !== undefined ? { field } : {}) });
  }

  const rmeta = need(SECTION.meta, 'meta');
  const entryContainer = rmeta.varint();
  const maxTempSlots = rmeta.varint();
  const altCount = rmeta.varint();
  const files: string[] = [];
  for (let i = rmeta.varint(); i > 0; i--) files.push(rmeta.utf8());
  const meta: Record<string, string> = {};
  for (let i = rmeta.varint(); i > 0; i--) {
    const k = rmeta.utf8();
    meta[k] = rmeta.utf8();
  }
  const tempNames: Record<string, string[]> = {};
  for (let i = rmeta.varint(); i > 0; i--) {
    const k = rmeta.utf8();
    const names: string[] = [];
    for (let n = rmeta.varint(); n > 0; n--) names.push(rmeta.utf8());
    tempNames[k] = names;
  }

  return {
    version: header.version,
    meta,
    strings,
    consts,
    containers,
    globals,
    entryContainer,
    maxTempSlots,
    files,
    bindings,
    tempNames,
    altCount,
  };
}

/**
 * Stable fingerprint of a program (`version:checksum`), embedded in saved
 * state for the bytecode-compatibility check (F449).
 */
export function programFingerprint(program: IrProgram): string {
  const bytes = serializeProgram(program);
  return `${BYTECODE_VERSION}:${readHeader(bytes).checksum.toString(16)}`;
}
