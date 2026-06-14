/**
 * Cloud policy tests (F1362–F1365, F1368) — the privacy chokepoint. Verifies key
 * masking + validation, per-feature routing, the egress consent gate, per-notebook
 * exclusions, and cache-friendly request shaping.
 */

import { describe, expect, it } from 'vitest';
import {
  canSendToCloud,
  maskApiKey,
  shapeCacheFriendly,
  shouldRouteToCloud,
  validateApiKey,
  type CloudPolicy,
} from './cloud-policy.js';

const enabled: CloudPolicy = {
  enabled: true,
  consentGiven: true,
  excludedNotebooks: new Set(['nb_private']),
};

describe('API key masking + validation (F1362)', () => {
  it('masks all but the prefix and last four', () => {
    expect(maskApiKey('sk-ant-abcdefghijklmnop')).toBe('sk-ant-…mnop');
    expect(maskApiKey('')).toBe('');
    expect(maskApiKey('short')).toBe('••••');
  });

  it('validates format without a network call', () => {
    expect(validateApiKey('sk-ant-0123456789abcdef')).toEqual({ valid: true });
    expect(validateApiKey('')).toEqual({ valid: false, reason: 'empty' });
    expect(validateApiKey('bogus')).toEqual({ valid: false, reason: 'unexpected format' });
  });
});

describe('per-feature routing (F1363)', () => {
  it('routes creative tasks to the cloud when enabled + consented', () => {
    expect(shouldRouteToCloud('prose', enabled)).toBe(true);
    expect(shouldRouteToCloud('dialogue', enabled)).toBe(true);
  });

  it('keeps extractive tasks local', () => {
    expect(shouldRouteToCloud('tags', enabled)).toBe(false);
    expect(shouldRouteToCloud('summary', enabled)).toBe(false);
  });

  it('never routes to cloud when disabled or unconsented', () => {
    expect(shouldRouteToCloud('prose', { ...enabled, enabled: false })).toBe(false);
    expect(shouldRouteToCloud('prose', { ...enabled, consentGiven: false })).toBe(false);
  });
});

describe('egress gate (F1364 + F1365)', () => {
  it('allows when enabled, consented, and notebook not excluded', () => {
    expect(canSendToCloud(enabled, { notebookId: 'nb_public' })).toEqual({ allowed: true });
  });

  it('denies without consent (F1364)', () => {
    const d = canSendToCloud({ ...enabled, consentGiven: false });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/consent/);
  });

  it('denies when cloud is disabled', () => {
    expect(canSendToCloud({ ...enabled, enabled: false }).allowed).toBe(false);
  });

  it('denies content from an excluded notebook (F1365)', () => {
    const d = canSendToCloud(enabled, { notebookId: 'nb_private' });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/excluded/);
  });
});

describe('cache-friendly shaping (F1368)', () => {
  it('puts the stable context in system and the variable turn in prompt', () => {
    const { system, prompt } = shapeCacheFriendly({
      stableContext: 'WORLD BRIEF: ...long stable text...',
      variable: 'Now write the next beat.',
    });
    expect(system).toContain('WORLD BRIEF');
    expect(prompt).toBe('Now write the next beat.');
  });

  it('appends extra system guidance after the stable prefix', () => {
    const { system } = shapeCacheFriendly({
      stableContext: 'CONTEXT',
      variable: 'go',
      system: 'be terse',
    });
    expect(system).toBe('CONTEXT\n\nbe terse');
  });
});
