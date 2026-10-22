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
    this._health = {
      status: 'not_configured',
      available: false,
      reconnectAttempts: 0,
      errors: 0,
      lastError: null,
      lastErrorAt: null,
      connectedAt: null,
      lastPingAt: null,
      latencyMs: null,
    };
    this._pingTimer = null;
    this._redisListenersAttached = false;
  }

  /**
   * Set or update Redis instance
   */
  setClient(redisClient) {
    this._redis = redisClient;
    this._health.available = this.isRedisAvailable();
  }

  /**
   * Human-readable error description. Some ioredis errors have an empty
   * `message`, so include code/name to keep logs diagnosable.
   */
  static describeRedisError(err) {
    if (!err) return 'unknown';
    return err.code || err.name || err.message || String(err) || 'unknown';
  }

  /**
   * Attach Redis lifecycle listeners and keep a health snapshot.
   * Safe to call more than once.
   */
  trackRedisEvents(redisClient = this._redis) {
    if (!redisClient) return;
    this.setClient(redisClient);
    if (this._redisListenersAttached) return;
    this._redisListenersAttached = true;

    redisClient.on('ready', () => {
      this._health = {
        ...this._health,
        status: 'ready',
        available: true,
        connectedAt: new Date().toISOString(),
        lastError: null,
      };
      logger.info('Redis connected — cache and queues use Redis');
    });

    redisClient.on('connecting', () => {
      this._health.status = 'connecting';
      this._health.available = false;
    });

    redisClient.on('reconnecting', (delay) => {
      this._health.status = 'reconnecting';
      this._health.available = false;
      this._health.reconnectAttempts += 1;
      logger.warn(
        `Redis reconnecting (attempt ${this._health.reconnectAttempts})` +
        `${delay ? ` in ${delay}ms` : ''} — using in-memory cache meanwhile`
      );
    });

    redisClient.on('close', () => {
      this._health.status = 'closed';
      this._health.available = false;
    });

    redisClient.on('end', () => {
      this._health.status = 'end';
      this._health.available = false;
    });

    redisClient.on('error', (err) => {
      const reason = CacheService.describeRedisError(err);
      this._health.errors += 1;
      this._health.lastError = reason;
      this._health.lastErrorAt = new Date().toISOString();
      this._health.available = false;
      logger.warn(`Redis error [${reason}] — panel continues with in-memory cache`);
    });
  }

  /**
   * Periodically PING Redis so a half-open connection is detected, and so the
   * health indicator reflects the real connection state.
   */
  startHealthMonitor(intervalMs = 30000) {
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._pingTimer = setInterval(async () => {
      if (!this.isRedisAvailable()) return;
      const started = Date.now();
      try {
        await this._redis.ping();
        this._health.latencyMs = Date.now() - started;
        this._health.lastPingAt = new Date().toISOString();
        this._health.status = 'ready';
        this._health.available = true;
      } catch (err) {
        const reason = CacheService.describeRedisError(err);
        this._health.errors += 1;
        this._health.lastError = reason;
        this._health.lastErrorAt = new Date().toISOString();
        this._health.available = false;
        logger.warn(`Redis ping failed [${reason}]`);
      }
    }, intervalMs);
    // Do not keep Jest / short-lived scripts alive.
    if (typeof this._pingTimer.unref === 'function') this._pingTimer.unref();
    return this._pingTimer;
  }

  stopHealthMonitor() {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }

  /**
   * Snapshot for /api/health and monitoring tools.
   */
  getRedisHealth() {
    if (!this._redis) {
      return {
        configured: false,
        available: false,
        status: 'not_configured',
        lastError: null,
      };
    }

    const clientStatus = this._redis.status || this._health.status || 'unknown';
    const available = this.isRedisAvailable();
    return {
      configured: true,
      available,
      status: available ? 'ready' : clientStatus,
      reconnectAttempts: this._health.reconnectAttempts,
      errors: this._health.errors,
      lastError: this._health.lastError,
      lastErrorAt: this._health.lastErrorAt,
      connectedAt: this._health.connectedAt,
      lastPingAt: this._health.lastPingAt,
      latencyMs: this._health.latencyMs,
    };
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

    const invalidateWebsites = async () => {
      await this.delPattern('websites:*');
    };
    eventBus.subscribe(EVENTS.WEBSITE_CREATED, invalidateWebsites, 'cache_invalidation_website_created');
    eventBus.subscribe(EVENTS.WEBSITE_UPDATED, invalidateWebsites, 'cache_invalidation_website_updated');
    eventBus.subscribe(EVENTS.WEBSITE_DELETED, invalidateWebsites, 'cache_invalidation_website_deleted');
    eventBus.subscribe(EVENTS.DEPLOY_COMPLETE, invalidateWebsites, 'cache_invalidation_website_deployed');

    logger.info('Cache: EventBus auto-invalidation active');
  }
}

// Global singleton
const cache = new CacheService();
export default cache;
