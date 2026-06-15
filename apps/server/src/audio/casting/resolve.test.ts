import { describe, it, expect } from 'vitest';
import { resolveCast, castCoverage } from './resolve.js';
import type { ScriptLine } from './separate.js';
import type { CastSheet } from './resolve.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NARRATOR_VOICE = { voiceId: 'narrator-v1' };
const ALICE_VOICE = { voiceId: 'alice-v1', pitch: 1.1 };
const DEFAULT_VOICE = { voiceId: 'default-v1', rate: 0.9 };

function makeCast(overrides: Partial<CastSheet> = {}): CastSheet {
  return {
    narrator: NARRATOR_VOICE,
    bySpeaker: { alice: ALICE_VOICE },
    defaultCharacter: DEFAULT_VOICE,
    ...overrides,
  };
}

const NARRATION_LINE: ScriptLine = { kind: 'narration', text: 'She walked in.', speaker: null };
const ALICE_LINE: ScriptLine = { kind: 'dialogue', text: 'Hello there.', speaker: 'Alice' };
const UNKNOWN_LINE: ScriptLine = { kind: 'dialogue', text: 'Boo!', speaker: null };
const BOB_LINE: ScriptLine = { kind: 'dialogue', text: 'Indeed.', speaker: 'Bob' };

// ---------------------------------------------------------------------------
// resolveCast — narration
// ---------------------------------------------------------------------------

describe('resolveCast', () => {
  it('assigns narrator voice to narration lines', () => {
    const cast = makeCast();
    const [resolved] = resolveCast([NARRATION_LINE], cast);
    expect(resolved!.voice).toBe(NARRATOR_VOICE);
  });

  it('assigns null voice to narration when narrator is null', () => {
    const cast = makeCast({ narrator: null });
    const [resolved] = resolveCast([NARRATION_LINE], cast);
    expect(resolved!.voice).toBeNull();
  });

  // -------------------------------------------------------------------------
  // resolveCast — known speaker
  // -------------------------------------------------------------------------

  it('assigns bySpeaker voice to a matched dialogue line (case-insensitive)', () => {
    const cast = makeCast();
    const [resolved] = resolveCast([ALICE_LINE], cast);
    expect(resolved!.voice).toBe(ALICE_VOICE);
  });

  it('matches speaker case-insensitively', () => {
    const cast = makeCast({ bySpeaker: { 'mira vale': { voiceId: 'mira-v1' } } });
    const line: ScriptLine = { kind: 'dialogue', text: 'Hi.', speaker: 'Mira Vale' };
    const [resolved] = resolveCast([line], cast);
    expect(resolved!.voice?.voiceId).toBe('mira-v1');
  });

  // -------------------------------------------------------------------------
  // resolveCast — unmatched/unknown speaker fallbacks
  // -------------------------------------------------------------------------

  it('assigns defaultCharacter when speaker is not in bySpeaker', () => {
    const cast = makeCast();
    const [resolved] = resolveCast([BOB_LINE], cast);
    expect(resolved!.voice).toBe(DEFAULT_VOICE);
  });

  it('assigns defaultCharacter when speaker is null', () => {
    const cast = makeCast();
    const [resolved] = resolveCast([UNKNOWN_LINE], cast);
    expect(resolved!.voice).toBe(DEFAULT_VOICE);
  });

  it('falls back to narrator when defaultCharacter is also null', () => {
    const cast = makeCast({ defaultCharacter: null });
    const [resolved] = resolveCast([BOB_LINE], cast);
    expect(resolved!.voice).toBe(NARRATOR_VOICE);
  });

  it('returns voice:null when both defaultCharacter and narrator are null', () => {
    const cast = makeCast({ narrator: null, defaultCharacter: null });
    const [resolved] = resolveCast([UNKNOWN_LINE], cast);
    expect(resolved!.voice).toBeNull();
  });

  // -------------------------------------------------------------------------
  // resolveCast — preserves original ScriptLine fields
  // -------------------------------------------------------------------------

  it('preserves kind, text, and speaker on resolved lines', () => {
    const cast = makeCast();
    const [resolved] = resolveCast([ALICE_LINE], cast);
    expect(resolved!.kind).toBe('dialogue');
    expect(resolved!.text).toBe('Hello there.');
    expect(resolved!.speaker).toBe('Alice');
  });

  // -------------------------------------------------------------------------
  // resolveCast — mixed line array
  // -------------------------------------------------------------------------

  it('resolves a mixed array in order', () => {
    const cast = makeCast();
    const lines: ScriptLine[] = [NARRATION_LINE, ALICE_LINE, BOB_LINE, UNKNOWN_LINE];
    const resolved = resolveCast(lines, cast);
    expect(resolved).toHaveLength(4);
    expect(resolved[0]!.voice).toBe(NARRATOR_VOICE); // narration
    expect(resolved[1]!.voice).toBe(ALICE_VOICE); // alice → bySpeaker
    expect(resolved[2]!.voice).toBe(DEFAULT_VOICE); // bob → defaultCharacter
    expect(resolved[3]!.voice).toBe(DEFAULT_VOICE); // null speaker → defaultCharacter
  });

  it('handles an empty lines array', () => {
    const cast = makeCast();
    expect(resolveCast([], cast)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// castCoverage
// ---------------------------------------------------------------------------

describe('castCoverage', () => {
  it('counts all lines as cast when every line resolves to a voice', () => {
    const cast = makeCast();
    const lines: ScriptLine[] = [NARRATION_LINE, ALICE_LINE];
    const cov = castCoverage(lines, cast);
    expect(cov.total).toBe(2);
    expect(cov.cast).toBe(2);
    expect(cov.uncast).toBe(0);
  });

  it('counts uncast lines correctly when narrator and defaultCharacter are null', () => {
    const cast = makeCast({ narrator: null, defaultCharacter: null });
    const lines: ScriptLine[] = [NARRATION_LINE, ALICE_LINE, BOB_LINE];
    // alice → bySpeaker (cast), narration → null (uncast), bob → null (uncast)
    const cov = castCoverage(lines, cast);
    expect(cov.total).toBe(3);
    expect(cov.cast).toBe(1);
    expect(cov.uncast).toBe(2);
  });

  it('returns zeroes for an empty lines array', () => {
    const cast = makeCast();
    const cov = castCoverage([], cast);
    expect(cov.total).toBe(0);
    expect(cov.cast).toBe(0);
    expect(cov.uncast).toBe(0);
  });

  it('total equals cast + uncast', () => {
    const cast = makeCast({ narrator: null, defaultCharacter: null });
    const lines: ScriptLine[] = [NARRATION_LINE, ALICE_LINE, UNKNOWN_LINE];
    const cov = castCoverage(lines, cast);
    expect(cov.total).toBe(cov.cast + cov.uncast);
  });
});
