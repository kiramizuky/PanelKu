/**
 * Extended Unit Tests for Analytics Module:
 * - src/modules/analytics/analytics.service.js
 * - src/modules/analytics/analytics.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockSi = {
  processes: jest.fn(),
  networkInterfaces: jest.fn(),
  networkStats: jest.fn(),
  networkConnections: jest.fn(),
  currentLoad: jest.fn(),
  mem: jest.fn(),
  fsSize: jest.fn(),
  cpuTemperature: jest.fn(),
  disksIO: jest.fn(),
};

const mockExecHandlers = [];

jest.unstable_mockModule('systeminformation', () => ({
  default: mockSi,
  ...mockSi,
}));

jest.unstable_mockModule('child_process', () => ({
  exec: jest.fn((cmd, opts, cb) => {
    const callback = typeof opts === 'function' ? opts : cb;
    for (const handler of mockExecHandlers) {
      const match = handler(cmd);
      if (match !== undefined) {
        if (match instanceof Error) return callback(match);
        return callback(null, match);
      }
    }
    return callback(null, { stdout: '', stderr: '' });
  }),
}));

const mockFs = {
  access: jest.fn().mockResolvedValue(undefined),
};

jest.unstable_mockModule('fs/promises', () => ({
  default: mockFs,
  ...mockFs,
}));

const { default: analyticsService } = await import('../src/modules/analytics/analytics.service.js');
const { default: analyticsController } = await import('../src/modules/analytics/analytics.controller.js');

function mockRes() {
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
  mockExecHandlers.length = 0;
  jest.clearAllMocks();
});

describe('AnalyticsService — Top Processes', () => {
  test('getTopProcesses sorts by cpu by default and by mem when specified', async () => {
    mockSi.processes.mockResolvedValue({
      list: [
        { pid: 1, name: 'procA', cpu: 15.2, mem: 4.1, mem_rss: 40000, user: 'root', state: 'R', command: 'procA --run' },
        { pid: 2, name: 'procB', cpu: 45.8, mem: 2.0, mem_rss: 20000, user: 'node', state: 'S', command: 'procB' },
        { pid: 3, name: 'procC', cpu: 5.0, mem: 18.5, mem_rss: 180000, user: 'mysql', state: 'S', command: 'procC' },
      ],
    });

    const topCpu = await analyticsService.getTopProcesses('cpu', 2);
    expect(topCpu).toHaveLength(2);
    expect(topCpu[0].name).toBe('procB');
    expect(topCpu[1].name).toBe('procA');

    const topMem = await analyticsService.getTopProcesses('mem', 2);
    expect(topMem).toHaveLength(2);
    expect(topMem[0].name).toBe('procC');
    expect(topMem[1].name).toBe('procA');

    mockSi.processes.mockRejectedValue(new Error('fail'));
    const fallback = await analyticsService.getTopProcesses();
    expect(fallback).toEqual([]);
  });
});

describe('AnalyticsService — Network Analytics', () => {
  test('getNetworkAnalytics filters virtual interfaces and aggregates connection states and listening ports', async () => {
    mockSi.networkInterfaces.mockResolvedValue([
      { iface: 'eth0', ip4: '192.168.1.10', ip6: 'fe80::1', mac: '00:11:22', type: 'wired', speed: 1000, virtual: false },
      { iface: 'docker0', ip4: '172.17.0.1', virtual: true },
    ]);
    mockSi.networkStats.mockResolvedValue([
      { iface: 'eth0', rx_sec: 500, tx_sec: 1200, rx_bytes: 50000, tx_bytes: 120000 },
    ]);
    mockSi.networkConnections.mockResolvedValue([
      { state: 'ESTABLISHED', localPort: 443, process: { name: 'nginx' } },
      { state: 'listen', localPort: 80, process: { name: 'nginx' } },
      { state: 'listen', localPort: 22, process: { name: 'sshd' } },
      { state: 'listen', localPort: 80, process: { name: 'nginx' } }, // Duplicate port test for unique Map
    ]);

    const net = await analyticsService.getNetworkAnalytics();
    expect(net.interfaces).toHaveLength(1);
    expect(net.interfaces[0].name).toBe('eth0');
    expect(net.traffic[0].rxSec).toBe(500);
    expect(net.connections.total).toBe(4);
    expect(net.connections.byState.ESTABLISHED).toBe(1);
    expect(net.connections.byState.listen).toBe(3);
    expect(net.connections.listeningPorts).toHaveLength(2);
  });
});

describe('AnalyticsService — Docker Analytics', () => {
  test('getDockerAnalytics parses container list, live stats, and daemon info', async () => {
    mockExecHandlers.push(cmd => {
      if (cmd.includes('docker ps')) {
        return { stdout: 'abc1234567890\tnginx:alpine\tUp 3 hours\tweb-server\t0.0.0.0:80->80/tcp\n' };
      }
      if (cmd.includes('docker stats')) {
        return { stdout: 'web-server\t1.5%\t2.4%\t45MB / 2GB\n' };
      }
      if (cmd.includes('docker info')) {
        return { stdout: '1\t4\t24.0.5\n' };
      }
    });

    const data = await analyticsService.getDockerAnalytics();
    expect(data.installed).toBe(true);
    expect(data.containers).toHaveLength(1);
    expect(data.containers[0].id).toBe('abc123456789');
    expect(data.containers[0].name).toBe('web-server');
    expect(data.containerStats).toHaveLength(1);
    expect(data.containerStats[0].cpu).toBe('1.5%');
    expect(data.summary.running).toBe(1);
    expect(data.summary.total).toBe(1);
  });

  test('getDockerAnalytics handles docker unavailable gracefully', async () => {
    mockExecHandlers.push(() => new Error('docker daemon not running'));

    const data = await analyticsService.getDockerAnalytics();
    expect(data.installed).toBe(false);
    expect(data.containers).toEqual([]);
    expect(data.summary.running).toBe(0);
  });
});

describe('AnalyticsService — Service Health & Logs', () => {
  test('getServiceHealth parses systemctl units and enriches with ps metrics', async () => {
    mockExecHandlers.push(cmd => {
      if (cmd.includes('systemctl list-units')) {
        return {
          stdout:
            'nginx.service loaded active running A high performance web server\n' +
            'mysql.service loaded failed failed MySQL Community Server\n' +
            'cron.service loaded active running Regular background program processing daemon\n'
        };
      }
      if (cmd.includes('ps aux')) {
        return { stdout: 'www-data 123 0.5 1.2 /usr/sbin/nginx\nwww-data 124 0.3 0.8 /usr/sbin/nginx\n' };
      }
    });

    const health = await analyticsService.getServiceHealth();
    expect(health.services.length).toBeGreaterThanOrEqual(1);
    expect(health.stats.total).toBe(3);
    expect(health.stats.running).toBe(2);
    expect(health.stats.failed).toBe(1);

    mockExecHandlers.length = 0;
    mockExecHandlers.push(() => new Error('systemctl failed'));
    const fallback = await analyticsService.getServiceHealth();
    expect(fallback.stats.total).toBe(0);
  });

  test('getWebLogs parses common log format and identifies error levels', async () => {
    mockExecHandlers.push(cmd => {
      if (cmd.includes('tail -n')) {
        return {
          stdout:
            '192.168.1.50 - - [14/Sep/2026:12:00:00 +0000] "GET /index.html HTTP/1.1" 200 1024\n' +
            '192.168.1.51 - - [14/Sep/2026:12:00:01 +0000] "POST /api/login HTTP/1.1" 401 256\n'
        };
      }
    });

    const logs = await analyticsService.getWebLogs('nginx', 'access', 10);
    expect(logs.service).toBe('nginx');
    expect(logs.lines).toHaveLength(2);
    expect(logs.lines[0].ip).toBe('192.168.1.50');
    expect(logs.lines[0].status).toBe(200);
    expect(logs.lines[0].level).toBe('info');
    expect(logs.lines[1].status).toBe(401);
    expect(logs.lines[1].level).toBe('error');
  });

  test('getSystemLogs parses structured lines with level and service names', async () => {
    mockExecHandlers.push(cmd => {
      if (cmd.includes('tail -n')) {
        return {
          stdout:
            'Sep 14 10:00:00 server sshd[1234]: Accepted publickey for admin\n' +
            'Sep 14 10:01:00 server kernel: [123.456] Error: disk timeout warning\n'
        };
      }
    });

    const logs = await analyticsService.getSystemLogs('syslog', 20);
    expect(logs.lines).toHaveLength(2);
    expect(logs.lines[0].service).toBe('sshd[1234]');
    expect(logs.lines[0].level).toBe('info');
    expect(logs.lines[1].level).toBe('error');
  });
});

describe('AnalyticsController — Extended Endpoints', () => {
  test('getTopProcesses, getNetworkAnalytics, getDockerAnalytics', async () => {
    jest.spyOn(analyticsService, 'getTopProcesses').mockResolvedValue([{ pid: 1 }]);
    jest.spyOn(analyticsService, 'getNetworkAnalytics').mockResolvedValue({ interfaces: [] });
    jest.spyOn(analyticsService, 'getDockerAnalytics').mockResolvedValue({ installed: true });

    const res1 = mockRes();
    await analyticsController.getTopProcesses({ query: { sortBy: 'mem', limit: '5' } }, res1);
    expect(res1.statusCode).toBe(200);
    expect(res1.body.data).toHaveLength(1);

    const res2 = mockRes();
    await analyticsController.getNetworkAnalytics({}, res2);
    expect(res2.statusCode).toBe(200);

    const res3 = mockRes();
    await analyticsController.getDockerAnalytics({}, res3);
    expect(res3.statusCode).toBe(200);
  });
});
