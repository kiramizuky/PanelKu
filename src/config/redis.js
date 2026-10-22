import 'dotenv/config';

/**
 * Redis reconnection policy.
 *
 * [Sprint 1] ioredis used to give up permanently after 10 attempts. On a
 * homeserver without Redis (or with a Redis that starts after the panel) the
 * panel then used the in-memory cache forever and never recovered.
 *
 * Retry forever with exponential backoff, capped at 30 seconds. Jitter avoids
 * a thundering herd when several processes reconnect at the same time.
 */
export const REDIS_RETRY_MAX_MS = 30000;

export const redisRetryStrategy = (times) => {
  const attempt = Math.max(1, Number(times) || 1);
  const exponential = Math.min(250 * 2 ** Math.min(attempt - 1, 8), REDIS_RETRY_MAX_MS);
  const jitter = Math.floor(Math.random() * Math.max(1, Math.min(1000, exponential * 0.2)));
  return Math.min(exponential + jitter, REDIS_RETRY_MAX_MS);
};

export default {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB) || 0,
  keyPrefix: 'lp:',
  lazyConnect: true,
  connectTimeout: 10000,
  keepAlive: 10000,
  retryStrategy: redisRetryStrategy,
  // Network errors are recoverable: reconnect instead of failing the command.
  reconnectOnError: (err) => {
    const code = err?.code || err?.name || '';
    return code === 'ECONNRESET' || code === 'EPIPE' || code === 'ETIMEDOUT';
  },
};
