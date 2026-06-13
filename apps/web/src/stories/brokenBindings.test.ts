/**
 * Broken-binding diagnostics (F629/F630): proves that unknown `@entity`,
 * missing `[[note]]` and malformed binding refs raise the expected FORGE codes
 * when a KnowledgeResolver is present, and that the client-side `buildProject`
 * surfaces whatever diagnostics a compile produces into `build.problems`.
 *
 * Honesty note: the live editor's `buildProject` does NOT inject a knowledge
 * resolver, so `[[note]]`/`@entity` *existence* checks are lenient there. The
 * first block uses `compile()` directly with a stub resolver to exercise the
 * real broken-binding codes; the second asserts the build pipeline forwards
 * diagnostics (here a structural FORGE108 that needs no resolver).
 */
import { describe, expect, it } from 'vitest';
import { compile } from '@fables/forge-dsl';
import type { EntitySchema, KnowledgeResolver } from '@fables/forge-dsl';
import { buildProject } from './build.js';

const stubKnowledge: KnowledgeResolver = {
  resolveEntity(name: string): EntitySchema | null {
    if (name === 'Fox' || name === 'fox') {
      return { name: 'fox', fields: { cunning: 'number', mood: 'string' } };
    }
    return null;
  },
  resolveNote(title: string): boolean {
    return title === 'The Trial of Reynard';
  },
  entityNames: () => ['fox', 'crow', 'lion'],
};

describe('broken-binding diagnostics (F629)', () => {
  it('flags an unknown @entity as FORGE204', () => {
    const result = compile('@Wolverine howls.\n-> END\n', { knowledge: stubKnowledge });
    expect(result.diagnostics.map((d) => d.code)).toContain('FORGE204');
  });

  it('flags a missing [[note]] as FORGE205', () => {
    const result = compile('See [[Ghost Note]].\n-> END\n', { knowledge: stubKnowledge });
    expect(result.diagnostics.map((d) => d.code)).toContain('FORGE205');
  });

  it('flags an unknown field on a known entity as FORGE309', () => {
    const result = compile('@Fox.armour gleams.\n-> END\n', { knowledge: stubKnowledge });
    expect(result.diagnostics.map((d) => d.code)).toContain('FORGE309');
  });

  it('accepts valid bindings with no broken-binding diagnostics', () => {
    const result = compile(
      '@Fox eyes the cheese, cunning {@Fox.cunning}. See [[The Trial of Reynard]].\n-> END\n',
      { knowledge: stubKnowledge },
    );
    const codes = new Set(result.diagnostics.map((d) => d.code));
    expect(codes.has('FORGE204')).toBe(false);
    expect(codes.has('FORGE205')).toBe(false);
    expect(codes.has('FORGE309')).toBe(false);
  });

  it('raises a malformed [[note]] binding as FORGE108 without a resolver', () => {
    const result = compile('You recall [[The Ledger\n');
    expect(result.diagnostics.map((d) => d.code)).toContain('FORGE108');
  });
});

describe('buildProject surfaces diagnostics into problems (F629/F630)', () => {
  it('forwards a structural binding error to build.problems', () => {
    const build = buildProject(new Map([['main.fable', 'You recall [[The Ledger\n']]), 'main.fable');
    const codes = build.problems.map((p) => p.diagnostic.code);
    expect(codes).toContain('FORGE108');
    expect(build.errors).toBeGreaterThan(0);
    // The problem is attributed to the file that produced it.
    expect(build.problems.find((p) => p.diagnostic.code === 'FORGE108')?.file).toBe('main.fable');
  });

  it('reports a clean build when bindings are structurally valid', () => {
    const build = buildProject(
      new Map([['main.fable', 'See [[A Note]] and @Fox.\n-> END\n']]),
      'main.fable',
    );
    // No resolver client-side, so unknown-entity/note checks are lenient: the
    // structurally-valid file builds without broken-binding errors.
    const codes = new Set(build.problems.map((p) => p.diagnostic.code));
    expect(codes.has('FORGE108')).toBe(false);
    expect(codes.has('FORGE204')).toBe(false);
    expect(codes.has('FORGE205')).toBe(false);
  });
});
