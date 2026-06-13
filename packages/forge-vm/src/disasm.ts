/**
 * Disassembler (F418) — the `forge disasm` core. Accepts raw bytecode or an
 * already-decoded program and produces a readable listing with header info,
 * symbolic operands, and optional source-map annotations.
 */

import { deserializeProgram, readHeader } from './bytecode.js';
import type { DumpOptions } from './dump.js';
import { dumpIr } from './dump.js';
import type { IrProgram } from './ir.js';

export type DisasmOptions = DumpOptions;

/** Disassemble bytecode (or a decoded program) into a readable listing. */
export function disasm(input: Uint8Array | IrProgram, options: DisasmOptions = {}): string {
  if (input instanceof Uint8Array) {
    const header = readHeader(input);
    const program = deserializeProgram(input);
    const head =
      `; forge bytecode v${header.version}, ${input.length} bytes, ` +
      `checksum 0x${header.checksum.toString(16).padStart(8, '0')}\n`;
    return head + dumpIr(program, options);
  }
  return dumpIr(input, options);
}
