/**
 * Unit test: helpers/cache.js — CacheService & InMemoryCache
 *
 * @jest-environment node
 */
import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import cache, { CacheService } from '../src/helpers/cache.js';
import eventBus, { EVENTS } from '../src/core/events/EventBus.js';

describe('CacheService (In-Memory Engine)', () => {
  let cacheInstance;

  beforeEach(() => {
    cacheInstance = new CacheService();
    cacheInstance.flush();
  });

  test('set and get string/number/object', async () => {
    await cacheInstance.set('str_key', 'hello world', 60);
    await cacheInstance.set('num_key', 42, 60);
    await cacheInstance.set('obj_key', { a: 1, b: 'two' }, 60);

    expect(await cacheInstance.get('str_key')).toBe('hello world');
    expect(await cacheInstance.get('num_key')).toBe(42);
    expect(await cacheInstance.get('obj_key')).toEqual({ a: 1, b: 'two' });
  });

  test('get non-existent key returns null', async () => {
    const res = await cacheInstance.get('non_existent');
    expect(res).toBeNull();
  });

  test('expired item returns null', async () => {
    // 0.05 second TTL (50ms)
    await cacheInstance.set('short_lived', 'temp', 0.05);
    expect(await cacheInstance.get('short_lived')).toBe('temp');

    await new Promise((r) => setTimeout(r, 70));
    expect(await cacheInstance.get('short_lived')).toBeNull();
  });

  test('del removes a specific key', async () => {
    await cacheInstance.set('to_del', 'value', 60);
    expect(await cacheInstance.get('to_del')).toBe('value');

    await cacheInstance.del('to_del');
    expect(await cacheInstance.get('to_del')).toBeNull();
  });

  test('delPattern deletes matching prefix/pattern keys', async () => {
    await cacheInstance.set('docker:containers', [1, 2], 60);
    await cacheInstance.set('docker:images', ['node:20'], 60);
    await cacheInstance.set('system:info', { cpu: 10 }, 60);

    await cacheInstance.delPattern('docker:*');

    expect(await cacheInstance.get('docker:containers')).toBeNull();
    expect(await cacheInstance.get('docker:images')).toBeNull();
    expect(await cacheInstance.get('system:info')).toEqual({ cpu: 10 });
  });

  test('remember executes fetcher only when key is missing', async () => {
    const fetcher = jest.fn().mockResolvedValue({ calculated: 100 });

    // First call calls fetcher
    const res1 = await cacheInstance.remember('calc_key', 60, fetcher);
    expect(res1).toEqual({ calculated: 100 });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Second call uses cached result
    const res2 = await cacheInstance.remember('calc_key', 60, fetcher);
    expect(res2).toEqual({ calculated: 100 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('flush clears all keys', async () => {
    await cacheInstance.set('k1', 1, 60);
    await cacheInstance.set('k2', 2, 60);

    await cacheInstance.flush();

    expect(await cacheInstance.get('k1')).toBeNull();
    expect(await cacheInstance.get('k2')).toBeNull();
  });
});

describe('CacheService (Redis Engine & Fallback)', () => {
  let cacheInstance;
  let mockRedis;

  beforeEach(() => {
    cacheInstance = new CacheService();
    mockRedis = {
      status: 'ready',
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      keys: jest.fn(),
    };
    cacheInstance.setClient(mockRedis);
  });

  test('isRedisAvailable returns true when status is ready', () => {
    expect(cacheInstance.isRedisAvailable()).toBe(true);
    mockRedis.status = 'end';
    expect(cacheInstance.isRedisAvailable()).toBe(false);
  });

  test('get uses redis when available and parses JSON', async () => {
    mockRedis.get.mockResolvedValueOnce(JSON.stringify({ from: 'redis' }));

    const res = await cacheInstance.get('my_key');
    expect(mockRedis.get).toHaveBeenCalledWith('panelku:cache:my_key');
    expect(res).toEqual({ from: 'redis' });
  });

  test('get falls back to memory when redis throws', async () => {
    mockRedis.get.mockRejectedValueOnce(new Error('Redis connection lost'));

    // Set item in memory fallback
    cacheInstance._memory.set('panelku:cache:my_key', { fallback: true }, 60);

    const res = await cacheInstance.get('my_key');
    expect(res).toEqual({ fallback: true });
  });

  test('set writes to redis with EX when available', async () => {
    mockRedis.set.mockResolvedValueOnce('OK');

    await cacheInstance.set('redis_key', { val: 123 }, 30);
    expect(mockRedis.set).toHaveBeenCalledWith(
      'panelku:cache:redis_key',
      JSON.stringify({ val: 123 }),
      'EX',
      30
    );
  });

  test('delPattern queries redis keys and deletes them', async () => {
    mockRedis.keys.mockResolvedValueOnce(['panelku:cache:docker:1', 'panelku:cache:docker:2']);
    mockRedis.del.mockResolvedValueOnce(2);

    await cacheInstance.delPattern('docker:*');
    expect(mockRedis.keys).toHaveBeenCalledWith('panelku:cache:docker:*');
    expect(mockRedis.del).toHaveBeenCalledWith('panelku:cache:docker:1', 'panelku:cache:docker:2');
  });
});

describe('CacheService (EventBus Invalidation)', () => {
  test('docker event triggers pattern invalidation', async () => {
    const cacheInstance = new CacheService();
    cacheInstance.initEventBusInvalidation();

    await cacheInstance.set('docker:list', ['nginx'], 60);
    expect(await cacheInstance.get('docker:list')).toEqual(['nginx']);

    eventBus.publish(EVENTS.DOCKER_EVENT, { action: 'start' });

    // Wait a tick for async subscriber
    await new Promise((r) => setTimeout(r, 20));
    expect(await cacheInstance.get('docker:list')).toBeNull();
  });
});
