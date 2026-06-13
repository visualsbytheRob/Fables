/**
 * IR validation pass (F407): structural well-formedness checks run after
 * lowering (and after deserialization in tests). Catches dangling container
 * references, out-of-range pool indexes, bad jump offsets, and flow
 * containers that could run off their final instruction.
 */

import type { IrInstr, IrProgram } from './ir.js';
import { OPCODES, Op } from './ir.js';
import { BUILTINS, EFFECTS } from './stdlib.js';

export interface IrIssue {
  readonly container: number;
  readonly instr: number;
  readonly message: string;
}

const TERMINATORS = new Set<Op>([
  Op.DIVERT,
  Op.DIVERT_DYN,
  Op.TUNNEL_RETURN,
  Op.END_STORY,
  Op.DONE,
  Op.RET,
  Op.PRESENT,
  Op.JUMP,
]);

/** Validate an IR program; returns a list of issues (empty = valid). */
export function validateIr(program: IrProgram): IrIssue[] {
  const issues: IrIssue[] = [];
  const nContainers = program.containers.length;
  const push = (container: number, instr: number, message: string): void => {
    issues.push({ container, instr, message });
  };

  if (program.entryContainer < 0 || program.entryContainer >= nContainers) {
    push(-1, -1, `entry container #${program.entryContainer} is out of range`);
  }
  for (const g of program.globals) {
    if (g.initContainer < 0 || g.initContainer >= nContainers) {
      push(-1, -1, `global "${g.name}" init container #${g.initContainer} is out of range`);
    }
  }

  const names = new Set<string>();
  for (const c of program.containers) {
    if (names.has(c.name)) push(c.index, -1, `duplicate container name "${c.name}"`);
    names.add(c.name);
    if (c.spans.length !== c.instrs.length) {
      push(c.index, -1, `source-map length ${c.spans.length} != instruction count ${c.instrs.length}`);
    }

    c.instrs.forEach((instr, at) => {
      const info = OPCODES[instr.op];
      if (info === undefined) {
        push(c.index, at, `unknown opcode ${instr.op}`);
        return;
      }
      if (instr.args.length !== info.operands.length) {
        push(c.index, at, `${info.name}: expected ${info.operands.length} operands, got ${instr.args.length}`);
        return;
      }
      const checkOperand = (kind: string, v: number): void => {
        switch (kind) {
          case 'const':
            if (v < 0 || v >= program.consts.length) push(c.index, at, `${info.name}: const #${v} out of range`);
            break;
          case 'string':
            if (v < 0 || v >= program.strings.length) push(c.index, at, `${info.name}: string #${v} out of range`);
            break;
          case 'global':
            if (v < 0 || v >= program.globals.length) push(c.index, at, `${info.name}: global #${v} out of range`);
            break;
          case 'temp':
            if (v < 0 || v >= program.maxTempSlots) push(c.index, at, `${info.name}: temp slot ${v} out of range`);
            break;
          case 'container':
            if (v < 0 || v >= nContainers) push(c.index, at, `${info.name}: container #${v} dangling`);
            break;
          case 'containerOpt':
            if (v < 0 || v > nContainers) push(c.index, at, `${info.name}: container #${v - 1} dangling`);
            break;
          case 'offset':
            if (v < 0 || v > c.instrs.length) push(c.index, at, `${info.name}: jump offset ${v} out of bounds`);
            break;
          case 'builtin':
            if (v < 0 || v >= BUILTINS.length) push(c.index, at, `${info.name}: builtin #${v} unknown`);
            break;
          case 'effect':
            if (v < 0 || v >= EFFECTS.length) push(c.index, at, `${info.name}: effect #${v} unknown`);
            break;
        }
      };
      info.operands.forEach((kind, oi) => checkOperand(kind, instr.args[oi] as number));
      if (info.hasList === true) {
        for (const v of instr.list ?? []) checkOperand(info.listKind ?? 'num', v);
      }
      // ENTITY_READ/ENTITY_PRINT second operand is a string index + 1.
      if ((instr.op === Op.ENTITY_READ || instr.op === Op.ENTITY_PRINT) && (instr.args[1] as number) > program.strings.length) {
        push(c.index, at, `${info.name}: string #${(instr.args[1] as number) - 1} out of range`);
      }
    });

    // Flow containers must not run off the end (no implicit fall-through).
    const last: IrInstr | undefined = c.instrs[c.instrs.length - 1];
    if (last === undefined) {
      push(c.index, -1, `container "${c.name}" is empty`);
    } else if (!TERMINATORS.has(last.op)) {
      push(c.index, c.instrs.length - 1, `container "${c.name}" does not end in a terminator (ends with ${OPCODES[last.op].name})`);
    } else if (last.op === Op.JUMP && (last.args[0] as number) >= c.instrs.length) {
      push(c.index, c.instrs.length - 1, `container "${c.name}" ends with a jump past its end`);
    }
  }
  return issues;
}

/** Throwing wrapper used by the compile pipeline. */
export function assertValidIr(program: IrProgram): void {
  const issues = validateIr(program);
  if (issues.length > 0) {
    const lines = issues.slice(0, 10).map((i) => `  [#${i.container}:${i.instr}] ${i.message}`);
    throw new Error(`invalid IR (${issues.length} issue${issues.length === 1 ? '' : 's'}):\n${lines.join('\n')}`);
  }
}
