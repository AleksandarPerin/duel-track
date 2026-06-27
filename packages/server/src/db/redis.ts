import { createRedisClient } from './createRedisClient';

export const redis = createRedisClient();

redis.on('error', (err) => {
  console.error('Redis client error', err);
});
