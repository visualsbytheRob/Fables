import { defineConfig } from 'vitest/config';

export default defineConfig({
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
