import { describe, expect, it } from 'vitest';

import type { Value } from './values.js';
import { createStoryFromSource, runStory } from './harness.js';

/** F481–F490: external functions, effects, sandboxing, async, and auditing. */

describe('external function registry (F481)', () => {
  it('calls registered host functions with story values', () => {
    const calls: Value[][] = [];
    const r = runStory('Weather: {WEATHER("forest", 3)}.\n-> END\n', [], {
      functions: {
        WEATHER: (...args) => {
          calls.push(args);
          return 'drizzle';
        },
      },
    });
    expect(r.transcript).toBe('Weather: drizzle.');
    expect(calls).toEqual([['forest', 3]]);
  });

  it('functions can be registered after creation', () => {
    const story = createStoryFromSource('Total: {SUM(2, 3)}.\n-> END\n');
    story.registerFunction('SUM', (a, b) => (a as number) + (b as number));
    expect(story.continue()).toBe('Total: 5.\n');
  });
});

describe('sandboxing (F485)', () => {
  it('unregistered functions are unreachable and produce error values', () => {
    const r = runStory('Hack: {DELETE_EVERYTHING()}.\n-> END\n');
    expect(r.transcript).toBe('Hack: (error: external function "DELETE_EVERYTHING" is not registered).');
    const denied = r.story.auditLog().find((e) => e.name === 'DELETE_EVERYTHING');
    expect(denied?.ok).toBe(false);
    expect(denied?.error).toContain('not registered');
  });
});

describe('effect ops (F482)', () => {
  it('dispatches play-audio/set-theme/vibrate/pause as opaque host commands', () => {
    const effects: { name: string; args: readonly Value[] }[] = [];
    const src = `~ PLAY_AUDIO("howl.ogg")
~ SET_THEME("midnight")
~ VIBRATE(40)
~ PAUSE(1200)
Done.
-> END
`;
    const r = runStory(src, [], { host: { onEffect: (name, args) => effects.push({ name, args }) } });
    expect(r.transcript).toBe('Done.');
    expect(effects).toEqual([
      { name: 'PLAY_AUDIO', args: ['howl.ogg'] },
      { name: 'SET_THEME', args: ['midnight'] },
      { name: 'VIBRATE', args: [40] },
      { name: 'PAUSE', args: [1200] },
    ]);
  });

  it('effects without a host are inert no-ops', () => {
    expect(runStory('~ VIBRATE(10)\nStill fine.\n-> END\n').transcript).toBe('Still fine.');
  });
});

describe('knowledge effects (F483/F484)', () => {
  it('@journal(...) emits a JOURNAL effect from story flow', () => {
    const effects: { name: string; args: readonly Value[] }[] = [];
    const src = '-> camp\n=== camp ===\nYou make camp. @journal(Made camp by the river)\n-> END\n';
    const r = runStory(src, [], { host: { onEffect: (name, args) => effects.push({ name, args }) } });
    expect(r.transcript).toBe('You make camp.');
    expect(effects).toEqual([{ name: 'JOURNAL', args: ['Made camp by the river'] }]);
  });

  it('ENTITY_SET mutations route through the host', () => {
    const writes: (readonly Value[])[] = [];
    const src = '~ ENTITY_SET("hero", "health", 90 - 10)\nOuch.\n-> END\n';
    runStory(src, [], { host: { onEffect: (_n, args) => void writes.push(args) } });
    expect(writes).toEqual([['hero', 'health', 80]]);
  });

  it('binding table records journal and entity targets (F417)', () => {
    const src = '@journal(Found the key)\n~ ENTITY_SET("hero", "keys", 1)\n-> END\n';
    const r = runStory(src);
    expect(r.story.program.bindings).toEqual(
      expect.arrayContaining([
        { kind: 'journal', name: 'Found the key' },
        { kind: 'entity', name: 'hero' },
      ]),
    );
  });
});

