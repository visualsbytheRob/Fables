/** Shared test utilities: fixture loading from the forge-dsl corpus. */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FileProvider } from '@fables/forge-dsl';

const here = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(here, '..', '..', 'forge-dsl', 'fixtures', 'corpus');
const MULTI = join(here, '..', '..', 'forge-dsl', 'fixtures', 'multi');

/** Load a corpus fixture by base name (e.g. `01-hello`). */
export function fixture(name: string): string {
  return readFileSync(join(CORPUS, `${name}.fable`), 'utf8');
}

/** A FileProvider over the corpus directory (for INCLUDE fixtures). */
export function corpusFiles(): FileProvider {
  return {
    resolve(path: string) {
      try {
        return { fileName: path, source: readFileSync(join(CORPUS, path), 'utf8') };
      } catch {
        return null;
      }
    },
  };
}

/** Load an entry file plus a FileProvider from the multi-file fixture dir. */
export function fixtureFiles(entry: string): { source: string; files: FileProvider } {
  return {
    source: readFileSync(join(MULTI, entry), 'utf8'),
    files: {
      resolve(path: string) {
        try {
          return { fileName: path, source: readFileSync(join(MULTI, path), 'utf8') };
        } catch {
          return null;
        }
      },
    },
  };
}

/** Deterministic xorshift for property-test choice scripts. */
export function testRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}
