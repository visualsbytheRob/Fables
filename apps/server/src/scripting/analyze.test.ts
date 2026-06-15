/**
 * Script scope-analysis tests (Epic 20, F1946–F1947).
 */

import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_SCOPES,
  checkScopes,
  extractCapabilities,
  isKnownScope,
  KNOWN_SCOPES,
} from './analyze.js';

describe('capability extraction', () => {
  it('finds distinct fables.<area>.<method> calls', () => {
    const src =
      'await fables.notes.query(""); fables.notes.create({}); fables . storage . set("k","v")';
    expect(extractCapabilities(src)).toEqual(['notes.create', 'notes.query', 'storage.set']);
  });

  it('ignores unrelated member calls', () => {
    expect(extractCapabilities('console.log("hi"); arr.map(x => x)')).toEqual([]);
  });
});

describe('scope checking (F1947)', () => {
  it('passes when declared scopes cover the capabilities used', () => {
    const src = 'await fables.notes.query(""); await fables.notes.create({});';
    const result = checkScopes(src, ['notes:read', 'notes:write']);
    expect(result.ok).toBe(true);
    expect(result.requiredScopes).toEqual(['notes:read', 'notes:write']);
    expect(result.missingScopes).toEqual([]);
  });

  it('flags a missing scope', () => {
    const result = checkScopes('await fables.notes.create({});', ['notes:read']);
    expect(result.ok).toBe(false);
    expect(result.missingScopes).toEqual(['notes:write']);
  });

  it('flags an unknown capability', () => {
    const result = checkScopes('await fables.danger.run();', []);
    expect(result.ok).toBe(false);
    expect(result.unknownCapabilities).toEqual(['danger.run']);
  });

  it('reports declared-but-unused scopes', () => {
    const result = checkScopes('await fables.notes.query("");', ['notes:read', 'network']);
    expect(result.unusedScopes).toEqual(['network']);
  });
});

describe('known scopes', () => {
  it('derives the scope set from the capability map', () => {
    for (const scope of Object.values(CAPABILITY_SCOPES)) {
      expect(isKnownScope(scope)).toBe(true);
    }
    expect(KNOWN_SCOPES).toContain('notes:write');
    expect(isKnownScope('totally:made-up')).toBe(false);
  });
});
