/**
 * Unit tests for WAF Service and Controller:
 * - src/modules/waf/waf.service.js
 * - src/modules/waf/waf.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockDb = {
  prepare: jest.fn(),
};

const mockWafRule = {
  find: jest.fn(),
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  findByIdAndDelete: jest.fn(),
};

const mockSecurityScanner = {
  getLatestScan: jest.fn(),
  runScan: jest.fn(),
  applyFix: jest.fn(),
};

const mockGeoip = {
  getThreatMapData: jest.fn(),
  blockCountry: jest.fn(),
  unblockCountry: jest.fn(),
};

const mockCrowdsec = {
  getStatus: jest.fn(),
};

jest.unstable_mockModule('../src/core/db/sqlite.js', () => ({
  getDb: () => mockDb,
  now: () => '2026-09-14 12:00:00',
  generateId: () => 'mock-waf-id',
}));

jest.unstable_mockModule('../src/models/WafRule.js', () => ({
  default: mockWafRule,
}));

jest.unstable_mockModule('../src/middleware/waf.middleware.js', () => ({
  refreshWafCache: jest.fn(async () => {}),
  wafMiddleware: jest.fn((req, res, next) => next()),
}));

jest.unstable_mockModule('../src/modules/waf/security-scanner.service.js', () => ({
  default: mockSecurityScanner,
}));

jest.unstable_mockModule('../src/modules/waf/geoip.service.js', () => ({
  default: mockGeoip,
}));

jest.unstable_mockModule('../src/modules/waf/crowdsec.service.js', () => ({
  default: mockCrowdsec,
}));

const { default: wafService } = await import('../src/modules/waf/waf.service.js');
const { default: wafController } = await import('../src/modules/waf/waf.controller.js');

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
});

describe('WafService', () => {
  test('getRules fetches all WAF rules from model', async () => {
    mockWafRule.find.mockResolvedValue([{ id: '1', type: 'ip', value: '1.2.3.4' }]);
    const rules = await wafService.getRules();
    expect(rules).toHaveLength(1);
    expect(mockWafRule.find).toHaveBeenCalled();
  });

  test('addRule validates IP and CIDR formats', async () => {
    await expect(wafService.addRule('ip', 'not-an-ip', 'block', 'test')).rejects.toThrow(
      'Invalid IP address or CIDR range'
    );

    mockWafRule.findOne.mockResolvedValue(null);
    mockWafRule.create.mockResolvedValue({ id: 'r1', type: 'ip', value: '10.0.0.1/24' });

    const rule = await wafService.addRule('ip', '10.0.0.1/24', 'block', 'local network');
    expect(rule.value).toBe('10.0.0.1/24');
  });

  test('addRule throws when rule already exists', async () => {
    mockWafRule.findOne.mockResolvedValue({ id: 'existing' });
    await expect(wafService.addRule('ip', '192.168.1.1', 'block', 'duplicate')).rejects.toThrow(
      'Rule already exists for this value'
    );
  });

  test('deleteRule deletes rule and refreshes cache', async () => {
    mockWafRule.findById.mockResolvedValue({ id: 'r1' });
    mockWafRule.findByIdAndDelete.mockResolvedValue(true);

    const result = await wafService.deleteRule('r1');
    expect(result).toBe(true);
    expect(mockWafRule.findByIdAndDelete).toHaveBeenCalledWith('r1');
  });

  test('deleteRule throws 404 if rule does not exist', async () => {
    mockWafRule.findById.mockResolvedValue(null);
    await expect(wafService.deleteRule('unknown')).rejects.toThrow('Rule not found');
  });

  test('getHoneypotTraps returns array of trap paths', () => {
    const traps = wafService.getHoneypotTraps();
    expect(Array.isArray(traps)).toBe(true);
    expect(traps).toContain('/.env');
    expect(traps).toContain('/wp-login.php');
  });

  test('recordHoneypotHit logs hit and blacklists IP', async () => {
    const mockRun = jest.fn();
    mockDb.prepare.mockReturnValue({
      run: mockRun,
      get: jest.fn().mockReturnValue(null), // not previously blacklisted
    });

    await wafService.recordHoneypotHit({
      ip: '45.33.32.156',
      path: '/.env',
      userAgent: 'Mozilla/5.0 Bot',
    });

    expect(mockRun).toHaveBeenCalled();
  });

  test('applySystemHardening executes in simulation', async () => {
    const res = await wafService.applySystemHardening();
    expect(res.success).toBe(true);
    expect(res.score).toBeGreaterThanOrEqual(90);
    expect(res.actionsTaken.length).toBeGreaterThan(0);
  });
});

describe('WafController', () => {
  test('getRules returns 200 with rules data', async () => {
    mockWafRule.find.mockResolvedValue([{ id: 'r1' }]);
    const req = {};
    const res = createMockRes();

    await wafController.getRules(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  test('addRule validates missing parameters with 400', async () => {
    const req = { body: { type: 'ip' } }; // missing value, action
    const res = createMockRes();

    await wafController.addRule(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('deleteRule deletes by param id', async () => {
    mockWafRule.findById.mockResolvedValue({ id: 'r1' });
    mockWafRule.findByIdAndDelete.mockResolvedValue(true);

    const req = { params: { id: 'r1' } };
    const res = createMockRes();

    await wafController.deleteRule(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('getSecurityScan calls security scanner service', async () => {
    mockSecurityScanner.getLatestScan.mockResolvedValue({ score: 85, issues: [] });
    const req = {};
    const res = createMockRes();

    await wafController.getSecurityScan(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.score).toBe(85);
  });

  test('blockCountry blocks country via geoip service', async () => {
    mockGeoip.blockCountry.mockResolvedValue({ country: 'RU', blocked: true });
    const req = { body: { countryCode: 'RU', description: 'Attack source' } };
    const res = createMockRes();

    await wafController.blockCountry(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.blocked).toBe(true);
  });

  test('blockCountry rejects missing countryCode with 400', async () => {
    const req = { body: {} };
    const res = createMockRes();

    await wafController.blockCountry(req, res);
    expect(res.statusCode).toBe(400);
  });
});
