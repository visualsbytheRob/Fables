/**
 * Tests for the Ink-to-Forge converter (Epic 19 — Story Interop).
 *
 * Each test that produces Forge source MUST assert compile(forge).ok === true
 * to guarantee the primary contract: inkToForge always produces compilable output.
 */

import { describe, expect, it } from 'vitest';
import { compile } from '@fables/forge-dsl';
import { inkToForge } from './ink.js';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function assertCompiles(forge: string): void {
  const result = compile(forge);
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) {
    const msgs = errors.map((d) => `  [${d.code}] ${d.message}`).join('\n');
    throw new Error(`Forge output did not compile:\n${msgs}\n\nSource:\n${forge}`);
  }
  expect(result.ok).toBe(true);
}

// ---------------------------------------------------------------------------
// 1. Empty input
// ---------------------------------------------------------------------------

describe('inkToForge: empty input', () => {
  it('compiles an empty story', () => {
    const { forge, unsupported } = inkToForge('');
    expect(unsupported).toHaveLength(0);
    assertCompiles(forge);
  });

  it('compiles blank-line-only input', () => {
    const { forge } = inkToForge('\n\n\n');
    assertCompiles(forge);
  });
});

// ---------------------------------------------------------------------------
// 2. Simple knot + text + divert
// ---------------------------------------------------------------------------

describe('inkToForge: simple knot + text + divert', () => {
  it('converts a knot with text and -> END', () => {
    const ink = '=== start ===\nYou stand at the crossroads.\n-> END\n';
    const { forge, unsupported } = inkToForge(ink);
    expect(unsupported).toHaveLength(0);
    expect(forge).toContain('=== start ===');
    expect(forge).toContain('You stand at the crossroads.');
    expect(forge).toContain('-> END');
    assertCompiles(forge);
  });

  it('handles == name == (double equals) as a knot header', () => {
    const ink = '== forest ==\nDark trees surround you.\n-> END\n';
    const { forge, unsupported } = inkToForge(ink);
    expect(unsupported).toHaveLength(0);
    expect(forge).toContain('=== forest ===');
    assertCompiles(forge);
  });

  it('converts -> DONE to -> END', () => {
    const ink = '=== end_scene ===\nThe curtain falls.\n-> DONE\n';
    const { forge } = inkToForge(ink);
    expect(forge).toContain('-> END');
    assertCompiles(forge);
  });
});

// ---------------------------------------------------------------------------
// 3. Knot name sanitisation
// ---------------------------------------------------------------------------

describe('inkToForge: knot name sanitisation', () => {
  it('converts "The Forest" to "the_forest"', () => {
    const ink = '=== The Forest ===\nYou enter the dark forest.\n-> END\n';
    const { forge, unsupported } = inkToForge(ink);
    expect(unsupported).toHaveLength(0);
    expect(forge).toContain('=== the_forest ===');
    assertCompiles(forge);
  });

  it('sanitizes knot names with numbers and spaces', () => {
    const ink = '=== Act 2 Scene 1 ===\nThe second act begins.\n-> END\n';
    const { forge } = inkToForge(ink);
    // name is sanitized: "act_2_scene_1" (leading digit removed, underscores collapsed)
    expect(forge).toContain('===');
    assertCompiles(forge);
  });

  it('sanitizes divert targets consistently with knot names', () => {
    // Ink knot names are identifiers; "the_forest" needs no sanitization here,
    // but a name like "TheForest" would be lowercased to "theforest".
    // We test that the same sanitizer is applied to both header and divert.
    const ink =
      '=== TheForest ===\nYou enter.\n-> END\n\n' + '=== start ===\nBegin here.\n-> TheForest\n';
    const { forge, unsupported } = inkToForge(ink);
    expect(unsupported).toHaveLength(0);
    // Both the knot declaration and the divert must use the same sanitized name
    expect(forge).toContain('=== theforest ===');
    expect(forge).toContain('-> theforest');
    assertCompiles(forge);
  });
});

// ---------------------------------------------------------------------------
// 4. Multi-knot story with diverts between knots
// ---------------------------------------------------------------------------

