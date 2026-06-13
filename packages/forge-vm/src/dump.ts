/**
 * IR text dump (F408) — the `forge dump-ir` core. A readable, stable listing
 * used for debugging and for the lowering snapshot suite (F410). The same
 * renderer drives the bytecode disassembler (F418).
 */

import type { IrInstr, IrProgram } from './ir.js';
import { OPCODES, Op } from './ir.js';
import { BUILTINS, EFFECTS } from './stdlib.js';

function quote(s: string): string {
  return JSON.stringify(s);
}

/** Render one instruction's operands symbolically. */
export function renderInstr(program: IrProgram, instr: IrInstr): string {
  const info = OPCODES[instr.op];
  const parts: string[] = [info.name];
  const containerName = (idx: number): string => program.containers[idx]?.name ?? `?${idx}`;
  info.operands.forEach((kind, i) => {
    const v = instr.args[i] as number;
    switch (kind) {
      case 'const': {
        const c = program.consts[v];
        if (c === undefined) parts.push(`const#${v}`);
        else if (c.kind === 'string') parts.push(quote(program.strings[c.value] ?? ''));
        else if (c.kind === 'divert') parts.push(`->${containerName(c.value)}`);
        else parts.push(String(c.value));
        break;
      }
      case 'string':
        parts.push(quote(program.strings[v] ?? `?${v}`));
        break;
      case 'global':
        parts.push(`$${program.globals[v]?.name ?? v}`);
        break;
      case 'temp':
        parts.push(`t${v}`);
        break;
      case 'container':
        parts.push(`#${v} (${containerName(v)})`);
        break;
      case 'containerOpt':
        parts.push(v === 0 ? '-' : `#${v - 1} (${containerName(v - 1)})`);
        break;
      case 'offset':
        parts.push(`@${v}`);
        break;
      case 'builtin':
        parts.push(BUILTINS[v]?.name ?? `builtin#${v}`);
        break;
      case 'effect':
        parts.push(EFFECTS[v]?.name ?? `effect#${v}`);
        break;
      case 'num':
        if (instr.op === Op.ENTITY_READ || instr.op === Op.ENTITY_PRINT) {
          parts.push(v === 0 ? '-' : quote(program.strings[v - 1] ?? `?${v - 1}`));
        } else {
          parts.push(String(v));
        }
        break;
    }
  });
  if (info.hasList === true) {
    parts.push(`[${(instr.list ?? []).map((v) => `@${v}`).join(', ')}]`);
  }
  return parts.join(' ');
}

export interface DumpOptions {
  /** Include instruction → source line:col annotations. Default false. */
  readonly sourceMap?: boolean;
}

/** Produce the full text dump of an IR program. */
export function dumpIr(program: IrProgram, options: DumpOptions = {}): string {
  const lines: string[] = [];
  const metaKeys = Object.keys(program.meta);
  lines.push(
    `program v${program.version} entry=#${program.entryContainer} containers=${program.containers.length} ` +
      `strings=${program.strings.length} consts=${program.consts.length} temps=${program.maxTempSlots} alts=${program.altCount}`,
  );
  if (metaKeys.length > 0) {
    lines.push(`meta: ${metaKeys.map((k) => `${k}=${quote(program.meta[k] ?? '')}`).join(' ')}`);
  }
  if (program.globals.length > 0) {
    lines.push('globals:');
    program.globals.forEach((g, i) => {
      lines.push(`  $${i} ${g.declKind} ${g.name} init=#${g.initContainer}`);
    });
  }
  if (program.bindings.length > 0) {
    lines.push('bindings:');
    for (const b of program.bindings) {
      lines.push(`  ${b.kind} ${b.name}${b.field !== undefined ? `.${b.field}` : ''}`);
    }
  }
  for (const c of program.containers) {
    lines.push('');
    lines.push(`#${c.index} ${c.name} (${c.kind}${c.visitTracked ? ', visits' : ''})`);
    c.instrs.forEach((instr, at) => {
      let line = `  ${String(at).padStart(3)}  ${renderInstr(program, instr)}`;
      if (options.sourceMap === true) {
        const span = c.spans[at];
        if (span != null) {
          line += `    ; ${program.files[span.file] ?? '?'}:${span.line}:${span.col}`;
        }
      }
      lines.push(line);
    });
  }
  lines.push('');
  return lines.join('\n');
}
