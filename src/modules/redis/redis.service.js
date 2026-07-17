import Redis from 'ioredis';
import redisConfig from '../../config/redis.js';

class RedisService {
  constructor() {
    this._connection = null;
  }

  /**
   * Get or create a Redis connection for management purposes.
   * Uses a separate connection from the panel's internal one.
   */
  async _getConnection() {
    if (this._connection) {
      try {
        await this._connection.ping();
        return this._connection;
      } catch {
        // Connection lost, create new one
        try { await this._connection.quit(); } catch {}
        this._connection = null;
      }
    }

    this._connection = new Redis({
      ...redisConfig,
      lazyConnect: true,
      keyPrefix: '', // Don't use prefix for management
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });

    try {
      await this._connection.connect();
    } catch (err) {
      this._connection = null;
      throw new Error(`Failed to connect to Redis: ${err.message}`);
    }

    return this._connection;
  }

  // ── Server Info ──────────────────────────────────────

  /**
   * Get Redis server info.
   */
  async getInfo() {
    const redis = await this._getConnection();

    try {
      const rawInfo = await redis.info();
      const info = this._parseInfo(rawInfo);

      return {
        connected: true,
        version: info.redis_version || 'unknown',
        uptimeInSeconds: parseInt(info.uptime_in_seconds) || 0,
        connectedClients: parseInt(info.connected_clients) || 0,
        usedMemory: parseInt(info.used_memory) || 0,
        usedMemoryHuman: info.used_memory_human || '0B',
        usedMemoryPeak: parseInt(info.used_memory_peak) || 0,
        usedMemoryPeakHuman: info.used_memory_peak_human || '0B',
        memFragmentationRatio: parseFloat(info.mem_fragmentation_ratio) || 0,
        totalConnectionsReceived: parseInt(info.total_connections_received) || 0,
        totalCommandsProcessed: parseInt(info.total_commands_processed) || 0,
        instantaneousOpsPerSec: parseInt(info.instantaneous_ops_per_sec) || 0,
        instantaneousInputKbps: parseFloat(info.instantaneous_input_kbps) || 0,
        instantaneousOutputKbps: parseFloat(info.instantaneous_output_kbps) || 0,
        keyspaceHits: parseInt(info.keyspace_hits) || 0,
        keyspaceMisses: parseInt(info.keyspace_misses) || 0,
        hitRatio: this._calcHitRatio(info.keyspace_hits, info.keyspace_misses),
        role: info.role || 'master',
        connectedSlaves: parseInt(info.connected_slaves) || 0,
        usedCpuSys: parseFloat(info.used_cpu_sys) || 0,
        usedCpuUser: parseFloat(info.used_cpu_user) || 0,
        serverInfo: {
          os: info.os || 'unknown',
          arch: info.arch || 'unknown',
          processId: parseInt(info.process_id) || 0,
          tcpPort: parseInt(info.tcp_port) || 6379,
          runId: info.run_id || '',
          mode: info.redis_mode || 'standalone',
        },
        persistence: {
          loading: info.loading === '1',
          rdbEnabled: info.rdb_bgsave_in_progress === '1',
          rdbLastSave: parseInt(info.rdb_last_save_time) || 0,
          rdbLastBgsaveStatus: info.rdb_last_bgsave_status || 'unknown',
          aofEnabled: info.aof_enabled === '1',
          aofRewriteInProgress: info.aof_rewrite_in_progress === '1',
        },
        keyspace: this._parseKeyspace(rawInfo),
      };
    } catch (err) {
      throw new Error(`Failed to get Redis info: ${err.message}`);
    }
  }

  /**
   * Get real-time Redis stats for dashboard refresh.
   */
  async getStats() {
    const redis = await this._getConnection();
    try {
      const rawInfo = await redis.info();
      const info = this._parseInfo(rawInfo);

      return {
        connectedClients: parseInt(info.connected_clients) || 0,
        usedMemory: parseInt(info.used_memory) || 0,
        usedMemoryHuman: info.used_memory_human || '0B',
        instantaneousOpsPerSec: parseInt(info.instantaneous_ops_per_sec) || 0,
        hitRatio: this._calcHitRatio(info.keyspace_hits, info.keyspace_misses),
        totalCommandsProcessed: parseInt(info.total_commands_processed) || 0,
        keyspaceHits: parseInt(info.keyspace_hits) || 0,
        keyspaceMisses: parseInt(info.keyspace_misses) || 0,
        expiredKeys: parseInt(info.expired_keys) || 0,
        evictedKeys: parseInt(info.evicted_keys) || 0,
        keyspace: this._parseKeyspace(rawInfo),
      };
    } catch (err) {
      throw new Error(`Failed to get Redis stats: ${err.message}`);
    }
  }

  // ── Config Management ────────────────────────────────

