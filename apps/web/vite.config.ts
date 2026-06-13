import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { resolve } from 'path';

// API requests proxy to the Fastify server in dev; in production the server
// serves the built web app itself, so everything is same-origin.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The web app always builds from the workspace packages' TypeScript
      // source, independent of their published `exports` (which point at
      // `dist` for production Node). This keeps `pnpm dev` working straight
      // after `pnpm install`, before any package is built.
      '@fables/core': resolve(__dirname, '../../packages/core/src/index.ts'),
      '@fables/forge-dsl': resolve(__dirname, '../../packages/forge-dsl/src/index.ts'),
      '@fables/forge-vm': resolve(__dirname, '../../packages/forge-vm/src/index.ts'),
      '@fables/sync': resolve(__dirname, '../../packages/sync/src/index.ts'),
      '@fables/ui': resolve(__dirname, '../../packages/ui/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.FABLES_API_URL ?? 'http://127.0.0.1:4870',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        sw: 'src/sw/sw.ts',
      },
      output: {
        // The service worker must be at /sw.js at the root for max scope.
        entryFileNames: (chunk) => {
          if (chunk.name === 'sw') return 'sw.js';
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
});
