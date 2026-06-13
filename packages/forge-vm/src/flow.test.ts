import { describe, expect, it } from 'vitest';

import { createStoryFromSource, runStory } from './harness.js';
import { fixture } from './test-helpers.js';

/** F451–F460: choices and control flow, including torture tests. */

describe('once-only and sticky choices (F451/F452)', () => {
  it('consumes * choices and keeps + choices', () => {
    const story = createStoryFromSource(fixture('03-choices-basic'));
    story.continue();
    expect(story.choices()).toHaveLength(3);
    story.choose(0);
    story.continue();
    expect(story.choices().map((c) => c.text)).toEqual(['Follow the sunny ridge.', 'Sit and rest a while.']);
    story.choose(1); // sticky
    story.continue();
    expect(story.choices().map((c) => c.text)).toEqual(['Follow the sunny ridge.', 'Sit and rest a while.']);
  });

  it('consumption is tracked in state and survives save/load', () => {
    const story = createStoryFromSource(fixture('03-choices-basic'));
    story.continue();
    story.choose(0);
    story.continue();
    const json = JSON.parse(JSON.stringify(story.saveState())) as unknown;
    const fresh = createStoryFromSource(fixture('03-choices-basic'));
    fresh.loadState(json);
    expect(fresh.choices().map((c) => c.text)).toEqual(['Follow the sunny ridge.', 'Sit and rest a while.']);
  });
});

describe('conditional choices are lazy (F453)', () => {
  it('re-evaluates conditions at every presentation', () => {
    const src = `VAR brave = false
-> camp
=== camp ===
The fire crackles.
+ {brave} Charge into the dark.
  -> END
+ Poke the fire.
  ~ brave = true
  -> camp
`;
    const story = createStoryFromSource(src);
    story.continue();
    expect(story.choices().map((c) => c.text)).toEqual(['Poke the fire.']);
    story.choose(0);
    story.continue();
    expect(story.choices().map((c) => c.text)).toEqual(['Charge into the dark.', 'Poke the fire.']);
  });

  it('multiple condition groups AND together', () => {
    const src = `VAR a = true
VAR b = false
-> spot
=== spot ===
Quiet.
+ {a} {b} Both.
  -> END
+ Flip b.
  ~ b = true
  -> spot
`;
    const story = createStoryFromSource(src);
    story.continue();
    expect(story.choices().map((c) => c.text)).toEqual(['Flip b.']);
    story.choose(0);
    story.continue();
    expect(story.choices().map((c) => c.text)).toEqual(['Both.', 'Flip b.']);
  });
});

describe('fallback choices (F454)', () => {
  it('auto-takes the fallback when all real choices are consumed', () => {
    const r = runStory(fixture('18-fallback-choice'), ['honeycomb', 'fish']);
    expect(r.status).toBe('done');
    expect(r.transcript).toContain('Nothing is left but crumbs and regret.');
    // The fallback never appears as a visible option.
    for (const turn of r.turns) {
      expect(turn.choices.every((c) => c.length > 0)).toBe(true);
    }
  });

  it('errors clearly when choices run out with no fallback', () => {
    const src = '-> room\n=== room ===\nBare walls.\n* Leave.\n  -> room\n';
    expect(() => runStory(src, [0])).toThrow(/ran out of content/);
  });
});

describe('gathers (F455)', () => {
  it('re-converges branched flow at the gather', () => {
    const r = runStory(fixture('06-gathers-labels'), ['Dig']);
    expect(r.transcript).toBe(
      'Moonlight pools in the clearing.\n> Dig at the cold earth.\nDig at the cold earth.\nWhatever you did, the night swallows it.',
    );
  });

  it('labeled gathers count visits usable in conditions', () => {
    const r = runStory(fixture('06-gathers-labels'), ['Howl']);
    expect(r.transcript).toContain('Your throat is still sore.');
    expect(r.story.visits('clearing.gathered')).toBe(1);
    expect(r.story.visits('clearing.howl')).toBe(1);
  });
});

describe('deep nesting (F456)', () => {
  it('handles 4+ levels of nested choices and gathers', () => {
    const src = `-> maze
=== maze ===
Level zero.
* One.
  * * Two.
    * * * Three.
      * * * * Four.
        Deepest.
        - - - - Back at four.
      - - - Back at three.
    - - Back at two.
  - Back at one.
- Out of the maze.
-> END
`;
    const r = runStory(src, ['One', 'Two', 'Three', 'Four']);
    expect(r.status).toBe('done');
    expect(r.transcript).toBe(
      [
        'Level zero.',
        '> One.',
        'One.',
        '> Two.',
        'Two.',
        '> Three.',
        'Three.',
        '> Four.',
        'Four.',
        'Deepest.',
        'Back at four.',
        'Back at three.',
        'Back at two.',
        'Back at one.',
        'Out of the maze.',
      ].join('\n'),
    );
  });
});

