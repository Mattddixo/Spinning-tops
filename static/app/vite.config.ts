import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

// Three Custom UI entry points share one resource (see `resources[].entry` in manifest.yml).
// `--mode harness` swaps @forge/bridge for a local mock so the UI can be tested in a browser.
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
    // Swagger UI alone is ~1.5 MB; Forge resource bundles allow up to 100 MB.
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
