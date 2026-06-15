import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Resolve workspace packages to their TS source for tests, independent of the
 * published `exports` that point compiled (production) consumers at `dist`. The
 * packages now ship conditional exports (`development` → src, `default` → dist);
 * these aliases pin tests to src so a package source edit is picked up without a
 * rebuild.
 */
const pkgSrc = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@fables/core': pkgSrc('core'),
      '@fables/forge-dsl': pkgSrc('forge-dsl'),
      '@fables/forge-vm': pkgSrc('forge-vm'),
      '@fables/plugin-sdk': pkgSrc('plugin-sdk'),
      '@fables/sync': pkgSrc('sync'),
      '@fables/ui': pkgSrc('ui'),
    },
  },
  test: {
    // Retry once: the jsdom UI tests run under v8 coverage instrumentation on
    // shared CI runners, where async `waitFor`s occasionally exceed their
    // timeout under load. A real failure still fails both attempts; a rare
    // timing flake passes on retry and keeps CI deterministic.
    retry: 1,
    coverage: {
      provider: 'v8',
      include: ['apps/*/src/**', 'packages/*/src/**'],
      exclude: ['**/*.test.*'],
      // F397: the forge-dsl compiler front-end is gated at ≥90% line coverage
      // (it measured 98.4% when the gate was added).
      thresholds: {
        'packages/forge-dsl/**': {
          lines: 90,
        },
      },
    },
    include: ['apps/*/src/**/*.test.{ts,tsx}', 'packages/*/src/**/*.test.{ts,tsx}'],
  },
});
