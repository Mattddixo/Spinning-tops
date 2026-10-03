import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'static/app/test/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
  },
});
