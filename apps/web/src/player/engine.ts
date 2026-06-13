/**
 * Player session engine (F541–F550, F561–F568): a thin, pure wrapper around
 * the forge-vm `Story` for distraction-free reading. Rendering is always a
 * function of `story.transcript()`, so restore, rewind and replay all fall
 * out of the VM's own deterministic state model (seed + choice history).
 *
 * Compilation reuses the playtest engine's client-side compiler (F531) over
 * the story files fetched from the server.
 */
import { SaveError, createStory, rewindStory, validateSaveShape } from '@fables/forge-vm';
import type {
  ChoiceView,
  IrProgram,
  Story,
  StorySaveState,
  TranscriptEntry,
} from '@fables/forge-vm';
import { compileBuffers } from '../stories/playtest/engine.js';
import type { ProgramBuild } from '../stories/playtest/engine.js';
import type { StorySettings } from '../stories/api.js';
import { classifyTags, parseSegments, slugify } from './tags.js';
import type { Segment, TextEffect } from './tags.js';

/** Compile the story project for play — same compiler as the playtest pane. */
export function compileForPlay(
  files: ReadonlyMap<string, string>,
  entryPath: string,
): ProgramBuild {
  return compileBuffers(files, entryPath);
}

/** Pick the run seed per story settings (F507): fixed replays, random roams. */
export function pickSeed(settings: StorySettings | undefined): number {
  if (settings?.seedMode === 'fixed') return settings.seed;
  return Math.floor(Math.random() * 0x7fffffff);
}

/* ── reading blocks ────────────────────────────────────────────────────── */

export interface PlayerBlock {
  readonly key: string;
  readonly kind: 'para' | 'choice' | 'chapter';
  readonly text: string;
  readonly effects: readonly TextEffect[];
  /** Ambient scene active at this block (F555). */
  readonly scene: string | null;
  readonly segments: readonly Segment[];
}

/** Derive renderable blocks from the VM transcript (chapter cards, scenes). */
export function blocksFrom(entries: readonly TranscriptEntry[]): PlayerBlock[] {
  const blocks: PlayerBlock[] = [];
  let scene: string | null = null;
  entries.forEach((entry, i) => {
    // The VM echoes a chosen choice's text as the next output line; the
    // styled choice echo already shows it, so skip the exact duplicate.
    if (entry.kind === 'text' && entries[i - 1]?.kind === 'choice') {
      if (entries[i - 1]?.text.trim() === entry.text.trim()) return;
    }
    if (entry.kind === 'choice') {
      blocks.push({
        key: `c${i}`,
        kind: 'choice',
        text: entry.text,
        effects: [],
        scene,
        segments: [],
      });
      return;
    }
    const classified = classifyTags(entry.tags);
    if (classified.scene !== null) scene = classified.scene;
    if (classified.chapter !== null) {
      blocks.push({
        key: `h${i}`,
        kind: 'chapter',
        text: classified.chapter,
        effects: [],
        scene,
        segments: [],
      });
    }
    if (entry.text.trim() === '') return;
    blocks.push({
      key: `t${i}`,
      kind: 'para',
      text: entry.text,
      effects: classified.effects,
      scene,
      segments: parseSegments(entry.text),
    });
  });
  return blocks;
}

/** The scene in effect at the end of the transcript (backdrop, F555). */
export function currentScene(blocks: readonly PlayerBlock[]): string | null {
  return blocks.length === 0 ? null : (blocks[blocks.length - 1]?.scene ?? null);
}

/* ── session lifecycle ─────────────────────────────────────────────────── */

/** Start a fresh run and play to the first stop. */
export function startSession(program: IrProgram, seed: number): Story {
  const story = createStory(program, { seed });
  story.continue();
  return story;
}

/**
 * Restore a run from a serialized save (F544/F549). Exact restore only —
 * a save against changed bytecode throws `SaveError`, and the player offers
 * a restart instead of silently corrupting the playthrough.
 */
export function resumeSession(program: IrProgram, state: unknown): Story {
  validateSaveShape(state);
  const story = createStory(program, { seed: state.seed });
  story.loadState(state);
  if (story.status === 'running' && story.canContinue) story.continue();
  return story;
}

export { SaveError };

/** Take a choice and play to the next stop. */
export function chooseAndContinue(story: Story, index: number): void {
  story.choose(index);
  if (story.status === 'running') story.continue();
}

/** Rewind to just before the history entry at `turn` (F562, via F464). */
export function rewindTo(story: Story, turn: number): Story {
  const rewound = rewindStory(story, turn);
  return rewound;
}

export function saveStateOf(story: Story): StorySaveState {
  return story.saveState();
}

/* ── endings & branch explorer (F567/F568) ─────────────────────────────── */

export interface EndingInfo {
  readonly id: string;
  readonly label: string;
}

/**
 * Identify the ending a finished run reached: an explicit `# ending: name`
 * tag wins, otherwise the final paragraph's slug stands in.
 */
export function endingOf(entries: readonly TranscriptEntry[]): EndingInfo {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry === undefined || entry.kind !== 'text') continue;
    const ending = classifyTags(entry.tags).ending;
    if (ending !== null) return { id: slugify(ending), label: ending };
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry !== undefined && entry.kind === 'text' && entry.text.trim() !== '') {
      return { id: slugify(entry.text), label: entry.text.slice(0, 48) };
    }
  }
  return { id: 'the-end', label: 'The End' };
}

export interface KnotProgress {
  readonly visited: number;
  readonly total: number;
  readonly pct: number;
}

/** % of knots visited this run, from VM visit counts (F567). */
export function knotProgress(program: IrProgram, story: Story): KnotProgress {
  const knots = program.containers.filter((c) => c.kind === 'knot' || c.kind === 'stitch');
  const visits = story.inspect().visits;
  const visited = knots.filter((k) => (visits[k.name] ?? 0) > 0).length;
  const total = knots.length;
  return { visited, total, pct: total === 0 ? 0 : Math.round((visited / total) * 100) };
}

/* ── stat bars (F546) ──────────────────────────────────────────────────── */

export interface StatValue {
  readonly name: string;
  readonly max: number | null;
  readonly value: number;
}

/** Read the current numeric values of the header-declared stats. */
export function statValues(
  story: Story,
  defs: readonly { name: string; max: number | null }[],
): StatValue[] {
  const out: StatValue[] = [];
  for (const def of defs) {
    const value = story.getVariable(def.name);
    if (typeof value === 'number') out.push({ name: def.name, max: def.max, value });
  }
  return out;
}

/* ── plain transcript (F565/F569) ──────────────────────────────────────── */

/** Continuous-text transcript: choices rendered as `> text` lines. */
export function plainTranscript(entries: readonly TranscriptEntry[]): string {
  return entries
    .filter((e) => e.text.trim() !== '')
    .map((e) => (e.kind === 'choice' ? `> ${e.text}` : e.text))
    .join('\n');
}

export type { ChoiceView, IrProgram, Story, StorySaveState, TranscriptEntry, ProgramBuild };
