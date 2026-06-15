/**
 * Distribution pipeline close (F1891 e2e, F1893 security, F1894 perf, F1897).
 *
 * Proves the whole distribution chain composes: author → pack → archive →
 * verify → unpack → the source still compiles. Plus the security property that a
 * pack is data, never code, and a large-pack performance check.
 */

import { describe, expect, it } from 'vitest';
import { compile } from '@fables/forge-dsl';
import { packFable, unpackFable, validatePack } from './pack.js';
import { buildArchive, verifyArchive, preservationChecklist } from '../archive/archive.js';
import { inkToForge } from '../../import/ink/ink.js';

describe('full distribution pipeline (F1891/F1897)', () => {
  it('imports Ink → packs → archives → verifies → unpacks → still compiles', () => {
    // Author: bring a story in from Ink.
    const { forge } = inkToForge(
      '=== start ===\nYou begin.\n+ [Go] -> next\n\n=== next ===\nEnd.\n-> END\n',
    );
    expect(compile(forge).ok).toBe(true);

    // Pack it (signed), validate, then archive + verify.
    const pack = packFable({
      story: { id: 's1', title: 'Imported', description: 'from ink' },
      source: { 'main.fable': forge },
      capabilities: ['audio'],
      signingKey: 'author-key',
    });
    expect(validatePack(pack, 'author-key').valid).toBe(true);

    const archive = buildArchive({ packs: [{ name: 's1.fablepack', bytes: pack }] });
    expect(verifyArchive(archive).valid).toBe(true);

    // Play elsewhere: unpack and recompile the source.
    const out = unpackFable(pack);
    expect(compile(out.source['main.fable']!).ok).toBe(true);

    // Preservation checklist runs over the pack.
    const checklist = preservationChecklist(pack);
    expect(checklist.find((c) => c.item === 'story source')!.present).toBe(true);
  });
});

describe('pack security: data not code (F1893)', () => {
  it('a story containing script-like text is carried verbatim, never executed', () => {
    // Dangerous-looking tokens that must be treated as inert data, not code.
    const malicious =
      '=== a ===\nScript-ish: alert(1); process.exit(); require("fs"); rm -rf /\n-> END\n';
    const pack = packFable({
      story: { id: 'x', title: 'x', description: '' },
      source: { 'main.fable': malicious },
    });
    const out = unpackFable(pack);
    // The single security property: the source is returned byte-for-byte, with no
    // evaluation and no side effects. (If this process were vulnerable, packing or
    // unpacking the above would have run something; it didn't.)
    expect(out.source['main.fable']).toBe(malicious);
    // As plain narrative text it also compiles to the sandboxed Forge VM.
    expect(compile(out.source['main.fable']!).ok).toBe(true);
  });
});

describe('large pack handling (F1894)', () => {
  it('packs and verifies a large story within budget', () => {
    // ~2MB of source across many files.
    const source: Record<string, string> = {};
    for (let i = 0; i < 200; i++) {
      source[`scene${i}.fable`] =
        `=== knot${i} ===\n` + 'Lorem ipsum dolor sit amet. '.repeat(400) + '\n-> END\n';
    }
    const start = Date.now();
    const pack = packFable({ story: { id: 'big', title: 'Big', description: '' }, source });
    const valid = validatePack(pack);
    expect(valid.valid).toBe(true);
    expect(Date.now() - start).toBeLessThan(10_000);
  }, 30_000);
});
