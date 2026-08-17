import Redis, { type RedisOptions } from 'ioredis';

const url = process.env.REDIS_URL;

if (!url) {
  throw new Error('REDIS_URL environment variable is required');
}

// Factory so both the app client and BullMQ workers can share the same
// base config (timeouts, SSL) without duplicating it. `overrides` lets a
// caller with different needs (e.g. a long-lived pub/sub subscriber, which
// should queue commands through a reconnect rather than give up after a
// few retries) tweak specific options without duplicating the rest.
export function createRedisClient(overrides: RedisOptions = {}): Redis {
  return new Redis(url!, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    connectTimeout: 3_000,
    commandTimeout: 5_000,
    enableReadyCheck: true,
    ...overrides,
  });
}
