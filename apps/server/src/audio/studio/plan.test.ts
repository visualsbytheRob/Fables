/**
 * Tests for Recording Studio plan logic (F1656 + F1657).
 */

import { describe, expect, it } from 'vitest';
import { buildRecordingPlan, sessionChecklist } from './plan.js';
import type { PlanInput } from './plan.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const line = (lineKey: string, cast: boolean, text = 'text'): PlanInput => ({
  lineKey,
  text,
  cast,
});

// ---------------------------------------------------------------------------
// buildRecordingPlan
// ---------------------------------------------------------------------------

describe('buildRecordingPlan', () => {
  it('all-human plan has remaining 0 and coverage 1', () => {
    const lines = [line('a', true), line('b', false), line('c', true)];
    const recorded = new Set(['a', 'b', 'c']);
    const plan = buildRecordingPlan(lines, recorded);

    expect(plan.total).toBe(3);
    expect(plan.recorded).toBe(3);
    expect(plan.remaining).toBe(0);
    expect(plan.ttsFallback).toBe(0);
    expect(plan.uncast).toBe(0);
    expect(plan.humanCoverage).toBe(1);
  });

  it('mixed human + tts + uncast counts are correct', () => {
    // a: human (has recording, cast=true)
    // b: tts   (no recording, cast=true)
    // c: uncast (no recording, cast=false)
    // d: human (has recording, cast=false)
    const lines = [line('a', true), line('b', true), line('c', false), line('d', false)];
    const recorded = new Set(['a', 'd']);
    const plan = buildRecordingPlan(lines, recorded);

    expect(plan.total).toBe(4);
    expect(plan.recorded).toBe(2);
    expect(plan.remaining).toBe(2);
    expect(plan.ttsFallback).toBe(1);
    expect(plan.uncast).toBe(1);
    expect(plan.humanCoverage).toBeCloseTo(0.5);
  });

  it('empty input gives zero counts and coverage 0', () => {
    const plan = buildRecordingPlan([], new Set());

    expect(plan.total).toBe(0);
    expect(plan.recorded).toBe(0);
    expect(plan.remaining).toBe(0);
    expect(plan.ttsFallback).toBe(0);
    expect(plan.uncast).toBe(0);
    expect(plan.humanCoverage).toBe(0);
    expect(plan.lines).toHaveLength(0);
  });

  it('a recordedKey not present in lines is ignored', () => {
    const lines = [line('a', true)];
    const recorded = new Set(['a', 'z', 'ghost']);
    const plan = buildRecordingPlan(lines, recorded);

    // Only 'a' is in lines, so only 1 recorded.
    expect(plan.total).toBe(1);
    expect(plan.recorded).toBe(1);
    expect(plan.ttsFallback).toBe(0);
    expect(plan.uncast).toBe(0);
  });

  it('no-human plan: all cast lines become tts', () => {
    const lines = [line('a', true), line('b', true)];
    const plan = buildRecordingPlan(lines, new Set());

    expect(plan.ttsFallback).toBe(2);
    expect(plan.uncast).toBe(0);
    expect(plan.recorded).toBe(0);
    expect(plan.humanCoverage).toBe(0);
  });

  it('no-human plan: uncast lines when cast=false', () => {
    const lines = [line('a', false), line('b', false)];
    const plan = buildRecordingPlan(lines, new Set());

    expect(plan.ttsFallback).toBe(0);
    expect(plan.uncast).toBe(2);
    expect(plan.recorded).toBe(0);
  });

  it('ttsFallback and uncast are distinct by the cast flag', () => {
    const lines = [line('tts1', true), line('tts2', true), line('unc1', false)];
    const plan = buildRecordingPlan(lines, new Set());

    expect(plan.ttsFallback).toBe(2);
    expect(plan.uncast).toBe(1);
    expect(plan.remaining).toBe(3);
  });

  it('PlanLine source fields are set correctly per line', () => {
    const lines = [line('h', true), line('t', true), line('u', false)];
    const recorded = new Set(['h']);
    const plan = buildRecordingPlan(lines, recorded);

    const [h, t, u] = plan.lines;
    expect(h!.source).toBe('human');
    expect(h!.hasHuman).toBe(true);
    expect(t!.source).toBe('tts');
    expect(t!.hasHuman).toBe(false);
    expect(u!.source).toBe('uncast');
    expect(u!.hasHuman).toBe(false);
  });

  it('humanCoverage is fractional when partially recorded', () => {
    const lines = [line('a', true), line('b', true), line('c', false), line('d', false)];
    const recorded = new Set(['a']);
    const plan = buildRecordingPlan(lines, recorded);

    expect(plan.humanCoverage).toBeCloseTo(0.25);
  });
});

// ---------------------------------------------------------------------------
// sessionChecklist
// ---------------------------------------------------------------------------

describe('sessionChecklist', () => {
  it('returns empty array when all lines are human', () => {
    const lines = [line('a', true), line('b', false)];
    const plan = buildRecordingPlan(lines, new Set(['a', 'b']));
    expect(sessionChecklist(plan)).toEqual([]);
  });

  it('checklist order matches input order', () => {
    const lines = [
      line('first', true),
      line('second', false),
      line('third', true),
      line('fourth', false),
    ];
    // Only 'third' is recorded.
    const plan = buildRecordingPlan(lines, new Set(['third']));
    expect(sessionChecklist(plan)).toEqual(['first', 'second', 'fourth']);
  });

  it('checklist includes both tts and uncast lines', () => {
    const lines = [line('human1', true), line('tts1', true), line('uncast1', false)];
    const plan = buildRecordingPlan(lines, new Set(['human1']));
    const checklist = sessionChecklist(plan);
    expect(checklist).toContain('tts1');
    expect(checklist).toContain('uncast1');
    expect(checklist).not.toContain('human1');
  });

  it('returns all keys when no lines are recorded', () => {
    const lines = [line('a', true), line('b', false), line('c', true)];
    const plan = buildRecordingPlan(lines, new Set());
    expect(sessionChecklist(plan)).toEqual(['a', 'b', 'c']);
  });
});
