/**
 * Forge IR (F402–F406): a flat container tree plus a stack-machine
 * instruction set. See `ir.md` for the design document.
 *
 * Every knot, stitch, labeled choice/gather, choice body, choice text, and
 * expression evaluation site lowers into an {@link IrContainer}: a named,
 * indexed list of instructions. Flow between containers is explicit — there
 * is no fall-through; every flow container ends in a terminator.
 */

// ── opcodes (F412) ───────────────────────────────────────────────────────────

export enum Op {
  NOP = 0,

  // stack & constants
  PUSH_CONST = 1, // a: const-pool index
  POP = 2,

  // arithmetic / logic / comparison (operate on the value stack)
  ADD = 3,
  SUB = 4,
  MUL = 5,
  DIV = 6,
  MOD = 7,
  NEG = 8,
  NOT = 9,
  EQ = 10,
  NEQ = 11,
  LT = 12,
  LTE = 13,
  GT = 14,
  GTE = 15,
  AND = 16,
  OR = 17,
  HAS = 18, // list ∋ element
  HASNT = 19,
  LIST_NEW = 20, // a: element count popped from stack

  // variables & state
  LOAD_GLOBAL = 21, // a: global index
  STORE_GLOBAL = 22, // a: global index
  LOAD_TEMP = 23, // a: temp slot
  STORE_TEMP = 24, // a: temp slot
  LOAD_DYNAMIC = 25, // a: string index — host external state lookup by name
  LOAD_VISITS = 26, // a: container index — read count of a knot/stitch/label
  TURNS = 27, // push the turn counter

  // output
  TEXT = 28, // a: string index — append literal text to the output line
  PRINT = 29, // pop a value, stringify, append (interpolation)
  NEWLINE = 30, // end the current output line
  GLUE = 31, // suppress the next line break
  TAG = 32, // a: string index — attach a tag to the current line/choice

  // intra-container flow
  JUMP = 33, // a: absolute instruction index within this container
  JUMP_IF_FALSE = 34, // a: absolute instruction index within this container
  ALT = 35, // a: alt id, b: flavor (0 seq / 1 cycle / 2 shuffle), list: branch offsets

  // inter-container flow
  DIVERT = 36, // a: container index
  DIVERT_DYN = 37, // pop a divert value, jump to its container
  TUNNEL = 38, // a: container index — push return frame, divert
  TUNNEL_RETURN = 39, // pop tunnel frame (`->->`)
  END_STORY = 40, // `-> END`
  DONE = 41, // `-> DONE` / implicit end of flow
  RET = 42, // terminate an eval/text container, returning to the caller

  // choices
  CHOICE = 43, // a: flags (1 sticky, 2 fallback), b: cond container + 1 (0 = none), c: text container, d: body container
  PRESENT = 44, // stop and present collected choices (or take a fallback)

  // instrumentation & host
  VISIT = 45, // a: container index — increment its visit count
  ENTITY_PRINT = 46, // a: name string index, b: display string index + 1 (0 = none)
  ENTITY_READ = 47, // a: name string index, b: field string index + 1 (0 = none)
  NOTE_PRINT = 48, // a: title string index
  EFFECT = 49, // a: effect registry id, b: arg count — pops args, pushes result value
  CALL_BUILTIN = 50, // a: stdlib registry id, b: arg count
  CALL_HOST = 51, // a: name string index, b: arg count — external function
}

/** How a single operand should be decoded/rendered. */
export type OperandKind =
  | 'num' // plain number
  | 'const' // constant-pool index
  | 'string' // string-table index
  | 'global' // global-variable index
  | 'temp' // temp slot
  | 'container' // container index
  | 'containerOpt' // container index + 1, 0 means none
  | 'offset' // instruction index within the current container
  | 'builtin' // stdlib registry id
  | 'effect'; // effect registry id

export interface OpcodeInfo {
  readonly name: string;
  readonly operands: readonly OperandKind[];
  /** True when the instruction carries a trailing operand list (`list`). */
  readonly hasList?: boolean;
  readonly listKind?: OperandKind;
}