describe('inkToForge: multi-knot story', () => {
  it('compiles a story with multiple knots and cross-knot diverts', () => {
    const ink =
      [
        '=== intro ===',
        'The adventure begins.',
        '-> forest',
        '',
        '=== forest ===',
        'You are in the forest.',
        '-> cave',
        '',
        '=== cave ===',
        'The cave is dark.',
        '-> END',
      ].join('\n') + '\n';

    const { forge, unsupported } = inkToForge(ink);
    expect(unsupported).toHaveLength(0);
    expect(forge).toContain('=== intro ===');
    expect(forge).toContain('=== forest ===');
    expect(forge).toContain('=== cave ===');
    assertCompiles(forge);
  });

  it('sanitizes all knot names and divert targets consistently in a multi-knot story', () => {
    // Using CamelCase knot names to test sanitization (lowercased, no underscores inserted)
    const ink =
      [
        '=== TheStart ===',
        'Our journey begins.',
        '-> DarkForest',
        '',
        '=== DarkForest ===',
        'Shadows everywhere.',
        '-> END',
      ].join('\n') + '\n';

    const { forge } = inkToForge(ink);
    // Both knot header and divert target should use sanitized names
    expect(forge).toContain('=== thestart ===');
    expect(forge).toContain('=== darkforest ===');
    expect(forge).toContain('-> darkforest');
    assertCompiles(forge);
  });
});

// ---------------------------------------------------------------------------
// 5. Once-only choices (* marker)
// ---------------------------------------------------------------------------

describe('inkToForge: once-only choices', () => {
  it('converts a * choice with no divert', () => {
    const ink = '=== menu ===\n* Go north\n* Go south\n-> END\n';
    const { forge, unsupported } = inkToForge(ink);
    expect(unsupported).toHaveLength(0);
    expect(forge).toContain('* Go north');
    expect(forge).toContain('* Go south');
    assertCompiles(forge);
  });

  it('converts a * choice with a trailing divert', () => {
    const ink =
      [
        '=== menu ===',
        '* Go north -> north',
        '* Go south -> south',
        '',
        '=== north ===',
        'You go north.',
        '-> END',
        '',
        '=== south ===',
        'You go south.',
        '-> END',
      ].join('\n') + '\n';

    const { forge, unsupported } = inkToForge(ink);
    expect(unsupported).toHaveLength(0);
    expect(forge).toContain('* [Go north] -> north');
    expect(forge).toContain('* [Go south] -> south');
    assertCompiles(forge);
  });
});

// ---------------------------------------------------------------------------
// 6. Sticky choices (+ marker)
// ---------------------------------------------------------------------------

describe('inkToForge: sticky choices', () => {
  it('converts a + choice with no divert', () => {
    const ink = '=== menu ===\n+ Keep asking\n-> END\n';
    const { forge, unsupported } = inkToForge(ink);
    expect(unsupported).toHaveLength(0);
    expect(forge).toContain('+ Keep asking');
    assertCompiles(forge);
  });

  it('converts a + choice with a trailing divert', () => {
    const ink = ['=== menu ===', '+ Ask again -> menu', '+ Leave -> END'].join('\n') + '\n';

    const { forge, unsupported } = inkToForge(ink);
    expect(unsupported).toHaveLength(0);
    expect(forge).toContain('+ [Ask again] -> menu');
    expect(forge).toContain('+ [Leave] -> END');
    assertCompiles(forge);
  });
});

// ---------------------------------------------------------------------------
// 7. Choice with bracket notation
// ---------------------------------------------------------------------------

describe('inkToForge: bracket notation in choices', () => {
  it('converts [choice-only] text with trailing divert', () => {
    const ink =
      [
        '=== ask ===',
        '* [What is your name?] -> answer',
        '',
        '=== answer ===',
        'My name is Forge.',
        '-> END',
      ].join('\n') + '\n';

    const { forge, unsupported } = inkToForge(ink);
    expect(unsupported).toHaveLength(0);
    expect(forge).toContain('* [What is your name?] -> answer');
    assertCompiles(forge);
  });

  it('converts prefix [choice-only] with divert', () => {
    const ink =
      [
        '=== ask ===',
        '* Tell me [more about the forest.] -> forest',
        '',
        '=== forest ===',
        'The forest is dark.',
        '-> END',
      ].join('\n') + '\n';

    const { forge, unsupported } = inkToForge(ink);
    expect(unsupported).toHaveLength(0);
    assertCompiles(forge);
  });
});

// ---------------------------------------------------------------------------
// 8. Gathers
// ---------------------------------------------------------------------------

describe('inkToForge: gathers', () => {
  it('converts gather lines', () => {
    const ink =
      [
        '=== crossroads ===',
        '* Go left',
        '* Go right',
        '- You reach the other side.',
        '-> END',
      ].join('\n') + '\n';

    const { forge, unsupported } = inkToForge(ink);
    expect(unsupported).toHaveLength(0);
    expect(forge).toContain('- You reach the other side.');
    assertCompiles(forge);
  });
});

// ---------------------------------------------------------------------------
// 9. Line comments stripped
// ---------------------------------------------------------------------------

