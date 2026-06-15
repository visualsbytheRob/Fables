/**
 * Tests for the Twee 3 → Forge converter (Epic 19 - Story Interop).
 *
 * Each test calls compile() on the returned forge string and asserts ok === true
 * (no error-severity diagnostics), ensuring PRIMARY GUARANTEE holds.
 */

import { describe, expect, it } from 'vitest';
import { compile } from '@fables/forge-dsl';
import { tweeToForge } from './twee.js';
import type { TweeConversion } from './twee.js';

// ---------------------------------------------------------------------------
// Helper: assert compile success
// ---------------------------------------------------------------------------

function assertCompiles(result: TweeConversion, label: string): void {
  const cr = compile(result.forge, { fileName: `${label}.fable` });
  if (!cr.ok) {
    const errors = cr.diagnostics
      .filter((d) => d.severity === 'error')
      .map((d) => `[${d.code}] ${d.message}`)
      .join('\n');
    throw new Error(
      `compile() failed for "${label}":\n${errors}\n\nForge source:\n${result.forge}`,
    );
  }
  expect(cr.ok).toBe(true);
}

// ---------------------------------------------------------------------------
// 1. Empty input
// ---------------------------------------------------------------------------

describe('empty input', () => {
  it('returns a compilable stub for empty source', () => {
    const result = tweeToForge('');
    assertCompiles(result, 'empty');
    expect(result.forge).toBeTruthy();
  });

  it('returns null start for empty source', () => {
    const result = tweeToForge('');
    expect(result.start).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Two-passage story with a [[link]]
// ---------------------------------------------------------------------------

const TWO_PASSAGE = `:: Start
You stand at a crossroads.
[[Go north->North Woods]]

:: North Woods
You enter the forest.
`;

describe('two-passage story with link', () => {
  it('produces compilable Forge', () => {
    const result = tweeToForge(TWO_PASSAGE);
    assertCompiles(result, 'two-passage');
  });

  it('emits start knot first', () => {
    const result = tweeToForge(TWO_PASSAGE);
    expect(result.passages[0]).toBe('start');
  });

  it('includes both passages', () => {
    const result = tweeToForge(TWO_PASSAGE);
    expect(result.passages).toContain('start');
    expect(result.passages).toContain('north_woods');
  });

  it('sets start to sanitized start passage', () => {
    const result = tweeToForge(TWO_PASSAGE);
    expect(result.start).toBe('start');
  });

  it('contains a choice divert in forge output', () => {
    const result = tweeToForge(TWO_PASSAGE);
    expect(result.forge).toContain('-> north_woods');
  });
});

// ---------------------------------------------------------------------------
// 3. All three arrow forms
// ---------------------------------------------------------------------------

const ALL_LINK_FORMS = `:: Hub
[[Display->Target A]]
[[Display B|Target B]]
[[Target C<-Display C]]

:: Target A
End A.

:: Target B
End B.

:: Target C
End C.
`;

describe('all three arrow forms', () => {
  it('compiles cleanly', () => {
    const result = tweeToForge(ALL_LINK_FORMS);
    assertCompiles(result, 'all-link-forms');
  });

  it('resolves arrow-right form', () => {
    const result = tweeToForge(ALL_LINK_FORMS);
    expect(result.forge).toContain('-> target_a');
  });

  it('resolves pipe form', () => {
    const result = tweeToForge(ALL_LINK_FORMS);
    expect(result.forge).toContain('-> target_b');
  });

  it('resolves arrow-left form', () => {
    const result = tweeToForge(ALL_LINK_FORMS);
    expect(result.forge).toContain('-> target_c');
  });

  it('includes all four knots', () => {
    const result = tweeToForge(ALL_LINK_FORMS);
    expect(result.passages).toContain('hub');
    expect(result.passages).toContain('target_a');
    expect(result.passages).toContain('target_b');
    expect(result.passages).toContain('target_c');
  });
});

// ---------------------------------------------------------------------------
// 4. Simple [[Target]] form (no display text)
// ---------------------------------------------------------------------------

const SIMPLE_LINK = `:: Entry
[[Forest]]

:: Forest
Trees everywhere.
`;

describe('simple [[Target]] link form', () => {
  it('compiles cleanly', () => {
    const result = tweeToForge(SIMPLE_LINK);
    assertCompiles(result, 'simple-link');
  });

  it('resolves target correctly', () => {
    const result = tweeToForge(SIMPLE_LINK);
    expect(result.forge).toContain('-> forest');
  });
});

// ---------------------------------------------------------------------------
// 5. Passage names needing sanitization
// ---------------------------------------------------------------------------

const FUNKY_NAMES = `:: The Old House
You see an old house.
[[Go Inside->Inside the House!]]

:: Inside the House!
It is dark inside.
`;

describe('passage name sanitization', () => {
  it('compiles cleanly', () => {
    const result = tweeToForge(FUNKY_NAMES);
    assertCompiles(result, 'funky-names');
  });

  it('sanitizes The Old House to the_old_house', () => {
    const result = tweeToForge(FUNKY_NAMES);
    expect(result.passages).toContain('the_old_house');
  });

  it('sanitizes Inside the House! correctly', () => {
    const result = tweeToForge(FUNKY_NAMES);
    expect(result.passages).toContain('inside_the_house');
  });

  it('emits correct knot header', () => {
    const result = tweeToForge(FUNKY_NAMES);
    expect(result.forge).toContain('=== the_old_house ===');
    expect(result.forge).toContain('=== inside_the_house ===');
  });
});

// ---------------------------------------------------------------------------
// 6. Collision de-duplication
// ---------------------------------------------------------------------------

const COLLISION = `:: Old House
Room one.

:: Old-House
Room two.

:: Old.House
Room three.
`;

describe('collision de-duplication', () => {
  it('compiles cleanly', () => {
    const result = tweeToForge(COLLISION);
    assertCompiles(result, 'collision');
  });

  it('produces distinct knot names', () => {
    const result = tweeToForge(COLLISION);
    const names = result.passages;
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('uses _2 suffix for first collision', () => {
    const result = tweeToForge(COLLISION);
    expect(result.passages.some((n) => n.includes('_2'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Macros dropped and reported
// ---------------------------------------------------------------------------

const WITH_MACROS = `:: Intro
<<set $gold to 100>>
You are a traveler.
<<if $gold gt 50>>You are rich!<</if>>
Keep walking.

:: End
Farewell.
`;

describe('macros dropped and reported', () => {
  it('compiles cleanly despite macros', () => {
    const result = tweeToForge(WITH_MACROS);
    assertCompiles(result, 'with-macros');
  });

  it('reports unsupported macros', () => {
    const result = tweeToForge(WITH_MACROS);
    expect(result.unsupported.length).toBeGreaterThan(0);
  });

  it('all reported macros reference the correct passage', () => {
    const result = tweeToForge(WITH_MACROS);
    for (const u of result.unsupported) {
      expect(u.passage).toBe('Intro');
      expect(u.macro.startsWith('<<')).toBe(true);
    }
  });

  it('preserves prose text after stripping macros', () => {
    const result = tweeToForge(WITH_MACROS);
    expect(result.forge).toContain('You are a traveler');
    expect(result.forge).toContain('Keep walking');
  });
});

// ---------------------------------------------------------------------------
// 8. StoryData with a start field honored
// ---------------------------------------------------------------------------

const WITH_STORY_DATA = `:: StoryTitle
My Adventure

:: StoryData
{
  "ifid": "D674C58C-DEFA-4F70-B7A2-27742230C950",
  "format": "SugarCube",
  "start": "Chapter One"
}

:: Prologue
This is the prologue.

:: Chapter One
The adventure begins!
[[Go forward->Chapter Two]]

:: Chapter Two
You made it!
`;

describe('StoryData start field honored', () => {
  it('compiles cleanly', () => {
    const result = tweeToForge(WITH_STORY_DATA);
    assertCompiles(result, 'story-data');
  });

  it('sets start to chapter_one', () => {
    const result = tweeToForge(WITH_STORY_DATA);
    expect(result.start).toBe('chapter_one');
  });

  it('emits chapter_one as the first passage', () => {
    const result = tweeToForge(WITH_STORY_DATA);
    expect(result.passages[0]).toBe('chapter_one');
  });

  it('does not emit StoryTitle or StoryData as knots', () => {
    const result = tweeToForge(WITH_STORY_DATA);
    expect(result.forge).not.toContain('=== storytitle ===');
    expect(result.forge).not.toContain('=== storydata ===');
    expect(result.passages).not.toContain('storytitle');
    expect(result.passages).not.toContain('storydata');
  });
});

// ---------------------------------------------------------------------------
// 9. StoryTitle / StoryData not emitted as knots (explicit check)
// ---------------------------------------------------------------------------

const SPECIAL_PASSAGES = `:: StoryTitle
The Test

:: StoryData
{"ifid": "TEST"}

:: StoryStylesheet
body { color: red; }

:: StoryScript
console.log("hi");

:: Real Passage
This is real content.
`;

describe('special passages not emitted', () => {
  it('compiles cleanly', () => {
    const result = tweeToForge(SPECIAL_PASSAGES);
    assertCompiles(result, 'special-passages');
  });

  it('does not include StoryTitle/StoryData/StoryStylesheet/StoryScript as knots', () => {
    const result = tweeToForge(SPECIAL_PASSAGES);
    const names = result.passages;
    expect(names).not.toContain('storytitle');
    expect(names).not.toContain('storydata');
    expect(names).not.toContain('storystylesheet');
    expect(names).not.toContain('storyscript');
  });

  it('only emits the real passage', () => {
    const result = tweeToForge(SPECIAL_PASSAGES);
    expect(result.passages).toContain('real_passage');
    expect(result.passages.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 10. Dangling link target: stub knot created
// ---------------------------------------------------------------------------

const DANGLING_LINK = `:: Start
You see a door.
[[Open it->Secret Room]]
`;

describe('dangling link target handled', () => {
  it('compiles cleanly (stub knot created)', () => {
    const result = tweeToForge(DANGLING_LINK);
    assertCompiles(result, 'dangling-link');
  });

  it('emits a stub knot for the dangling target', () => {
    const result = tweeToForge(DANGLING_LINK);
    expect(result.forge).toContain('=== secret_room ===');
  });

  it('stub knot diverts to END', () => {
    const result = tweeToForge(DANGLING_LINK);
    // The stub is: === secret_room ===\n-> END
    const forgeLines = result.forge.split('\n');
    const stubIdx = forgeLines.findIndex((l) => l === '=== secret_room ===');
    expect(stubIdx).toBeGreaterThanOrEqual(0);
    expect(forgeLines[stubIdx + 1]).toBe('-> END');
  });
});

// ---------------------------------------------------------------------------
// 11. Passage with no links ends with -> END
// ---------------------------------------------------------------------------

const NO_LINKS = `:: Alone
Just text, no links here.
`;

describe('passage with no links', () => {
  it('compiles cleanly', () => {
    const result = tweeToForge(NO_LINKS);
    assertCompiles(result, 'no-links');
  });

  it('ends with -> END', () => {
    const result = tweeToForge(NO_LINKS);
    expect(result.forge).toContain('-> END');
  });
});

// ---------------------------------------------------------------------------
// 12. Passage name starting with a digit gets _ prefix
// ---------------------------------------------------------------------------

const DIGIT_NAME = `:: 1st Room
You are in room one.
[[Next->2nd Room]]

:: 2nd Room
Room two.
`;

describe('passage name starting with digit', () => {
  it('compiles cleanly', () => {
    const result = tweeToForge(DIGIT_NAME);
    assertCompiles(result, 'digit-name');
  });

  it('prefixes digit-leading names with underscore', () => {
    const result = tweeToForge(DIGIT_NAME);
    // 1st_room -> _1st_room (starts with digit)
    expect(result.passages.every((p) => /^[a-z_]/.test(p))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 13. Tags and metadata in passage header are ignored
// ---------------------------------------------------------------------------

const WITH_TAGS = `:: Forest [dark scary] {"position":"100,200"}
Dark trees surround you.
[[Run->Safety]]

:: Safety
You escape.
`;

describe('passage header tags and metadata ignored', () => {
  it('compiles cleanly', () => {
    const result = tweeToForge(WITH_TAGS);
    assertCompiles(result, 'with-tags');
  });

  it('extracts passage name correctly despite tags', () => {
    const result = tweeToForge(WITH_TAGS);
    expect(result.passages).toContain('forest');
  });
});

// ---------------------------------------------------------------------------
// 14. Harlowe-style hook macros are also dropped and reported
// ---------------------------------------------------------------------------

const HARLOWE = `:: Harlowe Passage
(set: $x to 5)
You wake up in a forest.
(if: $x > 3)[You feel strong.]
Move on.

:: Exit
Goodbye.
`;

describe('Harlowe hook macros', () => {
  it('compiles cleanly', () => {
    const result = tweeToForge(HARLOWE);
    assertCompiles(result, 'harlowe');
  });

  it('reports Harlowe macros as unsupported', () => {
    const result = tweeToForge(HARLOWE);
    // Harlowe macros like (set: ...) and (if: ...) should be reported
    expect(result.unsupported.length).toBeGreaterThan(0);
  });

  it('preserves prose text after stripping Harlowe macros', () => {
    const result = tweeToForge(HARLOWE);
    expect(result.forge).toContain('You wake up in a forest');
    expect(result.forge).toContain('Move on');
  });
});

// ---------------------------------------------------------------------------
// 15. Mixed inline links and prose
// ---------------------------------------------------------------------------

const MIXED_INLINE = `:: Mixed
You see a [[door]] and a [[window->Garden]] in the room.
The weather is fine.
`;

describe('mixed inline links and prose', () => {
  it('compiles cleanly', () => {
    const result = tweeToForge(MIXED_INLINE);
    assertCompiles(result, 'mixed-inline');
  });

  it('extracts both links from a single line', () => {
    const result = tweeToForge(MIXED_INLINE);
    // Both door and garden should appear as choice targets
    expect(result.forge).toContain('-> door');
    expect(result.forge).toContain('-> garden');
  });
});