/** Operand signatures for every opcode — drives encoding, decoding, and disasm. */
export const OPCODES: Readonly<Record<Op, OpcodeInfo>> = {
  [Op.NOP]: { name: 'NOP', operands: [] },
  [Op.PUSH_CONST]: { name: 'PUSH_CONST', operands: ['const'] },
  [Op.POP]: { name: 'POP', operands: [] },
  [Op.ADD]: { name: 'ADD', operands: [] },
  [Op.SUB]: { name: 'SUB', operands: [] },
  [Op.MUL]: { name: 'MUL', operands: [] },
  [Op.DIV]: { name: 'DIV', operands: [] },
  [Op.MOD]: { name: 'MOD', operands: [] },
  [Op.NEG]: { name: 'NEG', operands: [] },
  [Op.NOT]: { name: 'NOT', operands: [] },
  [Op.EQ]: { name: 'EQ', operands: [] },
  [Op.NEQ]: { name: 'NEQ', operands: [] },
  [Op.LT]: { name: 'LT', operands: [] },
  [Op.LTE]: { name: 'LTE', operands: [] },
  [Op.GT]: { name: 'GT', operands: [] },
  [Op.GTE]: { name: 'GTE', operands: [] },
  [Op.AND]: { name: 'AND', operands: [] },
  [Op.OR]: { name: 'OR', operands: [] },
  [Op.HAS]: { name: 'HAS', operands: [] },
  [Op.HASNT]: { name: 'HASNT', operands: [] },
  [Op.LIST_NEW]: { name: 'LIST_NEW', operands: ['num'] },
  [Op.LOAD_GLOBAL]: { name: 'LOAD_GLOBAL', operands: ['global'] },
  [Op.STORE_GLOBAL]: { name: 'STORE_GLOBAL', operands: ['global'] },
  [Op.LOAD_TEMP]: { name: 'LOAD_TEMP', operands: ['temp'] },
  [Op.STORE_TEMP]: { name: 'STORE_TEMP', operands: ['temp'] },
  [Op.LOAD_DYNAMIC]: { name: 'LOAD_DYNAMIC', operands: ['string'] },
  [Op.LOAD_VISITS]: { name: 'LOAD_VISITS', operands: ['container'] },
  [Op.TURNS]: { name: 'TURNS', operands: [] },
  [Op.TEXT]: { name: 'TEXT', operands: ['string'] },
  [Op.PRINT]: { name: 'PRINT', operands: [] },
  [Op.NEWLINE]: { name: 'NEWLINE', operands: [] },
  [Op.GLUE]: { name: 'GLUE', operands: [] },
  [Op.TAG]: { name: 'TAG', operands: ['string'] },
  [Op.JUMP]: { name: 'JUMP', operands: ['offset'] },
  [Op.JUMP_IF_FALSE]: { name: 'JUMP_IF_FALSE', operands: ['offset'] },
  [Op.ALT]: { name: 'ALT', operands: ['num', 'num'], hasList: true, listKind: 'offset' },
  [Op.DIVERT]: { name: 'DIVERT', operands: ['container'] },
  [Op.DIVERT_DYN]: { name: 'DIVERT_DYN', operands: [] },
  [Op.TUNNEL]: { name: 'TUNNEL', operands: ['container'] },
  [Op.TUNNEL_RETURN]: { name: 'TUNNEL_RETURN', operands: [] },
  [Op.END_STORY]: { name: 'END_STORY', operands: [] },
  [Op.DONE]: { name: 'DONE', operands: [] },
  [Op.RET]: { name: 'RET', operands: [] },
  [Op.CHOICE]: { name: 'CHOICE', operands: ['num', 'containerOpt', 'container', 'container'] },
  [Op.PRESENT]: { name: 'PRESENT', operands: [] },
  [Op.VISIT]: { name: 'VISIT', operands: ['container'] },
  [Op.ENTITY_PRINT]: { name: 'ENTITY_PRINT', operands: ['string', 'num'] },
  [Op.ENTITY_READ]: { name: 'ENTITY_READ', operands: ['string', 'num'] },
  [Op.NOTE_PRINT]: { name: 'NOTE_PRINT', operands: ['string'] },
  [Op.EFFECT]: { name: 'EFFECT', operands: ['effect', 'num'] },
  [Op.CALL_BUILTIN]: { name: 'CALL_BUILTIN', operands: ['builtin', 'num'] },
  [Op.CALL_HOST]: { name: 'CALL_HOST', operands: ['string', 'num'] },
} as const;

