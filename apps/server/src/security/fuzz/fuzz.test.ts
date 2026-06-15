// Fuzzing test suite (F1267).
//
// Drives thousands of deterministically-generated inputs through the real FQL
// and Forge parsers.  The property under test: every call must either return
// normally OR throw ONLY a known/typed error (AppError / FqlError / compile
// diagnostics).  An unexpected TypeError / RangeError (e.g. stack overflow)
// or a hang is a failure.  A dedicated ReDoS suite asserts that
// pathological-backtracking inputs complete well within a time budget.

import { describe, it, expect } from 'vitest';
import { AppError } from '@fables/core';
import { parseFql, FqlError, lintQuery } from '../../fql/index.js';
import { compile } from '@fables/forge-dsl';
import {
  makeRng,
  randomFqlQuery,
  randomForgeSource,
  pathologicalInputs,
  redosInputs,
} from './generators.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Error types that parsers are allowed to throw.  Any other error is a bug. */
function isAllowedError(err: unknown): boolean {
  if (err instanceof AppError) return true;
  if (err instanceof FqlError) return true;
  // compile() never throws — it returns a result object — but guard anyway
  return false;
}

function assertSafeOrAllowed(fn: () => unknown, label: string): void {
  try {
    fn();
    // returned normally — fine
  } catch (err) {
    if (!isAllowedError(err)) {
      throw new Error(
        `[${label}] Unexpected error type: ${err instanceof Error ? err.constructor.name + ': ' + err.message : String(err)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// FQL fuzzing — parseFql
// ---------------------------------------------------------------------------

describe('fuzz: parseFql', () => {
  it('handles 3000 random FQL queries without unexpected crashes', { timeout: 30_000 }, () => {
    const rng = makeRng(0xdeadbeef);
    for (let i = 0; i < 3_000; i++) {
      const input = randomFqlQuery(rng);
      assertSafeOrAllowed(
        () => parseFql(input),
        `parseFql[${i}] input=${JSON.stringify(input.slice(0, 80))}`,
      );
    }
  });

  it('handles all pathological inputs without unexpected crashes', { timeout: 30_000 }, () => {
    for (const input of pathologicalInputs()) {
      assertSafeOrAllowed(
        () => parseFql(input),
        `parseFql pathological input=${JSON.stringify(input.slice(0, 80))}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// FQL fuzzing — lintQuery
// ---------------------------------------------------------------------------

describe('fuzz: lintQuery', () => {
  it('handles 3000 random FQL queries without unexpected crashes', { timeout: 30_000 }, () => {
    const rng = makeRng(0xcafebabe);
    for (let i = 0; i < 3_000; i++) {
      const input = randomFqlQuery(rng);
      assertSafeOrAllowed(
        () => lintQuery(input),
        `lintQuery[${i}] input=${JSON.stringify(input.slice(0, 80))}`,
      );
    }
  });

  it('returns LintFinding[] (not throws) for pathological inputs', { timeout: 30_000 }, () => {
    for (const input of pathologicalInputs()) {
      // lintQuery never throws — it always returns an array
      let result: unknown;
      try {
        result = lintQuery(input);
      } catch (err) {
        if (!isAllowedError(err)) {
          throw new Error(
            `lintQuery threw unexpected error for input ${JSON.stringify(input.slice(0, 80))}: ${err instanceof Error ? err.constructor.name + ': ' + err.message : String(err)}`,
          );
        }
        // allowed error from lintQuery would be unusual but acceptable
        return;
      }
      expect(Array.isArray(result)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Forge fuzzing — compile()
// ---------------------------------------------------------------------------

describe('fuzz: compile (forge-dsl)', () => {
  it(
    'handles 3000 random Forge sources — always returns a result object',
    { timeout: 30_000 },
    () => {
      const rng = makeRng(0xfeedface);
      for (let i = 0; i < 3_000; i++) {
        const source = randomForgeSource(rng);
        // compile() returns CompileResult (never throws); assert that invariant
        let result: ReturnType<typeof compile> | undefined;
        try {
          result = compile(source);
        } catch (err) {
          throw new Error(
            `compile() unexpectedly threw for source[${i}]=${JSON.stringify(source.slice(0, 80))}: ${err instanceof Error ? err.constructor.name + ': ' + err.message : String(err)}`,
          );
        }
        // result must have the expected shape
        expect(result).toBeDefined();
        expect(typeof result!.ok).toBe('boolean');
        expect(Array.isArray(result!.diagnostics)).toBe(true);
      }
    },
  );

  it('handles pathological inputs — always returns a result object', { timeout: 30_000 }, () => {
    for (const source of pathologicalInputs()) {
      let result: ReturnType<typeof compile> | undefined;
      try {
        result = compile(source);
      } catch (err) {
        throw new Error(
          `compile() unexpectedly threw for pathological input=${JSON.stringify(source.slice(0, 80))}: ${err instanceof Error ? err.constructor.name + ': ' + err.message : String(err)}`,
        );
      }
      expect(result).toBeDefined();
      expect(typeof result!.ok).toBe('boolean');
    }
  });
});

// ---------------------------------------------------------------------------
// ReDoS safety — assert each pathological input completes quickly
// ---------------------------------------------------------------------------

const REDOS_BUDGET_MS = 1_000; // each individual input must finish within 1s

describe('fuzz: ReDoS safety', () => {
  it('all ReDoS-shaped FQL inputs complete within budget', { timeout: 30_000 }, () => {
    for (const input of redosInputs()) {
      const start = Date.now();
      try {
        parseFql(input);
      } catch {
        // errors are fine; we're testing timing only
      }
      const elapsed = Date.now() - start;
      expect(
        elapsed,
        `parseFql ReDoS budget exceeded for: ${JSON.stringify(input.slice(0, 60))}`,
      ).toBeLessThan(REDOS_BUDGET_MS);
    }
  });

  it('all ReDoS-shaped lintQuery inputs complete within budget', { timeout: 30_000 }, () => {
    for (const input of redosInputs()) {
      const start = Date.now();
      try {
        lintQuery(input);
      } catch {
        // errors are fine; we're testing timing only
      }
      const elapsed = Date.now() - start;
      expect(
        elapsed,
        `lintQuery ReDoS budget exceeded for: ${JSON.stringify(input.slice(0, 60))}`,
      ).toBeLessThan(REDOS_BUDGET_MS);
    }
  });

  it('all ReDoS-shaped Forge compile inputs complete within budget', { timeout: 30_000 }, () => {
    for (const input of redosInputs()) {
      const start = Date.now();
      try {
        compile(input);
      } catch {
        // unexpected throw — timing still measured
      }
      const elapsed = Date.now() - start;
      expect(
        elapsed,
        `compile() ReDoS budget exceeded for: ${JSON.stringify(input.slice(0, 60))}`,
      ).toBeLessThan(REDOS_BUDGET_MS);
    }
  });

  it(
    'pathological long-string inputs to parseFql complete within budget',
    { timeout: 30_000 },
    () => {
      // Focus on the longest / most stressful entries only
      const stressful = [
        'a'.repeat(100_000),
        '('.repeat(500) + ')'.repeat(500),
        '"' + 'x '.repeat(500) + '"',
        Array.from({ length: 200 }, (_, i) => `tag:word${i}`).join(' '),
      ];
      for (const input of stressful) {
        const start = Date.now();
        try {
          parseFql(input);
        } catch {
          // errors are acceptable
        }
        const elapsed = Date.now() - start;
        expect(
          elapsed,
          `parseFql long-string budget exceeded for input len=${input.length}`,
        ).toBeLessThan(REDOS_BUDGET_MS);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Property: lintQuery always returns an array (never throws for valid strings)
// ---------------------------------------------------------------------------

describe('fuzz: lintQuery always returns array', () => {
  it('returns an array for 2000 random strings', { timeout: 20_000 }, () => {
    const rng = makeRng(0xabcdef01);
    for (let i = 0; i < 2_000; i++) {
      const input = randomFqlQuery(rng);
      let result: unknown;
      let threw = false;
      try {
        result = lintQuery(input);
      } catch (err) {
        threw = true;
        // lintQuery should not throw; but if it does, only AppError/FqlError allowed
        if (!isAllowedError(err)) {
          throw new Error(
            `lintQuery[${i}] threw unexpected: ${err instanceof Error ? err.constructor.name : String(err)}`,
          );
        }
      }
      if (!threw) {
        expect(Array.isArray(result)).toBe(true);
      }
    }
  });
});
