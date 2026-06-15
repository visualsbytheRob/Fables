/**
 * Resource-guardrail tests (F1307).
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_GUARDRAILS, resolveAiAllowed } from './resource-policy.js';

describe('resolveAiAllowed', () => {
  it('allows when resources are within budget', () => {
    const d = resolveAiAllowed({ batteryLevel: 0.8, cpuLoad: 0.3 });
    expect(d.allowed).toBe(true);
    expect(d.reasons).toEqual([]);
  });

  it('blocks on low battery when not charging', () => {
    const d = resolveAiAllowed({ batteryLevel: 0.1, charging: false });
    expect(d.allowed).toBe(false);
    expect(d.reasons).toContain('low-battery');
    expect(d.detail).toMatch(/battery/i);
  });

  it('allows low battery while charging (allowOnCharger)', () => {
    const d = resolveAiAllowed({ batteryLevel: 0.1, charging: true });
    expect(d.allowed).toBe(true);
  });

  it('still blocks low battery while charging when allowOnCharger is off', () => {
    const d = resolveAiAllowed(
      { batteryLevel: 0.1, charging: true },
      { ...DEFAULT_GUARDRAILS, allowOnCharger: false },
    );
    expect(d.allowed).toBe(false);
    expect(d.reasons).toContain('low-battery');
  });

  it('blocks on high CPU load', () => {
    const d = resolveAiAllowed({ cpuLoad: 0.95 });
    expect(d.allowed).toBe(false);
    expect(d.reasons).toContain('high-cpu');
  });

  it('blocks on memory pressure', () => {
    const d = resolveAiAllowed({ memoryPressure: 0.95 });
    expect(d.allowed).toBe(false);
    expect(d.reasons).toContain('memory-pressure');
  });

  it('can report multiple reasons at once', () => {
    const d = resolveAiAllowed({ batteryLevel: 0.05, cpuLoad: 0.99, memoryPressure: 0.99 });
    expect(d.reasons.sort()).toEqual(['high-cpu', 'low-battery', 'memory-pressure']);
  });

  it('never blocks when guardrails are disabled', () => {
    const d = resolveAiAllowed(
      { batteryLevel: 0.01, cpuLoad: 1, memoryPressure: 1 },
      { ...DEFAULT_GUARDRAILS, enabled: false },
    );
    expect(d.allowed).toBe(true);
  });

  it('allows when state is unknown (no signals)', () => {
    expect(resolveAiAllowed({}).allowed).toBe(true);
  });
});
