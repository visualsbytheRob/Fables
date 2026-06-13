/**
 * Demo world compile check (F699). The bundled "Aesop Engine" demo stories
 * (docs/demo/aesop) must compile cleanly with the same client-side pipeline an
 * author's buffers go through — otherwise the demo would greet a new user with
 * red squiggles. This asserts both .fable files lower to a runnable program.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileBuffers } from './playtest/engine.js';

const here = dirname(fileURLToPath(import.meta.url));
// apps/web/src/stories → repo root → docs/demo/aesop
const demoDir = join(here, '..', '..', '..', '..', 'docs', 'demo', 'aesop');

const load = (name: string): string => readFileSync(join(demoDir, name), 'utf8');

describe('Aesop demo world compiles (F699)', () => {
  for (const file of ['fox-and-crow.fable', 'crossroads.fable']) {
    it(`${file} compiles to a runnable program`, () => {
      const source = load(file);
      const built = compileBuffers(new Map([['main.fable', source]]), 'main.fable');
      const errors = built.diagnostics.filter((d) => d.severity === 'error');
      expect(errors, errors.map((d) => `${d.code}: ${d.message}`).join('\n')).toEqual([]);
      expect(built.error).toBeNull();
      expect(built.program).not.toBeNull();
    });
  }
});
