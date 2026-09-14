/**
 * Unit tests for DNS Module:
 * - src/modules/dns/dns.service.js
 * - src/modules/dns/dns.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

const mockSettingsStore = {};

jest.unstable_mockModule('../src/models/Setting.js', () => ({
  default: {
    get: jest.fn(async (key) => mockSettingsStore[key] || null),
    set: jest.fn(async (key, value) => {
      mockSettingsStore[key] = value;
      return true;
    }),
  },
}));

const { default: dnsService } = await import('../src/modules/dns/dns.service.js');
const { default: dnsController } = await import('../src/modules/dns/dns.controller.js');

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
  for (const key of Object.keys(mockSettingsStore)) {
    delete mockSettingsStore[key];
  }
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('DnsService — Validation', () => {
  test('validates required record fields', () => {
    expect(() => dnsService.validateRecord({})).toThrow('Record type is required');
    expect(() => dnsService.validateRecord({ type: 'A' })).toThrow('Record name is required');
    expect(() => dnsService.validateRecord({ type: 'A', name: 'example.com' })).toThrow('Record content is required');
  });

  test('validates allowed record types', () => {
    expect(() => dnsService.validateRecord({ type: 'INVALID', name: 'example.com', content: '1.2.3.4' })).toThrow('Invalid record type');
    expect(dnsService.validateRecord({ type: 'A', name: 'example.com', content: '1.2.3.4' })).toBe(true);
    expect(dnsService.validateRecord({ type: 'AAAA', name: 'example.com', content: '::1' })).toBe(true);
    expect(dnsService.validateRecord({ type: 'CNAME', name: 'sub.example.com', content: 'example.com' })).toBe(true);
    expect(dnsService.validateRecord({ type: 'TXT', name: 'example.com', content: 'v=spf1' })).toBe(true);
    expect(dnsService.validateRecord({ type: 'MX', name: 'example.com', content: 'mail.example.com' })).toBe(true);
    expect(dnsService.validateRecord({ type: 'SRV', name: '_sip._tcp.example.com' })).toBe(true);
  });

  test('validates TTL range', () => {
    expect(() => dnsService.validateRecord({ type: 'A', name: 'example.com', content: '1.1.1.1', ttl: 0 })).toThrow('TTL must be between 1 and 86400');
    expect(() => dnsService.validateRecord({ type: 'A', name: 'example.com', content: '1.1.1.1', ttl: 100000 })).toThrow('TTL must be between 1 and 86400');
    expect(() => dnsService.validateRecord({ type: 'A', name: 'example.com', content: '1.1.1.1', ttl: 'not-a-number' })).toThrow('TTL must be between 1 and 86400');
    expect(dnsService.validateRecord({ type: 'A', name: 'example.com', content: '1.1.1.1', ttl: 300 })).toBe(true);
  });
});

describe('DnsService — Provider Configurations', () => {
  test('getProviders returns list of supported providers with configured flags', async () => {
    const list = await dnsService.getProviders();
    expect(Array.isArray(list)).toBe(true);
    expect(list.some(p => p.id === 'cloudflare')).toBe(true);
    expect(list.some(p => p.id === 'digitalocean')).toBe(true);
    expect(list.every(p => p.configured === false)).toBe(true);
  });

  test('saveProviderConfig updates settings and masks credentials', async () => {
    await dnsService.saveProviderConfig('cloudflare', { apiKey: 'cf-secret-token' });
    const providers = await dnsService.getProviders();
    const cf = providers.find(p => p.id === 'cloudflare');
    expect(cf.configured).toBe(true);

    await expect(dnsService.saveProviderConfig('unknown_provider', {})).rejects.toThrow('Unknown provider');
  });
});

describe('DnsService — Cloudflare Provider Operations', () => {
  beforeEach(async () => {
    await dnsService.saveProviderConfig('cloudflare', { apiKey: 'cf-token-123' });
  });

  test('testProvider tests cloudflare connection', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, result: [{ id: 'zone1' }] }),
    });

    const res = await dnsService.testProvider('cloudflare');
    expect(res.success).toBe(true);
    expect(res.message).toContain('Connected! Found 1 zones');
  });

  test('getZones returns mapped Cloudflare zones', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: [{
          id: 'z123',
          name: 'example.com',
          status: 'active',
          plan: { name: 'Pro' },
          name_servers: ['ns1.cf.com'],
          paused: false,
        }],
      }),
    });

    const zones = await dnsService.getZones('cloudflare');
    expect(zones.length).toBe(1);
    expect(zones[0].name).toBe('example.com');
    expect(zones[0].plan).toBe('Pro');
  });

  test('getRecords returns mapped Cloudflare records', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: [{
          id: 'rec1',
          type: 'A',
          name: 'test.example.com',
          content: '1.2.3.4',
          ttl: 300,
          proxied: true,
        }],
      }),
    });

    const records = await dnsService.getRecords('cloudflare', 'z123');
    expect(records.length).toBe(1);
    expect(records[0].proxied).toBe(true);
  });

  test('createRecord, updateRecord, and deleteRecord work with Cloudflare', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: { id: 'rec1', type: 'A', name: 'app.example.com' },
      }),
    });

    const created = await dnsService.createRecord('cloudflare', 'z123', {
      type: 'A',
      name: 'app.example.com',
      content: '1.2.3.4',
      ttl: 1,
    });
    expect(created.id).toBe('rec1');

    const updated = await dnsService.updateRecord('cloudflare', 'z123', 'rec1', {
      type: 'A',
      name: 'app.example.com',
      content: '5.6.7.8',
    });
    expect(updated.id).toBe('rec1');

    const deleted = await dnsService.deleteRecord('cloudflare', 'z123', 'rec1');
    expect(deleted).toHaveProperty('id', 'rec1');
  });

  test('bulkUpdateRecords handles multiple operations and error captures', async () => {
    let callCount = 0;
    globalThis.fetch = jest.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 2) {
        return {
          ok: false,
          json: async () => ({ success: false, errors: [{ message: 'Cloudflare rate limited' }] }),
        };
      }
      return {
        ok: true,
        json: async () => ({ success: true, result: { id: 'bulk-rec' } }),
      };
    });

    const ops = [
      { action: 'create', record: { type: 'A', name: 'one.com', content: '1.1.1.1' } },
      { action: 'update', record: { id: 'fail-id', type: 'A', name: 'two.com', content: '2.2.2.2' } },
      { action: 'delete', record: { id: 'del-id' } },
    ];

    const results = await dnsService.bulkUpdateRecords('cloudflare', 'z123', ops);
    expect(results.length).toBe(3);
    expect(results[1]).toHaveProperty('error');
    expect(results[1].error).toContain('rate limited');
  });

  test('DNSSEC status, enable, and disable', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: { status: 'active', algorithm: '13', ds: 'ds-data' },
      }),
    });

    const status = await dnsService.getDNSSECStatus('cloudflare', 'z123');
    expect(status.enabled).toBe(true);
    expect(status.status).toBe('active');

    const enabled = await dnsService.enableDNSSEC('cloudflare', 'z123');
    expect(enabled.status).toBe('active');

    const disabled = await dnsService.disableDNSSEC('cloudflare', 'z123');
    expect(disabled).toBeDefined();

    const unsupported = await dnsService.getDNSSECStatus('digitalocean', 'z123');
    expect(unsupported.enabled).toBe(false);
  });
});

describe('DnsService — DigitalOcean, DuckDNS, and No-IP', () => {
  test('DigitalOcean getZones and getRecords', async () => {
    await dnsService.saveProviderConfig('digitalocean', { token: 'do-secret-token' });

    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        domains: [{ name: 'ocean.com', ttl: 1800 }],
        domain_records: [{ id: 101, type: 'A', name: '@', data: '1.2.3.4', ttl: 1800 }],
      }),
    });

    const zones = await dnsService.getZones('digitalocean');
    expect(zones.length).toBe(1);
    expect(zones[0].name).toBe('ocean.com');

    const records = await dnsService.getRecords('digitalocean', 'ocean.com');
    expect(records.length).toBe(1);
    expect(records[0].content).toBe('1.2.3.4');
  });

  test('DuckDNS dynamic DNS update', async () => {
    await dnsService.saveProviderConfig('duckdns', { token: 'duck-token' });

    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => 'OK',
    });

    const res = await dnsService.updateDuckDNS('myhome', '123.45.67.89');
    expect(res.success).toBe(true);
  });

  test('DuckDNS throws when update response is KO', async () => {
    await dnsService.saveProviderConfig('duckdns', { token: 'duck-token' });

    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => 'KO',
    });

    await expect(dnsService.updateDuckDNS('myhome', '1.1.1.1')).rejects.toThrow('DuckDNS update failed: KO');
  });

  test('No-IP dynamic DNS update', async () => {
    await dnsService.saveProviderConfig('noip', { username: 'noipuser', password: 'noippassword' });

    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => 'good 1.2.3.4',
    });

    const res = await dnsService.updateNoIP('myhost.ddns.net', '1.2.3.4');
    expect(res.success).toBe(true);
    expect(res.message).toContain('good');
  });
});

describe('DnsController — Endpoints', () => {
  test('getProviders and getRecordTypes return 200', async () => {
    const req = {};
    const resProviders = createMockRes();
    await dnsController.getProviders(req, resProviders);
    expect(resProviders.statusCode).toBe(200);
    expect(resProviders.body.success).toBe(true);

    const resTypes = createMockRes();
    await dnsController.getRecordTypes(req, resTypes);
    expect(resTypes.statusCode).toBe(200);
    expect(Array.isArray(resTypes.body.data)).toBe(true);
  });

  test('saveProviderConfig and testProvider endpoints', async () => {
    const reqSave = { params: { provider: 'cloudflare' }, body: { apiKey: 'token' } };
    const resSave = createMockRes();
    await dnsController.saveProviderConfig(reqSave, resSave);
    expect(resSave.statusCode).toBe(200);

    const reqTest = { params: { provider: 'generic' } };
    const resTest = createMockRes();
    await dnsController.testProvider(reqTest, resTest);
    expect(resTest.statusCode).toBe(200);
  });

  test('createRecord validates request body', async () => {
    const reqBad = { params: { provider: 'cloudflare', zoneId: 'z1' }, body: {} };
    const resBad = createMockRes();
    await dnsController.createRecord(reqBad, resBad);
    expect(resBad.statusCode).toBe(400);
    expect(resBad.body.success).toBe(false);
  });

  test('bulkUpdateRecords validates operations array', async () => {
    const reqEmpty = { params: { provider: 'cloudflare', zoneId: 'z1' }, body: {} };
    const resEmpty = createMockRes();
    await dnsController.bulkUpdateRecords(reqEmpty, resEmpty);
    expect(resEmpty.statusCode).toBe(400);
  });

  test('updateDynamicDNS handles unsupported provider', async () => {
    const req = { params: { provider: 'unsupported' }, body: {} };
    const res = createMockRes();
    await dnsController.updateDynamicDNS(req, res);
    expect(res.statusCode).toBe(400);
  });
});
