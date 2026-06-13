/**
 * Story test harness (F498, library core of `forge test`): compile a source
 * string, drive it with a choice script, and get back a transcript plus
 * per-turn records to assert against. Also home of the one-call
 * source→bytecode pipeline used by the server lane.
 */

import type { Diagnostic } from '@fables/forge-dsl';

import { serializeProgram } from './bytecode.js';
import type { CompileToIrOptions } from './lower.js';
import { compileToIr } from './lower.js';
import { assertValidIr } from './validate.js';
import type { ChoiceView, Story, StoryOptions } from './vm.js';
import { createStory } from './vm.js';

/** Compile source → validated IR → bytecode in one call. */
export function compileStory(source: string, options: CompileToIrOptions = {}): Uint8Array {
  const { program } = compileToIr(source, options);
  assertValidIr(program);
  return serializeProgram(program);
}

/** Compile and start a story in one call (test/tooling convenience). */
export function createStoryFromSource(
  source: string,
  options: StoryOptions & CompileToIrOptions = {},
): Story {
  const { program } = compileToIr(source, options);
  assertValidIr(program);
  return createStory(program, options);
}

/** A choice script entry: a presented index, or (part of) the choice text. */
export type ChoiceScriptEntry = number | string;

export interface TurnRecord {
  /** Text produced by this continue() chunk. */
  readonly text: string;
  readonly tags: readonly string[];
  /** Choices presented after the chunk (empty when the story ended). */
  readonly choices: readonly string[];
  /** The choice the script took, if any. */
  readonly chose?: string;
}

export interface RunStoryResult {
  readonly story: Story;
  readonly status: Story['status'];
  readonly turns: readonly TurnRecord[];
  /** Full playthrough transcript (`> ` marks chosen options). */
  readonly transcript: string;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Run a story from source with a scripted list of choices. Each script entry
 * picks by index or by (sub)string match on the presented text; the run
 * fails fast with a helpful error when a scripted choice cannot be matched.
 */
export function runStory(
  source: string,
  choices: readonly ChoiceScriptEntry[] = [],
  options: StoryOptions & CompileToIrOptions = {},
): RunStoryResult {
  const { program, diagnostics } = compileToIr(source, options);
  assertValidIr(program);
  const story = createStory(program, options);
  const turns: TurnRecord[] = [];
  let script = 0;

  for (let guard = 0; guard < 10_000; guard++) {
    const text = story.continue();
    const tags = [...story.currentTags];
    if (story.status !== 'choices') {
      turns.push({ text, tags, choices: [] });
      break;
    }
    const views = story.choices();
    if (script >= choices.length) {
      turns.push({ text, tags, choices: views.map((v) => v.text) });
      break;
    }
    const entry = choices[script++] as ChoiceScriptEntry;
    const index = resolveChoice(entry, views);
    turns.push({
      text,
      tags,
      choices: views.map((v) => v.text),
      chose: (views[index] as ChoiceView).text,
    });
    story.choose(index);
  }

  return {
    story,
    status: story.status,
    turns,
    transcript: story.exportTranscript(),
    diagnostics,
  };
}

function resolveChoice(entry: ChoiceScriptEntry, views: readonly ChoiceView[]): number {
  if (typeof entry === 'number') {
    if (entry < 0 || entry >= views.length) {
      throw new Error(
        `scripted choice index ${entry} out of range; available: ${views.map((v, i) => `[${i}] ${v.text}`).join(', ')}`,
      );
    }
    return entry;
  }
  const exact = views.findIndex((v) => v.text === entry);
  if (exact !== -1) return exact;
  const partial = views.findIndex((v) => v.text.includes(entry));
  if (partial !== -1) return partial;
  throw new Error(
    `scripted choice "${entry}" not found; available: ${views.map((v, i) => `[${i}] ${v.text}`).join(', ')}`,
  );
}
