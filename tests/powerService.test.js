/**
 * Unit tests for Power Module:
 * - src/modules/power/power.service.js
 * - src/modules/power/power.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

let mockExecHandler = jest.fn();

jest.unstable_mockModule('child_process', () => ({
  exec: jest.fn((cmd, ...rest) => {
    const cb = rest.pop();
    const opts = typeof rest[0] === 'object' ? rest[0] : {};
    mockExecHandler(cmd, opts, cb);
  }),
}));

const mockFsAccess = jest.fn().mockResolvedValue(undefined);
const mockFsReaddir = jest.fn().mockResolvedValue([]);
const mockFsReadFile = jest.fn().mockResolvedValue('');
const mockFsWriteFile = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('fs/promises', () => ({
  default: {
    access: mockFsAccess,
    readdir: mockFsReaddir,
    readFile: mockFsReadFile,
    writeFile: mockFsWriteFile,
  },
  access: mockFsAccess,
  readdir: mockFsReaddir,
  readFile: mockFsReadFile,
  writeFile: mockFsWriteFile,
}));

const { default: powerService } = await import('../src/modules/power/power.service.js');
const { default: powerController } = await import('../src/modules/power/power.controller.js');

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

  mockExecHandler.mockImplementation((cmd, opts, cb) => {
    if (cmd.includes('uname -m')) {
      cb(null, { stdout: 'x86_64', stderr: '' });
    } else if (cmd.includes('model name')) {
      cb(null, { stdout: 'Intel(R) Core(TM) i7-10700K', stderr: '' });
    } else if (cmd.includes('nproc')) {
      cb(null, { stdout: '2', stderr: '' });
    } else if (cmd.includes('powerprofilesctl list')) {
      cb(null, { stdout: '* balanced:\n  performance:\n  power-saver:\n', stderr: '' });
    } else if (cmd.includes('sensors -u')) {
      cb(null, { stdout: 'temp1_input: 45.000', stderr: '' });
    } else {
      cb(null, { stdout: 'ok', stderr: '' });
    }
  });

  mockFsReadFile.mockImplementation(async (filePath) => {
    if (filePath.includes('scaling_governor')) return 'powersave\n';
    if (filePath.includes('scaling_max_freq')) return '3800000\n';
    if (filePath.includes('scaling_min_freq')) return '800000\n';
    if (filePath.includes('scaling_cur_freq')) return '1200000\n';
    if (filePath.includes('scaling_available_governors')) return 'performance powersave ondemand schedutil\n';
    if (filePath.includes('online')) return '1\n';
    return '';
  });
});

describe('PowerService — CPU Info & Governor', () => {
  test('getCpuInfo gathers CPU model, architecture, cores, and frequencies', async () => {
    const info = await powerService.getCpuInfo();
    expect(info.architecture).toBe('x86_64');
    expect(info.totalCores).toBe(2);
    expect(info.currentGovernor).toBe('powersave');
    expect(info.availableGovernors).toContain('performance');
  });

  test('setGovernor validates safe governor names', async () => {
    await expect(powerService.setGovernor('invalid_gov')).rejects.toThrow('Invalid governor');

    const res = await powerService.setGovernor('performance');
    expect(res.governor).toBe('performance');
  });

  test('setFrequency validates kHz bounds', async () => {
    await expect(powerService.setFrequency(50)).rejects.toThrow('Invalid frequency');
    await expect(powerService.setFrequency(20000000)).rejects.toThrow('Invalid frequency');

    const res = await powerService.setFrequency(2400000);
    expect(res.frequencyKhz).toBe(2400000);
  });
});

describe('PowerService — Profiles, Sleep & Thermals', () => {
  test('getPowerProfiles and setPowerProfile', async () => {
    const profiles = await powerService.getPowerProfiles();
    expect(profiles.available).toBe(true);
    expect(profiles.current).toBe('balanced');

    await expect(powerService.setPowerProfile('ultra-speed')).rejects.toThrow('Invalid profile');
    const setRes = await powerService.setPowerProfile('performance');
    expect(setRes.success).toBe(true);
  });

  test('suspend, hibernate, and hybridSleep execute commands', async () => {
    const resSuspend = await powerService.suspend();
    expect(resSuspend.action).toBe('suspend');

    const resHibernate = await powerService.hibernate();
    expect(resHibernate.action).toBe('hibernate');

    const resHybrid = await powerService.hybridSleep();
    expect(resHybrid.action).toBe('hybrid-sleep');
  });

  test('getThermalInfo reads thermal zones and cpu temp', async () => {
    mockFsReaddir.mockImplementation(async (dir) => {
      if (dir === '/sys/class/thermal') return ['thermal_zone0'];
      return [];
    });
    mockFsReadFile.mockImplementation(async (filePath) => {
      if (filePath.endsWith('type')) return 'x86_pkg_temp\n';
      if (filePath.endsWith('temp')) return '45000\n';
      if (filePath.endsWith('mode')) return 'enabled\n';
      if (filePath.endsWith('policy')) return 'step_wise\n';
      return '';
    });

    const info = await powerService.getThermalInfo();
    expect(info.zones.length).toBe(1);
    expect(info.zones[0].tempCelsius).toBe(45);
    expect(info.cpuTemp).toBe(45);
  });

  test('getFanInfo and setFanSpeed', async () => {
    mockFsReaddir.mockImplementation(async (dir) => {
      if (dir === '/sys/class/hwmon') return ['hwmon0'];
      return ['fan1_input'];
    });
    mockFsReadFile.mockImplementation(async (p) => {
      if (p.endsWith('name')) return 'nct6798\n';
      if (p.endsWith('fan1_input')) return '1200\n';
      return '';
    });

    const fans = await powerService.getFanInfo();
    expect(fans.length).toBe(1);
    expect(fans[0].rpm).toBe(1200);

    await expect(powerService.setFanSpeed('invalid/name', 0, 100)).rejects.toThrow('Invalid device name');
    await expect(powerService.setFanSpeed('dev', 0, 300)).rejects.toThrow('PWM value must be 0-255');
  });

  test('getPowerStats reads battery and acpi', async () => {
    mockExecHandler.mockImplementation((cmd, opts, cb) => {
      if (cmd.includes('BAT0')) {
        cb(null, { stdout: 'POWER_SUPPLY_CAPACITY=85\nPOWER_SUPPLY_STATUS=Discharging\n', stderr: '' });
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
    });

    const stats = await powerService.getPowerStats();
    expect(stats.CAPACITY).toBe('85');
    expect(stats.STATUS).toBe('Discharging');
  });
});

describe('PowerController — API Endpoints', () => {
  test('getCpuInfo and setGovernor endpoints', async () => {
    const req = {};
    const resGet = createMockRes();
    await powerController.getCpuInfo(req, resGet);
    expect(resGet.statusCode).toBe(200);
    expect(resGet.body.success).toBe(true);

    const reqNoGov = { body: {} };
    const resNoGov = createMockRes();
    await powerController.setGovernor(reqNoGov, resNoGov);
    expect(resNoGov.statusCode).toBe(400);

    const reqGov = { body: { governor: 'ondemand' } };
    const resGov = createMockRes();
    await powerController.setGovernor(reqGov, resGov);
    expect(resGov.statusCode).toBe(200);
  });

  test('setFrequency validates khz', async () => {
    const req = { body: {} };
    const res = createMockRes();
    await powerController.setFrequency(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('setPowerProfile validates profile', async () => {
    const req = { body: {} };
    const res = createMockRes();
    await powerController.setPowerProfile(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('setFanSpeed validates device, fan, and pwm', async () => {
    const req = { body: { device: 'dev' } };
    const res = createMockRes();
    await powerController.setFanSpeed(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('suspend, hibernate, and hybridSleep endpoints', async () => {
    const req = {};
    const res1 = createMockRes();
    await powerController.suspend(req, res1);
    expect(res1.statusCode).toBe(200);

    const res2 = createMockRes();
    await powerController.hibernate(req, res2);
    expect(res2.statusCode).toBe(200);

    const res3 = createMockRes();
    await powerController.hybridSleep(req, res3);
    expect(res3.statusCode).toBe(200);
  });
});