describe('choice text vs output split (F457)', () => {
  it('shows bracket text only in the menu and suffix only in output', () => {
    const story = createStoryFromSource(fixture('04-choice-brackets'));
    story.continue();
    expect(story.choices().map((c) => c.text)).toEqual(['Lunge at the salmon', 'Wait patiently']);
    story.choose(1);
    expect(story.continue()).toBe('Wait with the patience of winter.\nThe salmon drifts closer.\n');
  });

  it('empty brackets suppress the choice text entirely in output', () => {
    const src = '-> q\n=== q ===\nAsk.\n* "Who goes there?" [] Silence answers.\n  -> END\n';
    const story = createStoryFromSource(src);
    story.continue();
    expect(story.choices()[0]?.text).toBe('"Who goes there?"');
    story.choose(0);
    expect(story.continue()).toBe('"Who goes there?" Silence answers.\n');
  });
});

describe('labeled choices in conditions (F458)', () => {
  it('reads label counts from other knots by qualified name', () => {
    const src = `-> gate
=== gate ===
A toll gate.
* (bribe) Slip a coin.
* Walk through.
- -> hall
=== hall ===
{gate.bribe > 0: The guard winks.|The guard scowls.}
-> END
`;
    expect(runStory(src, ['coin']).transcript).toContain('The guard winks.');
    expect(runStory(src, ['Walk']).transcript).toContain('The guard scowls.');
  });

  it('choice labels gate later content', () => {
    const src = `-> yard
=== yard ===
A dog watches.
* (pet) Pet the dog.
* (ignore) Walk past.
- {pet > 0: The dog follows you.|The dog whines.}
-> END
`;
    expect(runStory(src, ['Pet']).transcript).toContain('The dog follows you.');
    expect(runStory(src, ['Walk']).transcript).toContain('The dog whines.');
  });
});

describe('divert targets as values (F459)', () => {
  it('diverts through a variable holding a TARGET', () => {
    const src = `VAR dest = TARGET("garden")
-> hub
=== hub ===
Choosing a door.
~ dest = TARGET("cellar")
-> dest
=== garden ===
Green light.
-> END
=== cellar ===
Cold dark.
-> END
`;
    expect(runStory(src).transcript).toBe('Choosing a door.\nCold dark.');
  });

  it('temp variables can hold divert targets too', () => {
    const src = `-> hub
=== hub ===
~ temp door = TARGET("garden")
-> door
=== garden ===
Green light.
-> END
`;
    expect(runStory(src).transcript).toBe('Green light.');
  });

  it('diverting to a non-target value is a runtime error', () => {
    const src = 'VAR dest = 42\n-> hub\n=== hub ===\n-> dest\n';
    expect(() => runStory(src)).toThrow(/cannot divert/);
  });
});

describe('control-flow torture (F460)', () => {
  it('loops with exits, read counts, and sticky choices interleaved', () => {
    const src = `VAR laps = 0
-> track
=== track ===
{track == 1: The race begins.}
~ laps = laps + 1
+ {laps < 4} Run another lap.
  -> track
+ {laps >= 4} Collapse at the finish.
  -> finish
=== finish ===
{laps} laps run, {track} times around the track.
-> END
`;
    const r = runStory(src, [0, 0, 0, 0]);
    expect(r.status).toBe('done');
    expect(r.transcript).toContain('4 laps run, 4 times around the track.');
  });

  it('tunnels interleaved with choices inside the tunnel', () => {
    const src = `-> day
=== day ===
Morning.
-> errand ->
Evening.
-> END
=== errand ===
At the market.
+ Buy fish.
+ Buy bread.
- Heading home.
->->
`;
    const r = runStory(src, ['bread']);
    expect(r.transcript).toBe('Morning.\nAt the market.\n> Buy bread.\nBuy bread.\nHeading home.\nEvening.');
  });

  it('a weave that exhausts a loop through fallbacks terminates', () => {
    const src = `VAR n = 0
-> mill
=== mill ===
~ n = n + 1
* First grain.
  -> mill
* Second grain.
  -> mill
* -> done_milling
=== done_milling ===
Milled {n} times.
-> END
`;
    const r = runStory(src, [0, 0]);
    expect(r.transcript).toContain('Milled 3 times.');
    expect(r.status).toBe('done');
  });

  it('glue across choices and tunnels stays coherent', () => {
    const src = `-> talk
=== talk ===
The wolf says: <>
-> aside ->
"hello."
-> END
=== aside ===
(quietly) <>
->->
`;
    expect(runStory(src).transcript).toBe('The wolf says: (quietly) "hello."');
  });
});
