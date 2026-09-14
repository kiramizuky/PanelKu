/**
 * Unit tests for CDN Module:
 * - src/modules/cdn/cdn.service.js
 * - src/modules/cdn/cdn.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

let mockExecHandler = jest.fn();
let mockExecFileHandler = jest.fn();

jest.unstable_mockModule('child_process', () => ({
  exec: jest.fn((cmd, ...rest) => {
    const cb = rest.pop();
    const opts = typeof rest[0] === 'object' ? rest[0] : {};
    mockExecHandler(cmd, opts, cb);
  }),
  execFile: jest.fn((file, ...rest) => {
    const last = rest[rest.length - 1];
    const cb = typeof last === 'function' ? rest.pop() : (() => {});
    const args = Array.isArray(rest[0]) ? rest[0] : [];
    const opts = typeof rest[0] === 'object' && !Array.isArray(rest[0]) ? rest[0] : (rest[1] || {});
    mockExecFileHandler(file, args, opts, cb);
  }),
}));

const mockFsStat = jest.fn().mockResolvedValue({ isDirectory: () => true });
const mockFsWriteFile = jest.fn().mockResolvedValue(undefined);
const mockFsUnlink = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('fs/promises', () => ({
  default: {
    stat: mockFsStat,
    writeFile: mockFsWriteFile,
    unlink: mockFsUnlink,
  },
  stat: mockFsStat,
  writeFile: mockFsWriteFile,
  unlink: mockFsUnlink,
}));

const { default: cdnService } = await import('../src/modules/cdn/cdn.service.js');
const { default: cdnController } = await import('../src/modules/cdn/cdn.controller.js');

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

const originalFetch = globalThis.fetch;

beforeEach(() => {
  jest.clearAllMocks();

  mockExecHandler.mockImplementation((cmd, opts, cb) => {
    if (cmd.includes('systemctl is-active varnish')) {
      cb(null, { stdout: 'active', stderr: '' });
    } else if (cmd.includes('varnishd -V')) {
      cb(null, { stdout: 'varnishd (varnish-6.5.1 revision ...)', stderr: '' });
    } else if (cmd.includes('varnishstat')) {
      cb(null, { stdout: 'MAIN.client_req 1000 Client requests\nMAIN.cache_hit 800 Cache hits', stderr: '' });
    } else if (cmd.includes('redis-cli') && cmd.includes('INFO stats')) {
      cb(null, { stdout: 'keyspace_hits:900\nkeyspace_misses:100\nexpired_keys:50\nevicted_keys:10', stderr: '' });
    } else if (cmd.includes('/tmp/panelku-page-cache') && cmd.includes('wc -l')) {
      cb(null, { stdout: '42', stderr: '' });
    } else if (cmd.includes('du -sh')) {
      cb(null, { stdout: '12M', stderr: '' });
    } else {
      cb(null, { stdout: 'ok', stderr: '' });
    }
  });

  mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
    cb(null, { stdout: 'ok', stderr: '' });
  });

  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      result: [{ id: 'cf_zone_1', name: 'myzone.com', status: 'active', plan: { name: 'Free' } }],
    }),
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('CdnService — Cloudflare Integration', () => {
  test('getCloudflareZones validates credentials and returns zones', async () => {
    await expect(cdnService.getCloudflareZones('', '')).rejects.toThrow('API key and email are required');
    await expect(cdnService.getCloudflareZones('bad key!@#', 'a@b.com')).rejects.toThrow('Invalid API key format');

    const res = await cdnService.getCloudflareZones('valid_key_123', 'admin@example.com');
    expect(res.zones.length).toBe(1);
    expect(res.zones[0].name).toBe('myzone.com');
  });

  test('purgeCloudflareCache and purgeCloudflareUrls', async () => {
    await expect(cdnService.purgeCloudflareCache('', '', '')).rejects.toThrow('required');

    const resAll = await cdnService.purgeCloudflareCache('valid_key', 'admin@example.com', 'z1');
    expect(resAll.success).toBe(true);

    const resUrls = await cdnService.purgeCloudflareUrls('valid_key', 'admin@example.com', 'z1', ['https://example.com/logo.png']);
    expect(resUrls.success).toBe(true);
    expect(resUrls.files).toBe(1);
  });

  test('getCloudflareAnalytics retrieves totals', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: { totals: { requests: { all: 15000 }, bandwidth: { all: 5000000 } } },
      }),
    });

    const analytics = await cdnService.getCloudflareAnalytics('valid_key', 'admin@example.com', 'z1');
    expect(analytics.requests.all).toBe(15000);
  });
});

describe('CdnService — Varnish Cache', () => {
  test('getVarnishStatus parses active state, version and stats', async () => {
    const status = await cdnService.getVarnishStatus();
    expect(status.active).toBe(true);
    expect(status.version).toContain('varnish-6.5.1');
    expect(status.stats['MAIN.client_req']).toBe('1000');
  });

  test('controlVarnish validates action and executes command', async () => {
    await expect(cdnService.controlVarnish('invalid')).rejects.toThrow('Invalid action');

    const res = await cdnService.controlVarnish('restart');
    expect(res.success).toBe(true);
  });

  test('getVarnishConfig and saveVarnishConfig', async () => {
    mockExecHandler.mockImplementation((cmd, opts, cb) => {
      if (cmd.includes('cat /etc/varnish/default.vcl')) {
        cb(null, { stdout: 'vcl 4.1;\nbackend default { .host = "127.0.0.1"; }\n', stderr: '' });
      } else {
        cb(null, { stdout: 'ok', stderr: '' });
      }
    });

    const cfg = await cdnService.getVarnishConfig();
    expect(cfg).toContain('vcl 4.1');

    const saveRes = await cdnService.saveVarnishConfig('vcl 4.1; backend default { .host = "127.0.0.1"; }');
    expect(saveRes.success).toBe(true);
    expect(mockFsWriteFile).toHaveBeenCalled();
  });

  test('purgeVarnish triggers cache ban', async () => {
    const res = await cdnService.purgeVarnish();
    expect(res.success).toBe(true);
  });
});

describe('CdnService — Redis & Full Page Cache', () => {
  test('getRedisCacheInfo parses stats and hitRate', async () => {
    const info = await cdnService.getRedisCacheInfo();
    expect(info.hits).toBe(900);
    expect(info.misses).toBe(100);
    expect(info.hitRate).toBe('90.0%');
  });

  test('flushRedisCache flushes redis database', async () => {
    const res = await cdnService.flushRedisCache();
    expect(res.success).toBe(true);
  });

  test('getFpcStatus reports page count and cache size', async () => {
    const status = await cdnService.getFpcStatus();
    expect(status.cachedPages).toBe(42);
    expect(status.cacheSize).toBe('12M');
  });

  test('flushFpc checks directory and clears files', async () => {
    mockFsStat.mockResolvedValue({ isDirectory: () => true });

    const res = await cdnService.flushFpc();
    expect(res.success).toBe(true);
  });
});

describe('CdnController — Endpoints', () => {
  test('cfGetZones endpoint validates parameters', async () => {
    const reqEmpty = { body: {} };
    const resEmpty = createMockRes();
    await cdnController.cfGetZones(reqEmpty, resEmpty);
    expect(resEmpty.statusCode).toBe(400);

    const reqValid = { body: { apiKey: 'key123', email: 'test@example.com' } };
    const resValid = createMockRes();
    await cdnController.cfGetZones(reqValid, resValid);
    expect(resValid.statusCode).toBe(200);
  });

  test('cfPurgeAll endpoint validates parameters', async () => {
    const reqEmpty = { body: {} };
    const resEmpty = createMockRes();
    await cdnController.cfPurgeAll(reqEmpty, resEmpty);
    expect(resEmpty.statusCode).toBe(400);

    const reqValid = { body: { apiKey: 'key123', email: 'test@example.com', zoneId: 'z1' } };
    const resValid = createMockRes();
    await cdnController.cfPurgeAll(reqValid, resValid);
    expect(resValid.statusCode).toBe(200);
  });

  test('varnishStatus and varnishControl endpoints', async () => {
    const req = {};
    const resStatus = createMockRes();
    await cdnController.varnishStatus(req, resStatus);
    expect(resStatus.statusCode).toBe(200);

    const reqCtrl = { body: { action: 'restart' } };
    const resCtrl = createMockRes();
    await cdnController.varnishControl(reqCtrl, resCtrl);
    expect(resCtrl.statusCode).toBe(200);
  });

  test('redisCacheInfo and redisFlush endpoints', async () => {
    const req = {};
    const resInfo = createMockRes();
    await cdnController.redisCacheInfo(req, resInfo);
    expect(resInfo.statusCode).toBe(200);

    const resFlush = createMockRes();
    await cdnController.redisFlush(req, resFlush);
    expect(resFlush.statusCode).toBe(200);
  });

  test('fpcStatus and fpcFlush endpoints', async () => {
    const req = {};
    const resStatus = createMockRes();
    await cdnController.fpcStatus(req, resStatus);
    expect(resStatus.statusCode).toBe(200);

    const resFlush = createMockRes();
    await cdnController.fpcFlush(req, resFlush);
    expect(resFlush.statusCode).toBe(200);
  });
});
