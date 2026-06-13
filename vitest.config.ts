import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Tests and dev tooling always resolve the workspace packages to their
// TypeScript source. Production (`node dist/server.js`) instead uses each
// package's `exports` → `dist/index.js`. Aliasing here keeps the two paths
// independent: changing the published `exports` to dist never affects tests.
const pkg = (name: string) => resolve(__dirname, `packages/${name}/src/index.ts`);

export default defineConfig({
  resolve: {
    alias: {
      '@fables/core': pkg('core'),
      '@fables/forge-dsl': pkg('forge-dsl'),
      '@fables/forge-vm': pkg('forge-vm'),
      '@fables/sync': pkg('sync'),
      '@fables/ui': pkg('ui'),
    },
  },
  test: {
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
