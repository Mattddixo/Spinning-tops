import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

// 3 entry points, one Forge resource (see resources[].entry in manifest.yml).
// --mode harness swaps in a fake @forge/bridge for the browser tests.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react()],
  resolve: {
    alias: (mode === 'harness'
      ? { '@forge/bridge': fileURLToPath(new URL('./src/harness/bridge-mock.ts', import.meta.url)) }
      : {}) as Record<string, string>,
  },
  server: { fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
  build: {
    target: 'es2022',
    sourcemap: false,
    // swagger-ui is big; Forge allows 100 MB per resource
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: {
        macro: `${root}macro.html`,
        config: `${root}config.html`,
        admin: `${root}admin.html`,
      },
    },
  },
}));
