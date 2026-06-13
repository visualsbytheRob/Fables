import { describe, expect, it } from 'vitest';

import { createSaveSlot, restoreSaveSlot, rewindStory } from './saves.js';
import { SaveError } from './state.js';
import { createStoryFromSource } from './harness.js';
import { fixture } from './test-helpers.js';

/**
 * F461, F464–F466, F469–F470 — library side of saves & snapshots.
 * (F462 endpoints, F463 autosave wiring, F467 slot UI, F468 sync are
 * deferred to the server/web lanes.)
 */

function playedStory() {
  const story = createStoryFromSource(fixture('17-read-counts'), { seed: 5 });
  story.continue();
  story.choose(0);
  story.continue();
  story.choose(0);
  story.continue();
  return story;
}

describe('save slots (F461)', () => {
  it('captures named snapshots with story metadata', () => {
    const story = createStoryFromSource(fixture('24-lion-court-epic'), {
      seed: 1,
      files: { resolve: (p) => ({ fileName: p, source: fixture(p.replace(/\.fable$/, '')) }) },
    });
    story.continue();
    const slot = createSaveSlot(story, 'before the gates', { now: () => new Date('2026-06-12T08:00:00Z') });
    expect(slot.name).toBe('before the gates');
    expect(slot.storyTitle).toBe("The Lion's Court");
    expect(slot.createdAt).toBe('2026-06-12T08:00:00.000Z');
    expect(slot.turn).toBe(0);
    expect(slot.scene).toBe('gates');
  });

  it('restores a slot exactly', () => {
    const story = playedStory();
    const slot = createSaveSlot(story, 'at the spring');
    story.choose(1);
    story.continue();
    expect(story.status).toBe('done');

    const report = restoreSaveSlot(story, JSON.parse(JSON.stringify(slot)) as unknown);
    expect(report).toBeNull();
    expect(story.status).toBe('choices');
    expect(story.visits('spring')).toBe(3);
    story.choose(1);
    story.continue();
    expect(story.exportTranscript()).toContain('3 visits to the spring brought you here.');
  });
});

describe('rewind (F464)', () => {
  it('restores to any point in choice history by replaying', () => {
    const story = playedStory();
    story.choose(1);
    story.continue();
    expect(story.currentTurn).toBe(3);

    const back = rewindStory(story, 1);
    expect(back.currentTurn).toBe(1);
    expect(back.status).toBe('choices');
    expect(back.visits('spring')).toBe(2);

    // Replaying the same tail reproduces the same future.
    back.choose(0);
    back.continue();
    back.choose(1);
    back.continue();
    expect(back.exportTranscript()).toBe(story.exportTranscript());
  });

  it('rejects rewinds beyond the recorded history', () => {
    const story = playedStory();
    expect(() => rewindStory(story, 99)).toThrow(/history has 2 choices/);
  });
});

describe('save migration after recompile (F465)', () => {
  const V1 = 'VAR gold = 1\n-> camp\n=== camp ===\nCamp.\n+ Wait.\n  ~ gold = gold + 10\n  -> camp\n';
  const V2 =
    'VAR gold = 1\nVAR fame = 0\n-> camp\n=== camp ===\nCamp.\n+ Wait.\n  ~ gold = gold + 10\n  -> camp\n=== shrine ===\nNew place.\n-> END\n';

  it('migrates globals and visit counts by name with a report', () => {
    const old = createStoryFromSource(V1);
    old.continue();
    old.choose(0);
    old.continue();
    const save = old.saveState();

    const updated = createStoryFromSource(V2);
    const report = updated.loadState(JSON.parse(JSON.stringify(save)), { migrate: true });
    expect(report).not.toBeNull();
    expect(report?.migrated).toBe(true);
    expect(report?.keptGlobals).toEqual(['gold']);
    expect(updated.getVariable('gold')).toBe(11);
    expect(updated.getVariable('fame')).toBe(0); // fresh default
    expect(updated.visits('camp')).toBe(2);
    expect(report?.notes.join(' ')).toContain('entry point');
    // The migrated story is playable from the entry point.
    expect(updated.continue()).toContain('Camp.');
  });

  it('reports dropped globals when the new story removed them', () => {
    const old = createStoryFromSource('VAR relic = 7\nUse {relic}.\n-> END\n');
    old.continue();
    const save = old.saveState();
    const updated = createStoryFromSource('No variables here.\n-> END\n');
    const report = updated.loadState(JSON.parse(JSON.stringify(save)), { migrate: true });
    expect(report?.droppedGlobals).toEqual(['relic']);
    expect(report?.keptGlobals).toEqual([]);
  });
});

describe('transcript log (F466)', () => {
  it('exports the full text + choices in order', () => {
    const story = playedStory();
    expect(story.exportTranscript()).toBe(
      [
        'The water is new to you.',
        '> Drink again.',
        'Drink again.',
        'You have been here before.',
        '> Drink again.',
        'Drink again.',
        'You have been here before.',
      ].join('\n'),
    );
    expect(story.transcript().filter((t) => t.kind === 'choice')).toHaveLength(2);
  });
});

describe('corrupt save detection (F469)', () => {
  it('rejects malformed JSON and mangled slots without corrupting the story', () => {
    const story = playedStory();
    const before = story.exportTranscript();
    expect(() => restoreSaveSlot(story, '{not json')).toThrow(SaveError);
    expect(() => restoreSaveSlot(story, { state: { stateVersion: 1 } })).toThrow(SaveError);

    const slot = createSaveSlot(story, 'good');
    const mangled = JSON.parse(JSON.stringify(slot)) as { state: { frames: unknown } };
    mangled.state.frames = [{ container: 'no_such_knot', ip: 0, kind: 'flow', temps: null }];
    expect(() => restoreSaveSlot(story, mangled)).toThrow(/unknown container "no_such_knot"/);
    // The story is untouched after every failed restore.
    expect(story.exportTranscript()).toBe(before);
    expect(story.status).toBe('choices');
  });
});

describe('save/rewind integration (F470)', () => {
  it('save → play → restore → diverge produces consistent independent futures', () => {
    const story = playedStory();
    const slot = createSaveSlot(story, 'fork');
    story.choose(1); // move on
    story.continue();
    const endingA = story.exportTranscript();

    restoreSaveSlot(story, slot);
    story.choose(0); // drink again instead
    story.continue();
    expect(story.status).toBe('choices');
    const endingB = story.exportTranscript();

    expect(endingA).toContain('visits to the spring');
    expect(endingB).not.toBe(endingA);
    expect(endingB).toContain('You have been here before.');
  });
});
