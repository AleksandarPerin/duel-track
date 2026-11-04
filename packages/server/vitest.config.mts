import { defineConfig } from 'vitest/config';
import { TEST_ENV } from './test/env.mts';

export default defineConfig({
  test: {
    // Floors at the measured coverage (`npm run test:coverage`); raise them as
    // tests are added, never lower them.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: { statements: 47, branches: 38, functions: 46, lines: 49 },
    },
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.int.test.ts'],
        },
      },
      {
        // app.inject() against a real, migrated Postgres test database and a
        // separate Redis logical database. Files run one at a time because
        // each test wipes the shared database.
        test: {
          name: 'integration',
          include: ['src/**/*.int.test.ts'],
          globalSetup: ['test/globalSetup.ts'],
          env: TEST_ENV,
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
