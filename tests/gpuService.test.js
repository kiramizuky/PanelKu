/**
 * Unit tests for GPU Module:
 * - src/modules/gpu/gpu.service.js
 * - src/modules/gpu/gpu.controller.js
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

const { default: gpuService } = await import('../src/modules/gpu/gpu.service.js');
const { default: gpuController } = await import('../src/modules/gpu/gpu.controller.js');

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

let setTimeoutSpy;

beforeEach(() => {
  jest.clearAllMocks();
  gpuService.nvidiaSmiPath = '/usr/bin/nvidia-smi';

  setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout').mockImplementation((fn) => {
    if (typeof fn === 'function') fn();
    return 1;
  });

  mockExecHandler.mockImplementation((cmd, opts, cb) => {
    if (cmd.includes('which nvidia-smi') || cmd.includes('command -v nvidia-smi')) {
      cb(null, { stdout: '/usr/bin/nvidia-smi', stderr: '' });
    } else if (cmd.includes('--query-gpu=count')) {
      cb(null, { stdout: '1', stderr: '' });
    } else if (cmd.includes('--query-gpu=index,name')) {
      cb(null, {
        stdout: '0, NVIDIA GeForce RTX 3080, GPU-1234, 25, 40, 10240, 4096, 6144, 55, 45, 180, 320, 4, 16, 1710, 9500, 1710\n',
        stderr: '',
      });
    } else if (cmd.includes('--query-gpu=driver_version')) {
      cb(null, { stdout: '535.129.03\n', stderr: '' });
    } else if (cmd.includes('nvcc --version')) {
      cb(null, { stdout: 'Cuda compilation tools, release 12.2, V12.2.140\n', stderr: '' });
    } else if (cmd.includes('--query-compute-apps')) {
      cb(null, { stdout: '12345, python3, 2048, 0000:01:00.0\n', stderr: '' });
    } else {
      cb(null, { stdout: 'ok', stderr: '' });
    }
  });

  mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
    cb(null, { stdout: 'ok', stderr: '' });
  });
});

afterEach(() => {
  if (setTimeoutSpy) setTimeoutSpy.mockRestore();
});

describe('GpuService — Detection & Hardware Metrics', () => {
  test('isNvidiaAvailable and getGpuCount check nvidia-smi', async () => {
    const avail = await gpuService.isNvidiaAvailable();
    expect(avail).toBe(true);

    const count = await gpuService.getGpuCount();
    expect(count).toBe(1);
  });

  test('getGpuInfo parses GPU metrics and CUDA driver version', async () => {
    const info = await gpuService.getGpuInfo();
    expect(info.available).toBe(true);
    expect(info.count).toBe(1);
    expect(info.driverVersion).toBe('535.129.03');
    expect(info.gpus.length).toBe(1);
    expect(info.gpus[0].name).toBe('NVIDIA GeForce RTX 3080');
    expect(info.gpus[0].temperature).toBe(55);
    expect(info.gpus[0].memTotal).toBe(10240);
  });

  test('getGpuProcesses lists active GPU compute applications', async () => {
    const procs = await gpuService.getGpuProcesses(0);
    expect(procs.length).toBe(1);
    expect(procs[0].pid).toBe(12345);
    expect(procs[0].name).toBe('python3');
    expect(procs[0].usedMemory).toBe(2048);
  });
});

describe('GpuService — Process Management & Controls', () => {
  test('killProcess validates PID and signals process', async () => {
    await expect(gpuService.killProcess('invalid')).rejects.toThrow('Invalid PID');
    await expect(gpuService.killProcess(0)).rejects.toThrow('Invalid PID');

    const res = await gpuService.killProcess(12345);
    expect(res.killed).toBe(true);
  });

  test('resetGpu issues reset command to device', async () => {
    await expect(gpuService.resetGpu('abc')).rejects.toThrow('Invalid GPU index');

    const res = await gpuService.resetGpu(0);
    expect(res.success).toBe(true);
  });

  test('setPowerLimit sets power limit in watts', async () => {
    await expect(gpuService.setPowerLimit(0, 5)).rejects.toThrow('Invalid GPU index or power limit');
    await expect(gpuService.setPowerLimit(0, 1500)).rejects.toThrow('Invalid GPU index or power limit');

    const res = await gpuService.setPowerLimit(0, 250);
    expect(res.success).toBe(true);
    expect(res.powerLimit).toBe(250);
  });
});

describe('GpuController — Endpoints', () => {
  test('getStatus and getProcesses endpoints return 200', async () => {
    const req = { query: {} };
    const resStatus = createMockRes();
    await gpuController.getStatus(req, resStatus);
    expect(resStatus.statusCode).toBe(200);
    expect(resStatus.body.success).toBe(true);

    const resProcs = createMockRes();
    await gpuController.getProcesses(req, resProcs);
    expect(resProcs.statusCode).toBe(200);
    expect(resProcs.body.success).toBe(true);
  });

  test('killProcess endpoint validates pid', async () => {
    const reqEmpty = { body: {} };
    const resEmpty = createMockRes();
    await gpuController.killProcess(reqEmpty, resEmpty);
    expect(resEmpty.statusCode).toBe(400);

    const reqValid = { body: { pid: 12345 } };
    const resValid = createMockRes();
    await gpuController.killProcess(reqValid, resValid);
    expect(resValid.statusCode).toBe(200);
  });

  test('resetGpu endpoint validates gpuIndex', async () => {
    const reqEmpty = { body: {} };
    const resEmpty = createMockRes();
    await gpuController.resetGpu(reqEmpty, resEmpty);
    expect(resEmpty.statusCode).toBe(400);

    const reqValid = { body: { gpuIndex: 0 } };
    const resValid = createMockRes();
    await gpuController.resetGpu(reqValid, resValid);
    expect(resValid.statusCode).toBe(200);
  });

  test('setPowerLimit endpoint validates parameters', async () => {
    const reqEmpty = { body: {} };
    const resEmpty = createMockRes();
    await gpuController.setPowerLimit(reqEmpty, resEmpty);
    expect(resEmpty.statusCode).toBe(400);

    const reqValid = { body: { gpuIndex: 0, watts: 250 } };
    const resValid = createMockRes();
    await gpuController.setPowerLimit(reqValid, resValid);
    expect(resValid.statusCode).toBe(200);
  });
});
