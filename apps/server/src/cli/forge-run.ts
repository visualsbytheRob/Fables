/**
 * `forge run` — play a Forge story in the terminal (F497).
 *
 * Usage: tsx src/cli/forge-run.ts <story.fable> [--seed N]
 *
 * Compiles the `.fable` source and runs it interactively at the terminal:
 * prints each passage, lists the available choices, reads a selection from
 * stdin, and loops until the story ends. A thin I/O shell over the VM harness —
 * the same engine the PWA player uses, so a story plays identically here.
 */

import { createInterface } from 'node:readline';
import fs from 'node:fs';
import { compile } from '@fables/forge-dsl';
import { createStoryFromSource, type ChoiceView } from '@fables/forge-vm';

export interface ForgeRunIo {
  write: (text: string) => void;
  /** Prompt for a line of input; resolves with the trimmed answer. */
  ask: (prompt: string) => Promise<string>;
}

export interface ForgeRunResult {
  ended: boolean;
  turns: number;
}

/**
 * Drive a story to completion (or quit) over an injected I/O shell. Pure of any
 * real terminal binding so it can be unit-tested with a scripted I/O.
 */
export async function playStory(source: string, io: ForgeRunIo, seed = 1): Promise<ForgeRunResult> {
  const compiled = compile(source);
  if (!compiled.ok) {
    const messages = compiled.diagnostics.map((d) => `  • ${d.message}`).join('\n');
    io.write(`This story does not compile:\n${messages}\n`);
    return { ended: false, turns: 0 };
  }

  const story = createStoryFromSource(source, { seed });
  let turns = 0;

  for (;;) {
    // Advance the story and print whatever it produced this beat.
    const text = story.continue();
    if (text.trim().length > 0) io.write(`\n${text.trim()}\n`);

    const choices = story.choices();
    if (story.status === 'done' || choices.length === 0) {
      io.write('\n— The End —\n');
      return { ended: true, turns };
    }

    // Read a valid selection (re-prompting without re-advancing the story).
    let chosen: number | null = null;
    while (chosen === null) {
      io.write(`\n${renderChoices(choices)}\n`);
      const answer = await io.ask('> ');
      if (answer === 'q' || answer === 'quit') {
        io.write('\nGoodbye.\n');
        return { ended: false, turns };
      }
      const pick = Number(answer);
      if (!Number.isInteger(pick) || pick < 1 || pick > choices.length) {
        io.write(`Please enter a number from 1 to ${choices.length} (or "q" to quit).\n`);
        continue;
      }
      chosen = pick;
    }

    story.choose(choices[chosen - 1]!.index);
    turns += 1;
  }
}

function renderChoices(choices: readonly ChoiceView[]): string {
  return choices.map((c, i) => `  ${i + 1}. ${c.text}`).join('\n');
}

/** Entry point: parse argv, wire stdin/stdout, play. */
export async function main(argv: string[]): Promise<number> {
  const file = argv.find((a) => !a.startsWith('--'));
  if (!file) {
    process.stderr.write('usage: forge run <story.fable> [--seed N]\n');
    return 1;
  }
  const seedArg = argv.find((a) => a.startsWith('--seed='));
  const seed = seedArg ? Number(seedArg.slice('--seed='.length)) : 1;

  let source: string;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch {
    process.stderr.write(`cannot read story file: ${file}\n`);
    return 1;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const io: ForgeRunIo = {
    write: (text) => process.stdout.write(text),
    ask: (prompt) => new Promise((resolve) => rl.question(prompt, (a) => resolve(a.trim()))),
  };
  try {
    const result = await playStory(source, io, Number.isFinite(seed) ? seed : 1);
    return result.ended || result.turns >= 0 ? 0 : 1;
  } finally {
    rl.close();
  }
}

// Run when invoked directly (not when imported by a test).
if (process.argv[1] && process.argv[1].endsWith('forge-run.ts')) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`${(err as Error).message}\n`);
      process.exit(1);
    },
  );
}
