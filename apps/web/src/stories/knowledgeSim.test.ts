/** Knowledge sim tests (F646/F647): mock parsing + sim host read tracking. */
import { describe, expect, it } from 'vitest';
import { makeSimHost, mocksFrom, parseMockInput } from './knowledgeSim.js';

describe('parseMockInput (F646)', () => {
  it('parses entity.field = value lines into a nested map', () => {
    const mocks = parseMockInput('Fox.cunning = 9\nCrow.mood = "smug"\nLion.regal = true');
    expect(mocks.get('Fox')?.get('cunning')).toBe(9);
    expect(mocks.get('Crow')?.get('mood')).toBe('smug');
    expect(mocks.get('Lion')?.get('regal')).toBe(true);
  });

  it('tolerates a leading @ and surrounding whitespace', () => {
    const mocks = parseMockInput('  @Fox.cunning  =  3  ');
    expect(mocks.get('Fox')?.get('cunning')).toBe(3);
  });

  it('skips blank lines, comments and malformed lines', () => {
    const mocks = parseMockInput('\n// a comment\nnofield = 1\nFox = 2\nFox.cunning = 4\n');
    expect(mocks.size).toBe(1);
    expect(mocks.get('Fox')?.get('cunning')).toBe(4);
    expect(mocks.get('Fox')?.has('')).toBe(false);
  });
});

describe('makeSimHost (F646)', () => {
  it('serves mocked reads and records them as mocked', () => {
    const sim = makeSimHost(mocksFrom({ Fox: { cunning: 9 } }));
    expect(sim.host.readEntityField?.('Fox', 'cunning')).toBe(9);
    expect(sim.usedLiveBindings()).toBe(false);
    expect(sim.log().mocked.has('Fox.cunning')).toBe(true);
    expect(sim.log().live.size).toBe(0);
  });

  it('is case-insensitive on the entity name', () => {
    const sim = makeSimHost(mocksFrom({ Fox: { cunning: 9 } }));
    expect(sim.host.readEntityField?.('fox', 'cunning')).toBe(9);
    expect(sim.usedLiveBindings()).toBe(false);
  });

  it('flags an unmocked read as a live binding (F647)', () => {
    const sim = makeSimHost(mocksFrom({ Fox: { cunning: 9 } }));
    // Mocked field is fine…
    sim.host.readEntityField?.('Fox', 'cunning');
    // …but a field with no mock falls through to "live".
    const value = sim.host.readEntityField?.('Crow', 'mood');
    expect(value).toBe(0); // benign placeholder keeps the run going
    expect(sim.usedLiveBindings()).toBe(true);
    expect(sim.log().live.has('Crow.mood')).toBe(true);
  });

  it('throws when a field is missing from the read (matches host contract)', () => {
    const sim = makeSimHost(new Map());
    expect(() => sim.host.readEntityField?.('Fox', undefined)).toThrow(/needs a field/);
  });
});
