/**
 * @fables/forge-vm — the Forge bytecode compiler back-end and story VM.
 *
 * ## Public API overview (F439)
 *
 * Compiling:
 * ```ts
 * const { program } = compileToIr(source);     // parse → lower → IR
 * const bytecode = compileStory(source);       // …plus validate + serialize
 * const listing = disasm(bytecode);            // readable listing
 * ```
 *
 * Playing:
 * ```ts
 * const story = createStory(bytecode, { seed: 42, host, functions });
 * while (true) {
 *   const text = story.continue();             // runs to choice point or end (F433)
 *   render(text, story.currentTags);
 *   if (story.status === 'done') break;
 *   const picked = await ui.pick(story.choices());
 *   story.choose(picked);                      // resume from the chosen branch (F435)
 * }
 * ```
 *
 * State:
 * ```ts
 * const save = story.saveState();              // plain JSON (F448)
 * story.loadState(save);                       // exact restore (same bytecode, F449)
 * story.loadState(oldSave, { migrate: true }); // best-effort across recompiles (F465)
 * const back = rewindStory(story, 3);          // replay-based rewind (F464)
 * ```
 *
 * Determinism contract (F477): identical bytecode + identical seed +
 * identical choice indexes ⇒ byte-identical transcripts, always.
 */

// IR (F401–F410)
export * from './ir.js';
export { compileToIr, lowerStory, LoweringError } from './lower.js';
export type { CompileToIrOptions, CompileToIrResult } from './lower.js';
export { foldExpr } from './optimize.js';
export { validateIr, assertValidIr } from './validate.js';
export type { IrIssue } from './validate.js';
export { dumpIr, renderInstr } from './dump.js';
export type { DumpOptions } from './dump.js';

// Bytecode (F411–F420)
export {
  serializeProgram,
  deserializeProgram,
  readHeader,
  checksum,
  programFingerprint,
  BytecodeError,
} from './bytecode.js';
export type { BytecodeHeader } from './bytecode.js';
export { disasm } from './disasm.js';
export type { DisasmOptions } from './disasm.js';

// Values & state (F441–F450)
export * from './values.js';
export {
  STATE_VERSION,
  SaveError,
  validateSaveShape,
} from './state.js';
export type {
  StorySaveState,
  SavedFrame,
  SavedPendingChoice,
  SavedChoiceView,
  HistoryEntry,
  TranscriptEntry,
  MigrationReport,
} from './state.js';

// Randomness & stdlib (F471–F479)
export { DEFAULT_SEED, normalizeSeed, prngNext, prngFloat, prngInt, prngPermutation } from './prng.js';
export { BUILTINS, BUILTIN_IDS, EFFECTS, EFFECT_IDS, parseDice, generateStdlibDoc } from './stdlib.js';
export type { BuiltinEntry, BuiltinContext, EffectEntry } from './stdlib.js';

// Host hooks (F481–F490)
export type { StoryHost, ExternalFunction, AuditEntry, VariableObserver } from './host.js';

// VM (F431–F440)
export { createStory, Story, ForgeRuntimeError } from './vm.js';
export type {
  StoryOptions,
  StoryStatus,
  ChoiceView,
  InspectorState,
  InspectorFrame,
  RuntimeLocation,
} from './vm.js';

// Saves & rewind (F461–F469, library side)
export { createSaveSlot, restoreSaveSlot, replayStory, rewindStory } from './saves.js';
export type { SaveSlot, CreateSaveSlotOptions } from './saves.js';

// Debugger & tooling (F491–F499)
export { StoryDebugger, evaluateWatchExpression } from './debugger.js';
export type { Breakpoint, DebugStop, WatchResult } from './debugger.js';
export { runStory, compileStory, createStoryFromSource } from './harness.js';
export type { RunStoryResult, TurnRecord, ChoiceScriptEntry } from './harness.js';
