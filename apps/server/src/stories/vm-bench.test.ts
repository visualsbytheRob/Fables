import { performance } from 'node:perf_hooks';
import { compile } from '@fables/forge-dsl';
import { compileToIr, createStory, serializeProgram } from '@fables/forge-vm';
import { describe, expect, it } from 'vitest';

/**
 * F499 — VM performance benchmark suite, server-lane edition: compile a
 * generated ~2,000-line story and play it end to end with scripted choices.
 * Budgets are deliberately generous (CI machines vary wildly); the point is
 * catching order-of-magnitude regressions, not micro-tuning.
 */

const KNOTS = 250; // 8 lines per knot + prologue ≈ 2,000 lines

function generateEpic(knots: number): string {
  const lines: string[] = ['# title: The Generated Epic', '', 'VAR score = 0', '-> knot_0'];
  for (let i = 0; i < knots; i++) {
    const next = i + 1 < knots ? `knot_${i + 1}` : 'END';
    lines.push(
      `=== knot_${i} ===`,
      `Chamber ${i}: dust motes drift through pale light and the score stands at {score}.`,
      `~ score = score + ${(i % 7) + 1}`,
      `+ Press on through chamber ${i}.`,
      `  You advance with quiet resolve.`,
      `  -> ${next}`,
      `+ Linger in chamber ${i}.`,
      `  The silence settles around you.`,
      `  -> ${next}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

describe('VM performance benchmark (F499)', () => {
  const source = generateEpic(KNOTS);

  it('generates a story of roughly 2k lines', () => {
    const lineCount = source.split('\n').length;
    expect(lineCount).toBeGreaterThan(1900);
    expect(lineCount).toBeLessThan(2400);
  });

  it('compiles front-end + bytecode within budget', () => {
    const t0 = performance.now();
    const front = compile(source, { fileName: 'epic.fable' });
    expect(front.ok).toBe(true);

    const { program } = compileToIr(source, { fileName: 'epic.fable' });
    const bytecode = serializeProgram(program);
    const elapsed = performance.now() - t0;

    expect(bytecode.byteLength).toBeGreaterThan(0);
    // Full pipeline (parse → resolve → check → lower → serialize), twice the
    // front-end work: anything past 10s is a real regression, not noise.
    expect(elapsed).toBeLessThan(10_000);
  });

  it('plays 250 scripted turns within the ops/turn budget', () => {
    const { program } = compileToIr(source, { fileName: 'epic.fable' });
    const story = createStory(program, { seed: 99 });

    const t0 = performance.now();
    let turns = 0;
    let text = story.continue();
    for (let guard = 0; guard < KNOTS + 10 && story.status === 'choices'; guard++) {
      story.choose(turns % 2); // alternate corridors
      text += story.continue();
      turns++;
    }
    const elapsed = performance.now() - t0;

    expect(story.status).toBe('done');
    expect(turns).toBe(KNOTS);
    expect(text).toContain('Chamber 249');

    const msPerTurn = elapsed / turns;
    const turnsPerSecond = (turns / elapsed) * 1000;
    // Budget: a turn (choose + continue across a full knot) must average well
    // under 20ms — interactive play needs ~1ms; 20ms flags a 20x regression
    // while staying safe on slow CI runners.
    expect(msPerTurn).toBeLessThan(20);
    expect(turnsPerSecond).toBeGreaterThan(50);
  });

  it('keeps save-state serialization cheap at depth (GC pressure proxy)', () => {
    const { program } = compileToIr(source, { fileName: 'epic.fable' });
    const story = createStory(program, { seed: 7 });
    story.continue();
    for (let i = 0; i < 100 && story.status === 'choices'; i++) {
      story.choose(0);
      story.continue();
    }

    const t0 = performance.now();
    let bytes = 0;
    for (let i = 0; i < 50; i++) {
      bytes += JSON.stringify(story.saveState()).length;
    }
    const elapsed = performance.now() - t0;

    expect(bytes).toBeGreaterThan(0);
    // 50 deep-state serializations in under 5s — autosave-on-every-choice
    // (F463) must never become the player's bottleneck.
    expect(elapsed).toBeLessThan(5_000);
  });
});
