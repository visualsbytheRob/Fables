/**
 * `forge run` terminal player tests (F497).
 */

import { describe, expect, it } from 'vitest';
import { playStory, type ForgeRunIo } from './forge-run.js';

const STORY = `-> crossroads

=== crossroads ===
The path splits.
+ Go left.
  A wolf howls. You flee.
  -> END
+ Go right.
  A clearing opens.
  -> END
`;

/** A scripted I/O shell: answers are dequeued in order; output is captured. */
function scriptedIo(answers: string[]): { io: ForgeRunIo; output: () => string } {
  const out: string[] = [];
  let i = 0;
  return {
    io: {
      write: (t) => out.push(t),
      ask: async () => answers[i++] ?? 'q',
    },
    output: () => out.join(''),
  };
}

describe('playStory', () => {
  it('prints the opening passage and the choices', async () => {
    const { io, output } = scriptedIo(['1']);
    await playStory(STORY, io, 1);
    expect(output()).toContain('The path splits.');
    expect(output()).toContain('1. Go left.');
    expect(output()).toContain('2. Go right.');
  });

  it('follows a choice to the ending', async () => {
    const { io, output } = scriptedIo(['2']);
    const result = await playStory(STORY, io, 1);
    expect(result.ended).toBe(true);
    expect(result.turns).toBe(1);
    expect(output()).toContain('A clearing opens.');
    expect(output()).toContain('— The End —');
  });

  it('re-prompts on an invalid selection', async () => {
    const { io, output } = scriptedIo(['9', '1']);
    const result = await playStory(STORY, io, 1);
    expect(output()).toMatch(/Please enter a number/);
    expect(result.ended).toBe(true);
  });

  it('quits cleanly on "q"', async () => {
    const { io, output } = scriptedIo(['q']);
    const result = await playStory(STORY, io, 1);
    expect(result.ended).toBe(false);
    expect(output()).toContain('Goodbye.');
  });

  it('reports a compile error instead of crashing', async () => {
    const { io, output } = scriptedIo([]);
    const result = await playStory('-> start\n=== start ===\nHello.\n-> nowhere_knot\n', io, 1);
    expect(result.ended).toBe(false);
    expect(output()).toMatch(/does not compile/);
  });
});