/** Choice instruction flag bits. */
export const CHOICE_FLAG_STICKY = 1;
export const CHOICE_FLAG_FALLBACK = 2;

/** Alternative flavors as encoded in ALT's second operand. */
export const ALT_FLAVOR = { sequence: 0, cycle: 1, shuffle: 2 } as const;
export type AltFlavorCode = (typeof ALT_FLAVOR)[keyof typeof ALT_FLAVOR];

// ── instructions & containers ────────────────────────────────────────────────

export interface IrInstr {
  readonly op: Op;
  /** Fixed operands, in signature order. */
  readonly args: readonly number[];
  /** Trailing operand list (ALT branch offsets). */
  readonly list?: readonly number[];
}

/** A resolved source location (instruction → source, F416). */
export interface SrcSpan {
  /** Index into {@link IrProgram.files}. */
  readonly file: number;
  readonly line: number;
  readonly col: number;
  readonly endLine: number;
  readonly endCol: number;
}

export type ContainerKind =
  | 'preamble'
  | 'knot'
  | 'stitch'
  | 'gather'
  | 'choiceBody'
  | 'choiceText'
  | 'eval'
  | 'init';

export interface IrContainer {
  readonly index: number;
  /** Unique dotted name, e.g. `meeting`, `palace.throne`, `clearing.howl`. */
  readonly name: string;
  readonly kind: ContainerKind;
  /** True when this container's visit count is meaningful (read counts). */
  readonly visitTracked: boolean;
  readonly instrs: IrInstr[];
  /** Parallel to `instrs`; null where no source location applies. */
  readonly spans: (SrcSpan | null)[];
}

// ── constants ────────────────────────────────────────────────────────────────

export type IrConst =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'string'; readonly value: number /* string-table index */ }
  | { readonly kind: 'bool'; readonly value: boolean }
  | { readonly kind: 'divert'; readonly value: number /* container index */ };

export interface IrGlobal {
  readonly name: string;
  readonly declKind: 'VAR' | 'CONST';
  /** Eval container computing the initial value. */
  readonly initContainer: number;
}

/** Knowledge-binding table entry (F417). */
export interface BindingEntry {
  readonly kind: 'entity' | 'note' | 'journal';
  readonly name: string;
  readonly field?: string;
}

// ── the program ──────────────────────────────────────────────────────────────

/** Bumped whenever the IR/bytecode format changes incompatibly (F419). */
export const BYTECODE_VERSION = 1;

export interface IrProgram {
  readonly version: number;
  /** Story header metadata from `# key: value` tags. */
  readonly meta: Readonly<Record<string, string>>;
  readonly strings: string[];
  readonly consts: IrConst[];
  readonly containers: IrContainer[];
  readonly globals: IrGlobal[];
  readonly entryContainer: number;
  /** Size of each tunnel frame's temp slot array. */
  readonly maxTempSlots: number;
  /** Source file names (index 0 = entry file). */
  readonly files: string[];
  readonly bindings: BindingEntry[];
  /** Debug info: knot scope name → temp slot names, for the inspector. */
  readonly tempNames: Readonly<Record<string, readonly string[]>>;
  /** Number of distinct ALT sites (state array sizing). */
  readonly altCount: number;
}

/** Look up a container by exact name. */
export function findContainer(program: IrProgram, name: string): IrContainer | undefined {
  return program.containers.find((c) => c.name === name);
}