describe('inkToForge: line comment stripping', () => {
  it('strips // comments from text lines', () => {
    const ink = '=== k ===\nHello world. // this is a comment\n-> END\n';
    const { forge } = inkToForge(ink);
    expect(forge).toContain('Hello world.');
    expect(forge).not.toContain('// this is a comment');
    assertCompiles(forge);
  });

  it('skips a line that is only a comment (emits blank)', () => {
    const ink = '=== k ===\n// just a comment\nActual text.\n-> END\n';
    const { forge } = inkToForge(ink);
    expect(forge).not.toContain('// just a comment');
    expect(forge).toContain('Actual text.');
    assertCompiles(forge);
  });
});

// ---------------------------------------------------------------------------
// 10. Unsupported constructs: VAR / CONST / LIST
// ---------------------------------------------------------------------------

describe('inkToForge: unsupported VAR / CONST / LIST', () => {
  it('drops VAR declarations and records them as unsupported', () => {
    const ink = 'VAR health = 100\n=== start ===\nYou are healthy.\n-> END\n';
    const { forge, unsupported } = inkToForge(ink);
    expect(forge).not.toContain('VAR');
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0]!.construct).toBe('declaration');
    assertCompiles(forge);
  });

  it('drops LIST declarations and records them as unsupported', () => {
    const ink = 'LIST colours = red, green, blue\n=== start ===\nColour!\n-> END\n';
    const { forge, unsupported } = inkToForge(ink);
    expect(forge).not.toContain('LIST');
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0]!.construct).toBe('declaration');
    assertCompiles(forge);
  });
});

// ---------------------------------------------------------------------------
// 11. Unsupported: ~ logic lines
// ---------------------------------------------------------------------------

describe('inkToForge: unsupported ~ logic lines', () => {
  it('drops ~ lines and records them as unsupported', () => {
    const ink = '=== start ===\n~ health = 50\nYou feel weaker.\n-> END\n';
    const { forge, unsupported } = inkToForge(ink);
    expect(forge).not.toContain('~ health');
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0]!.construct).toBe('logic');
    assertCompiles(forge);
  });
});

// ---------------------------------------------------------------------------
// 12. Unsupported: {cond} inline conditionals
// ---------------------------------------------------------------------------

describe('inkToForge: unsupported {cond} inline conditionals', () => {
  it('drops lines with inline conditionals and records them', () => {
    const ink =
      '=== start ===\n{health > 50: You feel fine.|You feel sick.}\nThe road continues.\n-> END\n';
    const { forge, unsupported } = inkToForge(ink);
    expect(forge).not.toContain('{health');
    expect(unsupported.length).toBeGreaterThan(0);
    expect(unsupported[0]!.construct).toBe('inline_conditional');
    assertCompiles(forge);
  });
});

// ---------------------------------------------------------------------------
// 13. Unsupported: stitches
// ---------------------------------------------------------------------------

describe('inkToForge: unsupported stitches', () => {
  it('drops stitch headers and records them as unsupported', () => {
    const ink = '=== forest ===\n= clearing\nYou see a clearing.\n-> END\n';
    const { forge, unsupported } = inkToForge(ink);
    expect(forge).not.toMatch(/^= clearing/m);
    expect(unsupported.some((u) => u.construct === 'stitch')).toBe(true);
    assertCompiles(forge);
  });
});

// ---------------------------------------------------------------------------
// 14. Unsupported: function knots
// ---------------------------------------------------------------------------

describe('inkToForge: unsupported function knots', () => {
  it('drops function knot headers and records them as unsupported', () => {
    const ink = '=== function double ===\n~ return x * 2\n';
    const { forge, unsupported } = inkToForge(ink);
    expect(forge).not.toContain('function double');
    expect(unsupported.some((u) => u.construct === 'function_knot')).toBe(true);
    assertCompiles(forge);
  });
});

// ---------------------------------------------------------------------------
// 15. Mixed: unsupported + supported in one file still compiles
// ---------------------------------------------------------------------------

describe('inkToForge: mixed supported and unsupported constructs', () => {
  it('a story with VAR, LIST, ~ lines, and {cond} still compiles', () => {
    const ink =
      [
        'VAR score = 0',
        'LIST items = sword, shield',
        '',
        '=== start ===',
        '~ score = 10',
        '{score > 5: High score!}',
        'Your adventure begins.',
        '-> cave',
        '',
        '=== cave ===',
        'A dark cave.',
        '-> END',
      ].join('\n') + '\n';

    const { forge, unsupported } = inkToForge(ink);
    expect(unsupported.length).toBeGreaterThan(0);
    // Supported content is preserved
    expect(forge).toContain('=== start ===');
    expect(forge).toContain('Your adventure begins.');
    expect(forge).toContain('=== cave ===');
    assertCompiles(forge);
  });
});
