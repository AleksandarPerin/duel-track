import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

const ssl =
  process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: true }
    : process.env.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: false }
      : false;

export const pool = new Pool({
  connectionString,
  max: Number(process.env.POOL_MAX ?? 20),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
  ssl,
  // Prevent runaway queries from holding connections (PRD §6.4)
  options: '-c statement_timeout=5000',
});

// Replaceable logger so buildApp() can swap in the structured Fastify logger
// after it is created. Falls back to console.error before app init.
let poolLog: (msg: string, err: Error) => void = (msg, err) =>
  console.error(msg, err);

export function setPoolLogger(fn: (msg: string, err: Error) => void): void {
  poolLog = fn;
}

pool.on('error', (err) => {
  // Log but do not exit — pg.Pool reconnects automatically after transient errors
  poolLog('Unexpected error on idle Postgres client', err);
});
