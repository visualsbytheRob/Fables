import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// API requests proxy to the Fastify server in dev; in production the server
// serves the built web app itself, so everything is same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.FABLES_API_URL ?? 'http://127.0.0.1:4870',
        changeOrigin: true,
      },
    },
  },
});
