/**
 * Playtest engine (F531–F538): compiles the CURRENT editor buffers with
 * @fables/forge-vm in the browser and drives the story instruction-by-
 * instruction so every transcript line carries source attribution (file:line)
 * from the bytecode source map. Pure module — the pane is just rendering.
 */
import { compileToIr, createStory } from '@fables/forge-vm';
import type { ChoiceView, IrProgram, Story, Value } from '@fables/forge-vm';
import { compile, parse } from '@fables/forge-dsl';
import type { Diagnostic } from '@fables/forge-dsl';
import { fileProviderFor } from '../build.js';

export interface ProgramBuild {
  readonly program: IrProgram | null;
  readonly diagnostics: readonly Diagnostic[];
  readonly error: string | null;
}

/** Compile the in-memory project to runnable bytecode IR (client-side). */
export function compileBuffers(
  files: ReadonlyMap<string, string>,
  entryPath: string,
  transformEntry?: (source: string) => string,
): ProgramBuild {
  const source = files.get(entryPath);
  if (source === undefined) {
    return { program: null, diagnostics: [], error: `entry file "${entryPath}" not found` };
  }
  const text = transformEntry !== undefined ? transformEntry(source) : source;
  const provider = fileProviderFor(files);
  // Front-end pass first: lowering throws on resolution errors, and the pane
  // wants the diagnostics either way.
  const front = compile(text, { fileName: entryPath, files: provider });
  if (!front.ok) {
    return { program: null, diagnostics: front.diagnostics, error: 'story has compile errors' };
  }
  try {
    const { program, diagnostics } = compileToIr(text, {
      fileName: entryPath,
      files: provider,
    });
    return { program, diagnostics, error: null };
  } catch (e) {
    return {
      program: null,
      diagnostics: front.diagnostics,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Jump-to-knot wrapper (F534): inject `-> knot` as the first flow line of the
 * preamble so the story starts at the chosen knot with declarations intact.
 */
export function makeJumpSource(source: string, knot: string): string {
  const { story } = parse(source);
  const at =
    story.preamble.items[0]?.span.start.offset ??
    story.knots[0]?.span.start.offset ??
    source.length;
  const lead = at > 0 && source[at - 1] !== '\n' ? '\n' : '';
  return `${source.slice(0, at)}${lead}-> ${knot}\n${source.slice(at)}`;
}

/** Parse a state-editor input into a story Value (F535). */
export function parseVarInput(text: string): Value {
  const trimmed = text.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  const quoted = /^"(.*)"$/.exec(trimmed);
  return quoted !== null ? (quoted[1] as string) : trimmed;
}

export interface AttributedLine {
  readonly kind: 'text' | 'choice' | 'notice';
  readonly text: string;
  readonly tags?: readonly string[];
  readonly file?: string;
  readonly line?: number;
}

export interface RunOptions {
  readonly seed?: number | string;
  /** Initial VAR overrides applied before the first line runs (F535). */
  readonly vars?: Readonly<Record<string, string>>;
}

export interface RunResult {
  readonly story: Story | null;
  readonly lines: readonly AttributedLine[];
  readonly choices: readonly ChoiceView[];
  readonly status: 'running' | 'choices' | 'done' | 'error';
  /** How many of the requested choices were applied (F532/F533). */
  readonly applied: number;
  /** Index of the first choice that no longer matched, or null. */
  readonly divergedAt: number | null;
  readonly error: string | null;
}

const STEP_GUARD = 500_000;

/** Run to the next stop, attributing each emitted line to its source span. */
function drain(story: Story, program: IrProgram, lines: AttributedLine[]): void {
  let seen = story.transcript().length;
  let steps = 0;
  while (story.status === 'running') {
    if (++steps > STEP_GUARD) throw new Error('step budget exceeded — possible infinite loop');
    const before = story.position();
    story.stepInstruction();
    const log = story.transcript();
    while (seen < log.length) {
      const entry = log[seen++];
      if (entry === undefined || entry.kind !== 'text') continue;
      const span = before.span;
      const file = span === null ? undefined : program.files[span.file];
      lines.push({
        kind: 'text',
        text: entry.text,
        ...(entry.tags !== undefined ? { tags: entry.tags } : {}),
        ...(span !== null && file !== undefined ? { file, line: span.line } : {}),
      });
    }
  }
}

/** Pick a presented choice by exact text, then substring (F532 hot reload). */
export function matchChoice(views: readonly ChoiceView[], text: string): number {
  const exact = views.findIndex((v) => v.text === text);
  if (exact !== -1) return exact;
  return views.findIndex((v) => v.text.includes(text));
}

/**
 * Start (or restart) a run and re-apply a recorded choice path while it stays
 * valid. Stops with a divergence notice at the first choice whose text no
 * longer matches the new build (F532/F533).
 */
export function startRun(
  program: IrProgram,
  options: RunOptions = {},
  path: readonly string[] = [],
): RunResult {
  const lines: AttributedLine[] = [];
  try {
    const story = createStory(program, {
      ...(options.seed !== undefined ? { seed: options.seed } : {}),
    });
    for (const [name, raw] of Object.entries(options.vars ?? {})) {
      if (raw.trim() === '') continue;
      try {
        story.setVariable(name, parseVarInput(raw));
      } catch {
        lines.push({ kind: 'notice', text: `unknown variable "${name}" — override skipped` });
      }
    }
    drain(story, program, lines);
    let applied = 0;
    let divergedAt: number | null = null;
    for (const text of path) {
      if (story.status !== 'choices') break;
      const index = matchChoice(story.choices(), text);
      if (index === -1) {
        divergedAt = applied;
        lines.push({
          kind: 'notice',
          text: `recorded choice "${text}" is no longer available — stopped here`,
        });
        break;
      }
      const view = story.choices()[index] as ChoiceView;
      lines.push({ kind: 'choice', text: view.text });
      story.choose(index);
      applied++;
      drain(story, program, lines);
    }
    return {
      story,
      lines,
      choices: story.status === 'choices' ? story.choices() : [],
      status: story.status,
      applied,
      divergedAt,
      error: null,
    };
  } catch (e) {
    lines.push({ kind: 'notice', text: e instanceof Error ? e.message : String(e) });
    return {
      story: null,
      lines,
      choices: [],
      status: 'error',
      applied: 0,
      divergedAt: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Continue an existing run with one more choice (records nothing itself). */
export function takeChoice(result: RunResult, program: IrProgram, index: number): RunResult {
  if (result.story === null || result.status !== 'choices') return result;
  const story = result.story;
  const lines = [...result.lines];
  try {
    const view = story.choices()[index];
    if (view === undefined) return result;
    lines.push({ kind: 'choice', text: view.text });
    story.choose(index);
    drain(story, program, lines);
    return {
      ...result,
      lines,
      choices: story.status === 'choices' ? story.choices() : [],
      status: story.status,
      applied: result.applied + 1,
    };
  } catch (e) {
    lines.push({ kind: 'notice', text: e instanceof Error ? e.message : String(e) });
    return { ...result, lines, choices: [], status: 'error', error: String(e) };
  }
}

/** Plain-text transcript of a run (scenario baselines, F536/F537). */
export function transcriptOf(lines: readonly AttributedLine[]): string {
  return lines
    .filter((l) => l.kind !== 'notice')
    .map((l) => (l.kind === 'choice' ? `> ${l.text}` : l.text))
    .join('\n');
}
