import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Floors at the measured coverage (`npm run test:coverage`); raise them as
    // tests are added, never lower them.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
