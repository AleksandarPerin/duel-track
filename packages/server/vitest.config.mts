import { defineConfig } from 'vitest/config';
import { TEST_ENV } from './test/env.mts';

export default defineConfig({
  test: {
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