  /**
   * Get Redis config parameters.
   */
  async getConfig(pattern = '*') {
    const redis = await this._getConnection();
    try {
      // Get all config params matching pattern
      const result = await redis.config('GET', pattern);
      const configs = [];
      for (let i = 0; i < result.length; i += 2) {
        configs.push({
          key: result[i],
          value: result[i + 1],
        });
      }
      return configs;
    } catch (err) {
      throw new Error(`Failed to get Redis config: ${err.message}`);
    }
  }

  /**
   * Set a Redis config parameter.
   */
  async setConfig(key, value) {
    if (!key || typeof key !== 'string') throw new Error('Config key is required');
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/.test(key)) throw new Error('Invalid config key');
    if (!value || typeof value !== 'string') throw new Error('Config value is required');

    const redis = await this._getConnection();
    try {
      await redis.config('SET', key, value);
      return { message: `Config "${key}" updated to "${value}".` };
    } catch (err) {
      throw new Error(`Failed to set config "${key}": ${err.message}`);
    }
  }

  // ── Keyspace Operations ──────────────────────────────

  /**
   * Get keys in a database.
   */
  async scanKeys(db = 0, cursor = '0', match = '*', count = 50) {
    const redis = await this._getConnection();
    const safeDb = parseInt(db) || 0;
    const safeCount = Math.min(Math.max(parseInt(count) || 50, 1), 500);

    try {
      await redis.select(safeDb);
      const [nextCursor, keys] = await redis.scan(
        cursor,
        'MATCH', match,
        'COUNT', safeCount
      );

      // Get types and TTLs for found keys (batched via pipeline)
      const pipeline = redis.pipeline();
      for (const keyname of keys) {
        pipeline.type(keyname);
        pipeline.ttl(keyname);
      }
      const pipelineResults = await pipeline.exec();
      const keyDetails = keys.map((keyname, i) => {
        const typeResult = pipelineResults[i * 2];
        const ttlResult = pipelineResults[i * 2 + 1];
        const type = typeResult && !typeResult[0] ? typeResult[1] : 'unknown';
        const ttl = ttlResult && !ttlResult[0] ? (ttlResult[1] >= 0 ? ttlResult[1] : -1) : -1;
        return { key: keyname, type, ttl };
      });

      await redis.select(redisConfig.db || 0); // Switch back
      return { cursor: nextCursor, keys: keyDetails, count: keyDetails.length };
    } catch (err) {
      try { await redis.select(redisConfig.db || 0); } catch {}
      throw new Error(`Failed to scan keys: ${err.message}`);
    }
  }

  /**
   * Get key value (for string types).
   */
  async getKeyValue(key) {
    if (!key) throw new Error('Key is required');
    const redis = await this._getConnection();
    try {
      const type = await redis.type(key);
      let value;
      let ttl = -1;

      try { ttl = await redis.ttl(key); } catch {}

      switch (type) {
        case 'string':
          value = await redis.get(key);
          break;
        case 'list':
          value = await redis.lrange(key, 0, -1);
          break;
        case 'set':
          value = await redis.smembers(key);
          break;
        case 'zset':
          value = await redis.zrange(key, 0, -1, 'WITHSCORES');
          break;
        case 'hash':
          value = await redis.hgetall(key);
          break;
        default:
          value = '(unknown type)';
      }

      return { key, type, value, ttl: ttl >= 0 ? ttl : -1 };
    } catch (err) {
      throw new Error(`Failed to get key "${key}": ${err.message}`);
    }
  }

  /**
   * Delete a key.
   */
  async deleteKey(key) {
    if (!key) throw new Error('Key is required');
    const redis = await this._getConnection();
    try {
      await redis.del(key);
      return { message: `Key "${key}" deleted.` };
    } catch (err) {
      throw new Error(`Failed to delete key "${key}": ${err.message}`);
    }
  }

  /**
   * Set key TTL (expiry).
   */
  async setKeyTtl(key, seconds) {
    if (!key) throw new Error('Key is required');
    const safeSeconds = parseInt(seconds);
    if (isNaN(safeSeconds) || safeSeconds < -1) throw new Error('Invalid TTL value');

    const redis = await this._getConnection();
    try {
      if (safeSeconds === -1) {
        await redis.persist(key);
        return { message: `TTL removed for "${key}".` };
      }
      await redis.expire(key, safeSeconds);
      return { message: `TTL set to ${safeSeconds}s for "${key}".` };
    } catch (err) {
      throw new Error(`Failed to set TTL: ${err.message}`);
    }
  }

  // ── Database Operations ──────────────────────────────

  /**
   * Flush current database.
   */
  async flushDb() {
    const redis = await this._getConnection();
    try {
      await redis.flushdb();
      return { message: 'Current database flushed.' };
    } catch (err) {
      throw new Error(`Failed to flush database: ${err.message}`);
    }
  }

  /**
   * Flush all databases.
   */
  async flushAll() {
    const redis = await this._getConnection();
    try {
      await redis.flushall();
      return { message: 'All databases flushed.' };
    } catch (err) {
      throw new Error(`Failed to flush all databases: ${err.message}`);
    }
  }

  /**
   * Trigger SAVE.
   */
  async save() {
    const redis = await this._getConnection();
    try {
      await redis.save();
      return { message: 'SAVE completed.' };
    } catch (err) {
      throw new Error(`SAVE failed: ${err.message}`);
    }
  }

  /**
   * Trigger BGSAVE.
   */
  async bgsave() {
    const redis = await this._getConnection();
    try {
      await redis.bgsave();
      return { message: 'BGSAVE triggered.' };
    } catch (err) {
      throw new Error(`BGSAVE failed: ${err.message}`);
    }
  }

  // ── Client Management ────────────────────────────────

  /**
   * Get connected clients.
   */
  async getClients() {
    const redis = await this._getConnection();
    try {
      const rawClients = await redis.client('LIST');
      const lines = rawClients.split('\n').filter(Boolean);
      return lines.map(line => {
        const parts = {};
        line.trim().split(' ').forEach(p => {
          const [key, ...vals] = p.split('=');
          parts[key] = vals.join('=');
        });
        return {
          id: parts.id || '',
          addr: parts.addr || '',
          fd: parts.fd || '',
          name: parts.name || '',
          age: parseInt(parts.age) || 0,
          idle: parseInt(parts.idle) || 0,
          flags: parts.flags || '',
          db: parseInt(parts.db) || 0,
          sub: parseInt(parts.sub) || 0,
          psub: parseInt(parts.psub) || 0,
          multi: parseInt(parts.multi) || -1,
          qbuf: parseInt(parts.qbuf) || 0,
          obl: parseInt(parts.obl) || 0,
          oll: parseInt(parts.oll) || 0,
          omem: parseInt(parts.omem) || 0,
          events: parts.events || '',
          cmd: parts.cmd || '',
        };
      });
    } catch (err) {
      throw new Error(`Failed to get clients: ${err.message}`);
    }
  }

  /**
   * Kill a client connection.
   */
  async killClient(addr) {
    if (!addr) throw new Error('Client address is required');
    const redis = await this._getConnection();
    try {
      await redis.client('KILL', addr);
      return { message: `Client "${addr}" killed.` };
    } catch (err) {
      throw new Error(`Failed to kill client: ${err.message}`);
    }
  }

  // ── Slow Log ─────────────────────────────────────────

  /**
   * Get slow log entries.
   */
  async getSlowLog(count = 10) {
    const redis = await this._getConnection();
    const safeCount = Math.min(Math.max(parseInt(count) || 10, 1), 100);
    try {
      const entries = await redis.slowLog('GET', safeCount);
      return entries.map(entry => ({
        id: entry[0],
        timestamp: entry[1],
        durationUs: entry[2],
        command: Array.isArray(entry[3]) ? entry[3].join(' ') : entry[3],
        clientAddr: entry[4] || '',
        clientName: entry[5] || '',
      }));
    } catch (err) {
      throw new Error(`Failed to get slow log: ${err.message}`);
    }
  }

  // ── Helpers ──────────────────────────────────────────

  /**
   * Parse Redis INFO output into key-value object.
   */
  _parseInfo(raw) {
    const info = {};
    const lines = raw.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('$')) continue;
      const sepIndex = trimmed.indexOf(':');
      if (sepIndex > 0) {
        const key = trimmed.substring(0, sepIndex).trim();
        const value = trimmed.substring(sepIndex + 1).trim();
        info[key] = value;
      }
    }
    return info;
  }

  /**
   * Parse keyspace section from Redis INFO.
   */
  _parseKeyspace(raw) {
    const keyspace = [];
    const lines = raw.split('\n');
    let inKeyspace = false;

    for (const line of lines) {
      if (line.trim() === '# Keyspace') { inKeyspace = true; continue; }
      if (inKeyspace && line.startsWith('#')) break;
      if (inKeyspace && line.includes(':')) {
        const sepIndex = line.indexOf(':');
        const dbName = line.substring(0, sepIndex).trim();
        const rawValues = line.substring(sepIndex + 1).trim();
        const parts = {};
        rawValues.split(',').forEach(p => {
          const [k, v] = p.split('=');
          parts[k.trim()] = parseInt(v) || 0;
        });
        keyspace.push({
          db: dbName,
          keys: parts.keys || 0,
          expires: parts.expires || 0,
          avgTtl: parts.avg_ttl || 0,
        });
      }
    }
    return keyspace;
  }

  /**
   * Calculate hit ratio.
   */
  _calcHitRatio(hits, misses) {
    const h = parseInt(hits) || 0;
    const m = parseInt(misses) || 0;
    const total = h + m;
    if (total === 0) return 0;
    return parseFloat(((h / total) * 100).toFixed(2));
  }
}

export default new RedisService();