describe('async host functions (F486)', () => {
  it('suspends and resumes across awaited host calls', async () => {
    const story = createStoryFromSource('VAR n = 0\n~ n = FETCH(20)\nGot {n + 1}.\n-> END\n', {
      functions: { FETCH: async (x) => Promise.resolve((x as number) * 2) },
    });
    const text = await story.continueAsync();
    expect(text).toBe('Got 41.\n');
    expect(story.status).toBe('done');
  });

  it('sync continue() refuses async functions with a clear error', () => {
    const story = createStoryFromSource('{FETCH()}\n-> END\n', {
      functions: { FETCH: async () => Promise.resolve(1) },
    });
    expect(() => story.continue()).toThrow(/continueAsync/);
  });

  it('rejected promises surface as story-visible error values', async () => {
    const story = createStoryFromSource('Result: {FETCH()}.\n-> END\n', {
      functions: { FETCH: async () => Promise.reject(new Error('network down')) },
    });
    expect(await story.continueAsync()).toBe('Result: (error: network down).\n');
  });
});

describe('effect failure handling (F488)', () => {
  it('a throwing host effect becomes an error value, story keeps running', () => {
    const src = 'VAR ok = false\n~ ok = PLAY_AUDIO("missing.ogg")\nStatus: {ok}.\nNext line still prints.\n-> END\n';
    const r = runStory(src, [], {
      host: {
        onEffect: () => {
          throw new Error('audio device unavailable');
        },
      },
    });
    expect(r.status).toBe('done');
    expect(r.transcript).toContain('Status: (error: audio device unavailable).');
    expect(r.transcript).toContain('Next line still prints.');
  });

  it('a throwing host function becomes an error value', () => {
    const r = runStory('Got {BOOM()}.\n-> END\n', [], {
      functions: {
        BOOM: () => {
          throw new Error('kaboom');
        },
      },
    });
    expect(r.transcript).toBe('Got (error: kaboom).');
  });

  it('entity reads fall back to error values without a host', () => {
    const r = runStory('Health: {@hero.health}.\n-> END\n');
    expect(r.transcript).toBe('Health: (error: no host binding for @hero.health).');
  });
});

describe('audit log (F487)', () => {
  it('records every host crossing in execution order with turn numbers', () => {
    const src = `-> camp
=== camp ===
~ PLAY_AUDIO("intro.ogg")
{GREET("fox")}
+ Rest.
  ~ VIBRATE(10)
  -> END
`;
    const story = createStoryFromSource(src, {
      functions: { GREET: (n) => `Hello ${String(n)}` },
      host: { onEffect: () => undefined },
    });
    story.continue();
    story.choose(0);
    story.continue();
    const log = story.auditLog();
    expect(log.map((e) => [e.kind, e.name, e.turn, e.ok])).toEqual([
      ['effect', 'PLAY_AUDIO', 0, true],
      ['function', 'GREET', 0, true],
      ['effect', 'VIBRATE', 1, true],
    ]);
    expect(log[0]?.args).toEqual(['intro.ogg']);
  });
});

describe('mock-host integration (F490)', () => {
  it('a full mock host drives bindings, effects, and functions together', () => {
    const journal: string[] = [];
    const entityStore = new Map<string, number>([['fox.health', 9]]);
    const src = `-> meeting
=== meeting ===
@fox(Reynard) sidles up, health {@fox.health}.
@journal(Met Reynard at the crossroads)
~ ENTITY_SET("fox", "health", @fox.health - 2)
After the scuffle: {@fox.health}.
-> END
`;
    const r = runStory(src, [], {
      host: {
        resolveEntityDisplay: (_name, display) => display ?? 'someone',
        readEntityField: (name, field) => entityStore.get(`${name}.${field ?? ''}`) ?? 0,
        onEffect: (name, args) => {
          if (name === 'JOURNAL') journal.push(String(args[0]));
          if (name === 'ENTITY_SET') entityStore.set(`${String(args[0])}.${String(args[1])}`, args[2] as number);
        },
      },
    });
    expect(r.transcript).toBe('Reynard sidles up, health 9.\nAfter the scuffle: 7.');
    expect(journal).toEqual(['Met Reynard at the crossroads']);
    expect(entityStore.get('fox.health')).toBe(7);
  });
});
