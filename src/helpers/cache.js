import logger from '../config/logger.js';
import eventBus, { EVENTS } from '../core/events/EventBus.js';

/**
 * In-Memory fallback cache with TTL support
 */
class InMemoryCache {
  constructor() {
    this._store = new Map();
  }

  get(key) {
    const item = this._store.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this._store.delete(key);
      return null;
    }
    return item.value;
  }

  set(key, value, ttlSeconds = 60) {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this._store.set(key, { value, expiresAt });
  }

  del(key) {
    this._store.delete(key);
  }

  delPattern(pattern) {
    // Converts basic glob/prefix (e.g. 'docker:*') into regex
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    for (const key of this._store.keys()) {
      if (regex.test(key)) {
        this._store.delete(key);
      }
    }
  }

  flush() {
    this._store.clear();
  }

  size() {
    return this._store.size;
  }
}

/**
 * Unified Cache Layer with Redis + In-Memory Fallback
 */
export class CacheService {
  constructor() {
    this._redis = null;
    this._memory = new InMemoryCache();
    this._prefix = 'panelku:cache:';
    this._isEventBusListening = false;
  }

  /**
   * Set or update Redis instance
   */
  setClient(redisClient) {
    this._redis = redisClient;
  }

  /**
   * Get active Redis client
   */
  getClient() {
    return this._redis;
  }

  /**
   * Check if Redis is ready and usable
   */
  isRedisAvailable() {
    return !!(this._redis && this._redis.status === 'ready');
  }

  /**
   * Retrieve cached item
   */
  async get(key) {
    const fullKey = this._prefix + key;
    try {
      if (this.isRedisAvailable()) {
        const data = await this._redis.get(fullKey);
        if (!data) return null;
        try {
          return JSON.parse(data);
        } catch {
          return data;
        }
      }
    } catch (err) {
      logger.warn(`Cache Redis get failed for key "${key}": ${err.message}. Falling back to memory.`);
    }

    return this._memory.get(fullKey);
  }

  /**
   * Store item in cache with TTL (seconds)
   */
  async set(key, value, ttlSeconds = 60) {
    const fullKey = this._prefix + key;
    try {
      if (this.isRedisAvailable()) {
        const payload = JSON.stringify(value);
        if (ttlSeconds > 0) {
          await this._redis.set(fullKey, payload, 'EX', ttlSeconds);
        } else {
          await this._redis.set(fullKey, payload);
        }
        return true;
      }
    } catch (err) {
      logger.warn(`Cache Redis set failed for key "${key}": ${err.message}. Falling back to memory.`);
    }

    this._memory.set(fullKey, value, ttlSeconds);
    return true;
  }

  /**
   * Delete item by key
   */
  async del(key) {
    const fullKey = this._prefix + key;
    try {
      if (this.isRedisAvailable()) {
        await this._redis.del(fullKey);
      }
    } catch (err) {
      logger.warn(`Cache Redis del failed for key "${key}": ${err.message}.`);
    }

    this._memory.del(fullKey);
    return true;
  }

  /**
   * Delete keys matching a pattern (e.g. 'metrics:*')
   */
  async delPattern(pattern) {
    const fullPattern = this._prefix + pattern;
    try {
      if (this.isRedisAvailable()) {
        const keys = await this._redis.keys(fullPattern);
        if (keys && keys.length > 0) {
          await this._redis.del(...keys);
        }
      }
    } catch (err) {
      logger.warn(`Cache Redis delPattern failed for pattern "${pattern}": ${err.message}.`);
    }

    this._memory.delPattern(fullPattern);
    return true;
  }

  /**
   * Get or compute & cache value (Cache-Aside pattern)
   */
  async remember(key, ttlSeconds, fetcherFn) {
    const cached = await this.get(key);
    if (cached !== null && cached !== undefined) {
      return cached;
    }

    const fresh = await fetcherFn();
    if (fresh !== undefined) {
      await this.set(key, fresh, ttlSeconds);
    }
    return fresh;
  }

  /**
   * Flush all cached keys
   */
  async flush() {
    try {
      if (this.isRedisAvailable()) {
        const keys = await this._redis.keys(this._prefix + '*');
        if (keys && keys.length > 0) {
          await this._redis.del(...keys);
        }
      }
    } catch (err) {
      logger.warn(`Cache Redis flush failed: ${err.message}.`);
    }

    this._memory.flush();
    return true;
  }

  /**
   * Automatically invalidate domain caches on EventBus events
   */
  initEventBusInvalidation() {
    if (this._isEventBusListening) return;
    this._isEventBusListening = true;

    eventBus.subscribe(EVENTS.DOCKER_EVENT, async () => {
      await this.delPattern('docker:*');
    }, 'cache_invalidation_docker');

    eventBus.subscribe(EVENTS.USER_UPDATED, async (data) => {
      if (data?.userId) await this.del(`user:${data.userId}`);
      await this.delPattern('rbac:*');
    }, 'cache_invalidation_user');

    eventBus.subscribe(EVENTS.USER_DELETED, async (data) => {
      if (data?.userId) await this.del(`user:${data.userId}`);
      await this.delPattern('rbac:*');
    }, 'cache_invalidation_user_deleted');

    eventBus.subscribe(EVENTS.BACKUP_COMPLETE, async () => {
      await this.delPattern('backup:*');
    }, 'cache_invalidation_backup');

    logger.info('Cache: EventBus auto-invalidation active');
  }
}

// Global singleton
const cache = new CacheService();
export default cache;
