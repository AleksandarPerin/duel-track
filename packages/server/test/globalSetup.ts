import path from 'node:path';
import { Client } from 'pg';
import { runner } from 'node-pg-migrate';
import { TEST_DATABASE_URL } from './env.mts';

// Runs once before the integration project: creates the test database if it
// is missing and brings it to the latest migration. Fails loudly (no skip)
// when Postgres is unreachable — integration tests are part of `npm test`.
export default async function setup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to use "${dbName}" for integration tests: the name must end in _test`);
  }

  const admin = new Client({ connectionString: Object.assign(new URL(url), { pathname: '/postgres' }).toString() });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(
      `Integration tests need Postgres at ${url.host} (run \`npm run docker:up\`): ${(err as Error).message}`,
    );
  }
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (rowCount === 0) await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }

  await runner({
    databaseUrl: TEST_DATABASE_URL,
    dir: path.resolve(__dirname, '../migrations'),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: () => {},
  });
}
