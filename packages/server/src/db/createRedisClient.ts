import Redis from 'ioredis';

const url = process.env.REDIS_URL;

if (!url) {
  throw new Error('REDIS_URL environment variable is required');
}

// Factory so both the app client and BullMQ workers can share the same
// base config (timeouts, SSL) without duplicating it.
export function createRedisClient(): Redis {
  return new Redis(url!, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    connectTimeout: 3_000,
    commandTimeout: 5_000,
    enableReadyCheck: true,
  });
}
