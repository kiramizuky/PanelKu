/**
 * Unit tests for Redis Module:
 * - src/modules/redis/redis.service.js
 * - src/modules/redis/redis.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockPipeline = {
  type: jest.fn().mockReturnThis(),
  ttl: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue([
    [null, 'string'],
    [null, 3600],
  ]),
};

const mockRedisInstance = {
  ping: jest.fn().mockResolvedValue('PONG'),
  connect: jest.fn().mockResolvedValue(true),
  quit: jest.fn().mockResolvedValue(true),
  info: jest.fn().mockResolvedValue(`
# Server
redis_version:7.2.4
uptime_in_seconds:86400
os:Linux
arch:x86_64
process_id:1234
tcp_port:6379
run_id:abc123run
redis_mode:standalone

# Clients
connected_clients:5

# Memory
used_memory:1048576
used_memory_human:1.00M
used_memory_peak:2097152
used_memory_peak_human:2.00M
mem_fragmentation_ratio:1.25

# Stats
total_connections_received:100
total_commands_processed:5000
instantaneous_ops_per_sec:15
instantaneous_input_kbps:1.5
instantaneous_output_kbps:2.5
keyspace_hits:800
keyspace_misses:200
expired_keys:50
evicted_keys:0

# Replication
role:master
connected_slaves:0

# CPU
used_cpu_sys:10.5
used_cpu_user:20.5

# Keyspace
db0:keys=150,expires=10,avg_ttl=50000
`),
  config: jest.fn((action, ...args) => {
    if (action === 'GET') {
      return Promise.resolve(['maxmemory', '2gb', 'timeout', '300']);
    }
    return Promise.resolve('OK');
  }),
  select: jest.fn().mockResolvedValue('OK'),
  scan: jest.fn().mockResolvedValue(['0', ['user:101']]),
  pipeline: jest.fn().mockReturnValue(mockPipeline),
  type: jest.fn().mockResolvedValue('string'),
  ttl: jest.fn().mockResolvedValue(1800),
  get: jest.fn().mockResolvedValue('my-value'),
  lrange: jest.fn().mockResolvedValue(['item1', 'item2']),
  smembers: jest.fn().mockResolvedValue(['setA', 'setB']),
  zrange: jest.fn().mockResolvedValue(['itemA', '10', 'itemB', '20']),
  hgetall: jest.fn().mockResolvedValue({ field1: 'val1' }),
  del: jest.fn().mockResolvedValue(1),
  persist: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
  flushdb: jest.fn().mockResolvedValue('OK'),
  flushall: jest.fn().mockResolvedValue('OK'),
  save: jest.fn().mockResolvedValue('OK'),
  bgsave: jest.fn().mockResolvedValue('Background saving started'),
  client: jest.fn((action) => {
    if (action === 'LIST') {
      return Promise.resolve('id=3 addr=127.0.0.1:54321 fd=7 name= age=10 idle=0 flags=N db=0 sub=0 psub=0 multi=-1 qbuf=0 obl=0 oll=0 omem=0 events=r cmd=client\n');
    }
    return Promise.resolve('OK');
  }),
  slowLog: jest.fn().mockResolvedValue([
    [1, 1718000000, 1500, ['GET', 'large_key'], '127.0.0.1:54321', 'client_1'],
  ]),
};

jest.unstable_mockModule('ioredis', () => ({
  default: jest.fn(() => mockRedisInstance),
}));

const { default: redisService } = await import('../src/modules/redis/redis.service.js');
const { default: redisController } = await import('../src/modules/redis/redis.controller.js');

function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  redisService._connection = mockRedisInstance;
});

describe('RedisService — Helpers & Stats', () => {
  test('getInfo parses raw redis info into structured object', async () => {
    const info = await redisService.getInfo();
    expect(info.connected).toBe(true);
    expect(info.version).toBe('7.2.4');
    expect(info.connectedClients).toBe(5);
    expect(info.usedMemoryHuman).toBe('1.00M');
    expect(info.hitRatio).toBe(80); // 800 hits / 1000 total = 80%
    expect(info.keyspace).toHaveLength(1);
    expect(info.keyspace[0].db).toBe('db0');
    expect(info.keyspace[0].keys).toBe(150);
  });

  test('getStats extracts high-frequency metrics', async () => {
    const stats = await redisService.getStats();
    expect(stats.connectedClients).toBe(5);
    expect(stats.instantaneousOpsPerSec).toBe(15);
    expect(stats.hitRatio).toBe(80);
  });
});

describe('RedisService — Config & Keyspace Operations', () => {
  test('getConfig returns paired key-value config objects', async () => {
    const configs = await redisService.getConfig('maxmemory*');
    expect(configs).toHaveLength(2);
    expect(configs[0]).toEqual({ key: 'maxmemory', value: '2gb' });
  });

  test('setConfig validates key format and sets parameter', async () => {
    await expect(redisService.setConfig('bad key!', '100')).rejects.toThrow('Invalid config key');
    await expect(redisService.setConfig('', '100')).rejects.toThrow('Config key is required');

    const res = await redisService.setConfig('timeout', '600');
    expect(res.message).toContain('timeout');
    expect(mockRedisInstance.config).toHaveBeenCalledWith('SET', 'timeout', '600');
  });

  test('scanKeys retrieves keys and details via pipeline', async () => {
    const scanResult = await redisService.scanKeys(0, '0', '*', 50);
    expect(scanResult.cursor).toBe('0');
    expect(scanResult.keys).toHaveLength(1);
    expect(scanResult.keys[0]).toEqual({ key: 'user:101', type: 'string', ttl: 3600 });
  });

  test('getKeyValue handles different data types', async () => {
    mockRedisInstance.type.mockResolvedValueOnce('string');
    const strVal = await redisService.getKeyValue('user:101');
    expect(strVal.type).toBe('string');
    expect(strVal.value).toBe('my-value');

    mockRedisInstance.type.mockResolvedValueOnce('list');
    const listVal = await redisService.getKeyValue('tasks');
    expect(listVal.type).toBe('list');
    expect(Array.isArray(listVal.value)).toBe(true);

    mockRedisInstance.type.mockResolvedValueOnce('hash');
    const hashVal = await redisService.getKeyValue('profile:1');
    expect(hashVal.type).toBe('hash');
    expect(hashVal.value).toEqual({ field1: 'val1' });
  });

  test('deleteKey deletes key and returns confirmation', async () => {
    await expect(redisService.deleteKey('')).rejects.toThrow('Key is required');
    const res = await redisService.deleteKey('old_key');
    expect(res.message).toContain('old_key');
    expect(mockRedisInstance.del).toHaveBeenCalledWith('old_key');
  });

  test('setKeyTtl sets expiry or persists key when -1', async () => {
    await redisService.setKeyTtl('session:1', 120);
    expect(mockRedisInstance.expire).toHaveBeenCalledWith('session:1', 120);

    await redisService.setKeyTtl('session:1', -1);
    expect(mockRedisInstance.persist).toHaveBeenCalledWith('session:1');
  });
});

describe('RedisService — Databases, Clients & SlowLog', () => {
  test('flushDb, flushAll, save, and bgsave call appropriate Redis commands', async () => {
    await redisService.flushDb();
    expect(mockRedisInstance.flushdb).toHaveBeenCalled();

    await redisService.flushAll();
    expect(mockRedisInstance.flushall).toHaveBeenCalled();

    await redisService.save();
    expect(mockRedisInstance.save).toHaveBeenCalled();

    await redisService.bgsave();
    expect(mockRedisInstance.bgsave).toHaveBeenCalled();
  });

  test('getClients parses client list and killClient kills connection', async () => {
    const clients = await redisService.getClients();
    expect(clients).toHaveLength(1);
    expect(clients[0].addr).toBe('127.0.0.1:54321');

    await redisService.killClient('127.0.0.1:54321');
    expect(mockRedisInstance.client).toHaveBeenCalledWith('KILL', '127.0.0.1:54321');
  });

  test('getSlowLog returns mapped slow query entries', async () => {
    const slowLogs = await redisService.getSlowLog(10);
    expect(slowLogs).toHaveLength(1);
    expect(slowLogs[0].command).toBe('GET large_key');
    expect(slowLogs[0].durationUs).toBe(1500);
  });
});

describe('RedisController', () => {
  test('getInfo and getStats send 200 responses', async () => {
    const req = {};
    const resInfo = createMockRes();
    await redisController.getInfo(req, resInfo);
    expect(resInfo.statusCode).toBe(200);
    expect(resInfo.body.data.version).toBe('7.2.4');

    const resStats = createMockRes();
    await redisController.getStats(req, resStats);
    expect(resStats.statusCode).toBe(200);
    expect(resStats.body.data.instantaneousOpsPerSec).toBe(15);
  });

  test('getConfig and setConfig handle requests and validations', async () => {
    const reqGet = { query: { pattern: '*' } };
    const resGet = createMockRes();
    await redisController.getConfig(reqGet, resGet);
    expect(resGet.statusCode).toBe(200);

    const reqMissing = { body: {} };
    const resMissing = createMockRes();
    await redisController.setConfig(reqMissing, resMissing);
    expect(resMissing.statusCode).toBe(400);

    const reqValid = { body: { key: 'timeout', value: '300' } };
    const resValid = createMockRes();
    await redisController.setConfig(reqValid, resValid);
    expect(resValid.statusCode).toBe(200);
  });
});
