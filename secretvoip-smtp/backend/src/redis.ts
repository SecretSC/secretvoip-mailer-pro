import IORedis from 'ioredis';
import { env } from './env';

// BullMQ requires maxRetriesPerRequest: null on the connection it uses.
export const bullConnection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

export const redis = new IORedis(env.REDIS_URL);
