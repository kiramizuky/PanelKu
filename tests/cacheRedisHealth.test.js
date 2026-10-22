/**
 * Sprint 1 — Redis reconnection policy and health indicator.
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect } from '@jest/globals';
import { EventEmitter } from 'events';
import { CacheService } from '../src/helpers/cache.js';
import redisConfig, { redisRetryStrategy, REDIS_RETRY_MAX_MS } from '../src/config/redis.js';

class FakeRedis extends EventEmitter {
  constructor() {
    super();
    this.status = 'connecting';
    this.ping = jest.fn().mockResolvedValue('PONG');
    this.get = jest.fn();
    this.set = jest.fn();
    this.del = jest.fn();
    this.keys = jest.fn().mockResolvedValue([]);
  }
}

describe('Redis reconnection policy', () => {
  test('never gives up and caps backoff at 30 seconds', () => {
    for (const attempt of [1, 2, 5, 10, 50, 1000]) {
      const delay = redisRetryStrategy(attempt);
      expect(typeof delay).toBe('number');
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(REDIS_RETRY_MAX_MS);
    }
    expect(redisConfig.retryStrategy(10000)).toBeLessThanOrEqual(REDIS_RETRY_MAX_MS);
  });
});

describe('CacheService Redis health', () => {
  test('reports not configured without a client', () => {
    const cache = new CacheService();
    const health = cache.getRedisHealth();
    expect(health.configured).toBe(false);
    expect(health.available).toBe(false);
  });

  test('tracks ready/reconnecting/error lifecycle', () => {
    const cache = new CacheService();
    const redis = new FakeRedis();

    cache.trackRedisEvents(redis);
    expect(cache.getRedisHealth().status).toBe('connecting');

    redis.status = 'ready';
    redis.emit('ready');
    let health = cache.getRedisHealth();
    expect(health.available).toBe(true);
    expect(health.status).toBe('ready');

    redis.status = 'reconnecting';
    redis.emit('reconnecting', 1000);
    redis.emit('reconnecting', 2000);
    health = cache.getRedisHealth();
    expect(health.available).toBe(false);
    expect(health.reconnectAttempts).toBe(2);

    const err = new Error('');
    err.code = 'ECONNREFUSED';
    redis.emit('error', err);
    health = cache.getRedisHealth();
    expect(health.lastError).toBe('ECONNREFUSED');
    expect(health.errors).toBe(1);
  });

  test('periodic ping records latency and failures', async () => {
    const cache = new CacheService();
    const redis = new FakeRedis();
    cache.trackRedisEvents(redis);
    redis.status = 'ready';
    redis.emit('ready');

    cache.startHealthMonitor(10);
    await new Promise((r) => setTimeout(r, 35));
    cache.stopHealthMonitor();

    const health = cache.getRedisHealth();
    expect(redis.ping).toHaveBeenCalled();
    expect(health.lastPingAt).toBeTruthy();
    expect(health.latencyMs).not.toBeNull();
  });
});
