# Forge bytecode container format (F411)

A compiled story is a single `Uint8Array`. All multi-byte fixed-width fields
are little-endian; variable-width integers are unsigned LEB128 ("varint").
Strings are UTF-8 with a varint byte-length prefix.

## Header (16 bytes, fixed)

| Offset | Size | Field                                          |
| ------ | ---- | ---------------------------------------------- |
| 0      | 4    | Magic `"FVBC"` (0x46 0x56 0x42 0x43)           |
| 4      | 2    | Format version (`BYTECODE_VERSION`, currently 1) |
| 6      | 2    | Flags (reserved, 0)                            |
| 8      | 4    | FNV-1a 32-bit checksum of the payload (F414)   |
| 12     | 4    | Payload byte length                            |
| 16     | …    | Payload (sections)                             |

The deserializer rejects: bad magic, unsupported version, payload length
mismatch, and checksum mismatch (corruption detection, F414).

## Payload sections

`sectionCount: varint`, then per section: `id: varint`, `byteLength: varint`,
`bytes`. Unknown section ids are skipped (forward-compatible additions).

| Id | Section    | Contents |
| -- | ---------- | -------- |
| 1  | STRINGS    | Deduplicated string table (F415): `count`, then per string `len + utf8`. Every name, literal, and tag in the program is interned here exactly once. |
| 2  | CONSTS     | Deduplicated constant pool (F415): `count`, then per constant a tag byte — `0` number (f64 LE), `1` string (string index varint), `2` bool (u8), `3` divert target (container index varint). |
| 3  | GLOBALS    | `count`, then per global: name (string idx), declKind (`0` VAR / `1` CONST), init container idx. |
| 4  | CONTAINERS | The instruction stream: `count`, then per container: name (string idx), kind (u8), visitTracked (u8), instruction count, then instructions. Each instruction is `opcode: u8` followed by its fixed operands as varints (operand arity and meaning are defined per opcode in `ir.ts` `OPCODES`); list-carrying opcodes (`ALT`) append `listLen + values`. |
| 5  | SOURCEMAP  | Instruction → source span (F416): per container, per instruction: `0` (no location) or `1` + file idx, line, col, endLine, endCol as varints. Runtime errors use this to point back at source. |
| 6  | BINDINGS   | Knowledge-binding table (F417): `count`, then per entry kind (`0` entity / `1` note / `2` journal), name (string idx), hasField (u8) + field (string idx). Lets the server resolve which entities/notes a story touches without executing it. |
| 7  | META       | entry container idx, maxTempSlots, altCount, source file names (count + string idxs), story header metadata (count + key/value string idx pairs), temp-slot debug names (count + scope string idx + slot name idxs). |

## Compatibility policy (F419)

- `BYTECODE_VERSION` is bumped on **any** change to opcode numbering, operand
  signatures, constant tags, or section semantics. Opcode and registry ids
  (builtins, effects) are append-only — never renumbered.
- The deserializer accepts exactly the current version. Older bytecode is
  recompiled from source (stories keep their sources; bytecode is a cache).
  Version negotiation is therefore: `deserialize` throws `BytecodeError`
  with the found/supported versions, and callers fall back to `compileToIr`.
- New sections may be added with new ids; old readers skip unknown ids, so a
  *minor* additive change does not require a version bump.
- Saved state embeds `{version, checksum}` of the bytecode it was created
  against (F449). Loading state against different bytecode is refused unless
  the caller opts into best-effort migration (F465), which maps globals and
  visit counts by *name* and restarts flow position.
