import { describe, it, expect } from 'vitest';
import { pool } from './db/pool';
import { redis } from './db/redis';
import { createTestApp } from '../test/harness';

// app.close() releases the shared Postgres pool and Redis client, so a test
// file (or a process that closes the app) can exit without hanging.
describe('app.close()', () => {
  it('ends the Postgres pool and the Redis client', async () => {
    const app = await createTestApp();
    await redis.ping();
    const redisEnded = new Promise((resolve) => redis.once('end', resolve));
    await app.close();
    expect(pool.ended).toBe(true);
    // ioredis emits 'end' once the socket has closed, just after quit() resolves.
    await redisEnded;
    expect(redis.status).toBe('end');
  });
});
