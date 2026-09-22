import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/paper-knowledge-graph/',
  plugins: [react()],
  server: {
    port: 5185,
  },
  // graph.js が top-level await で public/data を fetch するため
  build: { target: 'esnext' },
  esbuild: { target: 'esnext' },
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
});
