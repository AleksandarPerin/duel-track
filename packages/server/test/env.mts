// Environment for integration tests. Defaults point at the docker-compose
// Postgres and Redis; TEST_DATABASE_URL / TEST_REDIS_URL override them (CI).
// The database name must end in "_test": resetDb() refuses anything else.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://dueltrack:dueltrack_dev@localhost:5432/dueltrack_test';

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
  JWT_SECRET: 'integration-test-access-secret-not-for-production',
  JWT_REFRESH_SECRET: 'integration-test-refresh-secret-not-for-production',
  CORS_ORIGIN: 'http://localhost:5173',
  TRUST_PROXY_HOPS: '0',
  // Each test signs up several users (2 auth calls each); a test that needs
  // the real limit sets its own.
  AUTH_RATE_LIMIT_MAX: '1000',
};
