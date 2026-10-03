import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'static/app/test/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      // Backend, shared code and the UI's plain modules. React components
      // (.tsx) are exercised by the Playwright suite instead.
      include: ['src/**/*.ts', 'static/app/src/**/*.ts'],
      exclude: ['static/app/src/harness/**', '**/*.d.ts'],
      reporter: ['text', 'text-summary', 'html'],
      // A little under the current numbers, so coverage can't quietly slide.
      thresholds: { statements: 85, branches: 75, functions: 90, lines: 89.5 },
    },
  },
});
