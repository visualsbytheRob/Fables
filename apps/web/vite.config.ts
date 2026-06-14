import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { Plugin } from 'vite';

// ─── F1262 Subresource Integrity (SRI) ───────────────────────────────────────
//
// Vite 7 does not ship a first-party SRI integration — the html-transform hook
// runs before chunk hashing is complete, so there's no clean way to intercept
// the final <script>/<link> tags from within a standard transform plugin.
//
// What IS cleanly achievable:
//   • After the build completes we scan dist/assets/ for all emitted JS/CSS
//     chunks (which Vite already fingerprints via content hash in the filename).
//   • We compute sha384 integrity hashes for each asset and write a JSON
//     manifest at dist/sri-manifest.json.
//   • The server can use this manifest to add `integrity=` attributes on any
//     <script> / <link> tags it injects when serving index.html, or a strict
//     Content-Security-Policy `require-sri-for` header.
//
// Limitation: Vite rewrites index.html *before* this hook fires, so the
// index.html in dist/ does NOT contain inline `integrity=` attributes.  Adding
// them would require a secondary parse + rewrite of the HTML file, which is
// feasible but was deferred to avoid brittle regex patching.  The manifest is
// the safe, maintainable deliverable for F1262.

function sriManifestPlugin(): Plugin {
  return {
    name: 'fables-sri-manifest',
    apply: 'build',
    // closeBundle runs after Vite has written all output files.
    closeBundle() {
      const distAssets = resolve(__dirname, 'dist', 'assets');
      let files: string[];
      try {
        files = readdirSync(distAssets);
      } catch {
        // dist/assets doesn't exist yet (e.g. build failed earlier) — skip.
        return;
      }

      const manifest: Record<string, string> = {};

      for (const file of files) {
        if (!file.endsWith('.js') && !file.endsWith('.css')) continue;
        const full = join(distAssets, file);
        try {
          if (!statSync(full).isFile()) continue;
          const content = readFileSync(full);
          const hash = createHash('sha384').update(content).digest('base64');
          manifest[`/assets/${file}`] = `sha384-${hash}`;
        } catch {
          // skip unreadable files
        }
      }

      const out = join(resolve(__dirname, 'dist'), 'sri-manifest.json');
      writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
      console.warn(
        `[fables-sri] wrote sri-manifest.json with ${Object.keys(manifest).length} asset hashes`,
      );
    },
  };
}

// API requests proxy to the Fastify server in dev; in production the server
// serves the built web app itself, so everything is same-origin.
export default defineConfig({
  plugins: [react(), sriManifestPlugin()],
  resolve: {
    alias: {
      // Until `pnpm install` runs and creates the workspace symlink,
      // resolve @fables/sync directly to the local source tree.
      // After install this alias is redundant but harmless.
      '@fables/sync': resolve(__dirname, '../../packages/sync/src/index.ts'),
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
