/**
 * Unit tests for Auto-Heal Module:
 * - src/modules/autoheal/autoheal.service.js
 * - src/modules/autoheal/autoheal.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

let mockExecCmdHandler = jest.fn(async () => 'active');

jest.unstable_mockModule('../src/helpers/exec.js', () => ({
  execCmd: jest.fn(async (...args) => mockExecCmdHandler(...args)),
  execShell: jest.fn(async () => ''),
}));

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

jest.unstable_mockModule('../src/core/scheduler/Scheduler.js', () => ({
  default: {
    register: jest.fn(),
    cancel: jest.fn(),
    cancelAll: jest.fn(),
  },
}));

jest.unstable_mockModule('systeminformation', () => ({
  currentLoad: jest.fn().mockResolvedValue({ currentLoad: 45 }),
  mem: jest.fn().mockResolvedValue({ total: 16000000000, used: 8000000000 }),
  fsSize: jest.fn().mockResolvedValue([
    { fs: '/dev/sda1', mount: '/', size: 100000000000, used: 50000000000, use: 50 },
  ]),
}));

const { default: autohealService } = await import('../src/modules/autoheal/autoheal.service.js');
const { default: autohealController } = await import('../src/modules/autoheal/autoheal.controller.js');
const { default: alertsService } = await import('../src/modules/alerts/alerts.service.js');
const { getDb } = await import('../src/core/db/sqlite.js');

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
let setTimeoutSpy;

beforeEach(() => {
  jest.clearAllMocks();
  setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout').mockImplementation((fn) => {
    if (typeof fn === 'function') fn();
    return 1;
  });
  for (const k of Object.keys(mockSettingsStore)) {
    delete mockSettingsStore[k];
  }
  autohealService._incidentCounts = {};
  autohealService._initialized = false;

  mockExecCmdHandler.mockImplementation(async (bin, args) => {
    const cmd = [bin, ...(args || [])].join(' ');
    if (cmd.includes('systemctl is-active')) return 'active';
    if (cmd.includes('docker info')) return 'Server Version: 24.0.5';
    return 'ok';
  });

  const db = getDb();
  db.prepare('DELETE FROM notifications').run();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (setTimeoutSpy) setTimeoutSpy.mockRestore();
});

describe('AutoHealService — Initialization & Config', () => {
  test('init registers scheduler task once', async () => {
    await autohealService.init();
    expect(autohealService._initialized).toBe(true);
    // Calling init again should be a no-op
    await autohealService.init();
    expect(autohealService._initialized).toBe(true);
  });

  test('getConfig returns default values when no settings saved', async () => {
    const config = await autohealService.getConfig();
    expect(config.enabled).toBe(true);
    expect(config.checkInterval).toBe(180);
    expect(config.maxRetries).toBe(3);
    expect(Array.isArray(config.services)).toBe(true);
    expect(config.services.some(s => s.name === 'nginx')).toBe(true);
  });

  test('saveConfig persists updated settings', async () => {
    const res = await autohealService.saveConfig({
      enabled: false,
      checkInterval: 60,
      maxRetries: 5,
      diskThreshold: 85,
    });
    expect(res.config.enabled).toBe(false);
    expect(res.config.checkInterval).toBe(60);
    expect(res.config.maxRetries).toBe(5);
    expect(res.config.diskThreshold).toBe(85);

    const saved = await autohealService.getConfig();
    expect(saved.enabled).toBe(false);
  });
});

describe('AutoHealService — Health Checks & Auto-Recovery', () => {
  test('_checkService returns healthy when active', async () => {
    const config = await autohealService.getConfig();
    const result = await autohealService._checkService({ name: 'nginx', displayName: 'Nginx' }, config);
    expect(result.status).toBe('healthy');
    expect(result.message).toContain('is running');
  });

  test('_checkService auto-restarts and recovers inactive service', async () => {
    let callCount = 0;
    mockExecCmdHandler.mockImplementation(async (bin, args) => {
      const cmd = [bin, ...(args || [])].join(' ');
      if (cmd.includes('systemctl is-active')) {
        callCount++;
        return callCount === 1 ? 'inactive' : 'active';
      }
      return 'restarted';
    });

    const config = await autohealService.getConfig();
    const result = await autohealService._checkService({ name: 'mysql', displayName: 'MySQL' }, config);
    expect(result.status).toBe('recovered');
    expect(result.message).toContain('restarted it successfully');
  });

  test('_checkService reports critical if restart attempt fails', async () => {
    mockExecCmdHandler.mockImplementation(async (bin, args) => {
      const cmd = [bin, ...(args || [])].join(' ');
      if (cmd.includes('systemctl is-active')) return 'inactive';
      throw new Error('Job failed');
    });

    const config = await autohealService.getConfig();
    const result = await autohealService._checkService({ name: 'redis-server', displayName: 'Redis' }, config);
    expect(result.status).toBe('critical');
    expect(result.message).toContain('failed');
  });

  test('_checkDocker returns healthy when running', async () => {
    const config = await autohealService.getConfig();
    const res = await autohealService._checkDocker(config);
    expect(res.status).toBe('healthy');
    expect(res.name).toBe('Docker Daemon');
  });

  test('_checkDocker restarts docker when down', async () => {
    let callCount = 0;
    mockExecCmdHandler.mockImplementation(async (bin, args) => {
      const cmd = [bin, ...(args || [])].join(' ');
      if (cmd.includes('docker info')) {
        callCount++;
        if (callCount === 1) throw new Error('daemon not running');
        return 'Server Version: 24.0.0';
      }
      return 'started';
    });

    const config = await autohealService.getConfig();
    const res = await autohealService._checkDocker(config);
    expect(res.status).toBe('recovered');
  });

  test('_checkResources triggers warnings and cleanup on high usage', async () => {
    const si = await import('systeminformation');
    si.currentLoad.mockResolvedValueOnce({ currentLoad: 95 });
    si.mem.mockResolvedValueOnce({ total: 1000, used: 950 });
    si.fsSize.mockResolvedValueOnce([
      { mount: '/', size: 1000, used: 950, use: 95 },
    ]);

    const config = await autohealService.getConfig();
    // Simulate previous incident so threshold counter reaches 2
    autohealService._incidentCounts['resource:cpu'] = 1;
    autohealService._incidentCounts['resource:ram'] = 1;
    autohealService._incidentCounts['resource:disk'] = 1;

    const results = await autohealService._checkResources(config);
    expect(results.some(r => r.name === 'CPU')).toBe(true);
    expect(results.some(r => r.name === 'RAM')).toBe(true);
    expect(results.some(r => r.name === 'Disk')).toBe(true);
  });
});

describe('AutoHealService — Status & Incident History', () => {
  test('getCurrentStatus returns service states', async () => {
    const statuses = await autohealService.getCurrentStatus();
    expect(Array.isArray(statuses)).toBe(true);
    expect(statuses.some(s => s.type === 'service')).toBe(true);
    expect(statuses.some(s => s.type === 'docker')).toBe(true);
  });

  test('runManualCheck executes full check suite', async () => {
    const results = await autohealService.runManualCheck();
    expect(Array.isArray(results)).toBe(true);
  });

  test('healService manually restarts service', async () => {
    await expect(autohealService.healService('')).rejects.toThrow('Service name is required');

    mockExecCmdHandler.mockImplementation(async (bin, args) => {
      const cmd = [bin, ...(args || [])].join(' ');
      if (cmd.includes('systemctl is-active')) return 'active';
      return 'restarted';
    });
    const res = await autohealService.healService('nginx');
    expect(res.success).toBe(true);
    expect(res.message).toContain('restarted successfully');
  });

  test('getIncidentHistory returns recorded incidents', async () => {
    await autohealService._createNotification('service_recovered', '✅ Test Recovered', 'Test service was healed');
    const incidents = await autohealService.getIncidentHistory(10);
    expect(incidents.length).toBeGreaterThan(0);
    expect(incidents[0].title).toContain('Recovered');
  });
});

describe('AutoHealController — API Endpoints', () => {
  test('getConfig and saveConfig endpoints', async () => {
    const reqGet = {};
    const resGet = createMockRes();
    await autohealController.getConfig(reqGet, resGet);
    expect(resGet.statusCode).toBe(200);
    expect(resGet.body.success).toBe(true);

    const reqSave = { body: { enabled: true, checkInterval: 120 } };
    const resSave = createMockRes();
    await autohealController.saveConfig(reqSave, resSave);
    expect(resSave.statusCode).toBe(200);
  });

  test('getStatus and runCheck endpoints', async () => {
    const req = {};
    const resStatus = createMockRes();
    await autohealController.getStatus(req, resStatus);
    expect(resStatus.statusCode).toBe(200);

    const resCheck = createMockRes();
    await autohealController.runCheck(req, resCheck);
    expect(resCheck.statusCode).toBe(200);
  });

  test('healService endpoint validates name', async () => {
    const reqNoName = { body: {} };
    const resNoName = createMockRes();
    await autohealController.healService(reqNoName, resNoName);
    expect(resNoName.statusCode).toBe(400);

    const reqValid = { body: { name: 'nginx' } };
    const resValid = createMockRes();
    await autohealController.healService(reqValid, resValid);
    expect(resValid.statusCode).toBe(200);
  });

  test('getIncidents endpoint returns 200', async () => {
    const req = { query: { limit: '10' } };
    const res = createMockRes();
    await autohealController.getIncidents(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('emergencyClean and resurrectServices endpoints', async () => {
    const req = {};
    const resClean = createMockRes();
    await autohealController.emergencyClean(req, resClean);
    expect(resClean.statusCode).toBe(200);

    const resResurrect = createMockRes();
    await autohealController.resurrectServices(req, resResurrect);
    expect(resResurrect.statusCode).toBe(200);
  });
});
