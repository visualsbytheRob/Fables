import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Token } from './token.js';
import type { FileProvider } from './symbols.js';

/**
 * Helpers for the forge-dsl test suite only. Nothing here is exported from
 * the package index; the library itself stays I/O-free.
 */

export const FIXTURE_DIR = fileURLToPath(new URL('../fixtures', import.meta.url));

export interface Fixture {
  readonly name: string;
  readonly path: string;
  readonly source: string;
}

export function loadFixtures(subdir: 'corpus' | 'errors' | 'multi'): Fixture[] {
  const dir = join(FIXTURE_DIR, subdir);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.fable'))
    .sort()
    .map((name) => ({
      name,
      path: join(dir, name),
      source: readFileSync(join(dir, name), 'utf8'),
    }));
}

/** FileProvider that resolves INCLUDE paths inside one fixture directory. */
export function dirFileProvider(subdir: 'corpus' | 'errors' | 'multi'): FileProvider {
  const dir = join(FIXTURE_DIR, subdir);
  return {
    resolve(path: string) {
      try {
        return { fileName: path, source: readFileSync(join(dir, path), 'utf8') };
      } catch {
        return null;
      }
    },
  };
}

/** Expected diagnostic codes from `// expect: FORGE123` comments in a fixture. */
export function expectedCodes(source: string): string[] {
  return [...source.matchAll(/\/\/\s*expect:\s*(FORGE\d{3})/g)].map((m) => m[1] as string);
}

/** Deterministic PRNG (mulberry32) for fuzzing — failures are reproducible by seed. */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}

/** Compact, reviewable one-line-per-token rendering for golden snapshots. */
export function tokenSummary(tokens: readonly Token[]): string {
  return tokens
    .map((t) => {
      const at = `${t.span.start.line}:${t.span.start.col}`;
      const text = t.text.replace(/\n/g, '\\n');
      return t.kind === 'Newline' || t.kind === 'EOF'
        ? `${t.kind} @${at}`
        : `${t.kind} @${at} ${JSON.stringify(text)}`;
    })
    .join('\n');
}
