import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';

/**
 * Performance benchmark (F396): a 10k-line generated story must compile well
 * under budget. Target is < 2s on a dev machine; the assertion allows 2x for
 * slow CI containers while still catching order-of-magnitude regressions.
 */

function generateBigStory(knots: number, linesPerKnot: number): string {
  const lines: string[] = ['# title: benchmark', 'VAR pace = 0', '-> knot_0'];
  for (let k = 0; k < knots; k++) {
    lines.push(`=== knot_${k} ===`);
    for (let i = 0; i < linesPerKnot - 8; i++) {
      lines.push(`The long road winds on, mile ${i}, with {pace} steps behind {pace > ${i}: and hope ahead|and dust behind}.`);
    }
    lines.push('~ pace = pace + 1');
    lines.push(`* Press on [quickly] without rest. -> knot_${(k + 1) % knots}`);
    lines.push(`* (camp_${k}) Make camp.`);
    lines.push(`  {&An owl calls.|The fire pops.|Rain taps the canvas.}`);
    lines.push(`  -> knot_${(k + 1) % knots}`);
    lines.push('+ Check the map.');
    lines.push(`  -> knot_${k}`);
    lines.push(`- The night passes. -> knot_${(k + 1) % knots}`);
  }
  return lines.join('\n') + '\n';
}

describe('performance (F396)', () => {
  it('compiles a 10k-line story in under 4s (2s budget, 2x CI margin)', () => {
    const source = generateBigStory(100, 100);
    const lineCount = source.split('\n').length;
    expect(lineCount).toBeGreaterThanOrEqual(10_000);

    const startedAt = performance.now();
    const result = compile(source);
    const elapsedMs = performance.now() - startedAt;

    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);

    console.log(`[bench] ${lineCount} lines compiled in ${elapsedMs.toFixed(0)}ms`);
    expect(elapsedMs).toBeLessThan(4000);
  });
});
