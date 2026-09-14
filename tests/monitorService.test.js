/**
 * Unit Tests for Monitor Module:
 * - src/modules/monitor/monitor.service.js
 * - src/modules/monitor/prometheus.service.js
 * - src/modules/monitor/monitor.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockSi = {
  currentLoad: jest.fn(),
  mem: jest.fn(),
  fsSize: jest.fn(),
  networkStats: jest.fn(),
  cpuTemperature: jest.fn(),
  disksIO: jest.fn(),
  diskLayout: jest.fn(),
  networkInterfaces: jest.fn(),
  networkConnections: jest.fn(),
  processes: jest.fn(),
  osInfo: jest.fn(),
  cpu: jest.fn(),
};

const mockMonitorHistory = {
  create: jest.fn(),
  find: jest.fn(),
};

const mockDockerService = {
  getDashboardSummary: jest.fn(),
};

const mockDashboardService = {
  getMetrics: jest.fn(),
};

const mockDb = {
  prepare: jest.fn(),
};

jest.unstable_mockModule('systeminformation', () => ({
  default: mockSi,
  ...mockSi,
}));

jest.unstable_mockModule('../src/models/MonitorHistory.js', () => ({
  default: mockMonitorHistory,
}));

jest.unstable_mockModule('../src/modules/docker/docker.service.js', () => ({
  default: mockDockerService,
}));

jest.unstable_mockModule('../src/modules/dashboard/dashboard.service.js', () => ({
  default: mockDashboardService,
}));

jest.unstable_mockModule('../src/core/db/sqlite.js', () => ({
  getDb: () => mockDb,
}));

const { default: monitorService } = await import('../src/modules/monitor/monitor.service.js');
const { default: prometheusService } = await import('../src/modules/monitor/prometheus.service.js');
const { default: monitorController } = await import('../src/modules/monitor/monitor.controller.js');

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
  jest.clearAllMocks();
});

describe('MonitorService — Metrics and System Health', () => {
  test('getCurrent builds normalized metrics from systeminformation settled promises', async () => {
    mockSi.currentLoad.mockResolvedValue({
      currentLoad: 42.6,
      avgLoad1: 1.5,
      avgLoad5: 1.2,
      avgLoad15: 0.9,
    });
    mockSi.mem.mockResolvedValue({
      used: 4 * 1024 * 1024 * 1024,
      total: 8 * 1024 * 1024 * 1024,
      swapused: 512 * 1024 * 1024,
      swaptotal: 2 * 1024 * 1024 * 1024,
    });
    mockSi.fsSize.mockResolvedValue([
      { mount: '/', size: 100000, used: 60000, use: 60 },
      { mount: '/boot', size: 1000, used: 200, use: 20 },
    ]);
    mockSi.networkStats.mockResolvedValue([
      { iface: 'eth0', rx_sec: 1200, tx_sec: 800 },
    ]);
    mockSi.cpuTemperature.mockResolvedValue({ main: 55.4 });
    mockSi.disksIO.mockResolvedValue({ rIO_sec: 15, wIO_sec: 25 });

    const metrics = await monitorService.getCurrent();

    expect(metrics).toBeDefined();
    expect(metrics.cpu).toBe(43);
    expect(metrics.cpuTemp).toBe(55.4);
    expect(metrics.ramPercent).toBe(50);
    expect(metrics.diskUsed).toBe(60000);
    expect(metrics.diskPercent).toBe(60);
    expect(metrics.networkRx).toBe(1200);
    expect(metrics.networkTx).toBe(800);
    expect(metrics.diskRead).toBe(15);
    expect(metrics.diskWrite).toBe(25);
    expect(metrics.loadAvg).toEqual([1.5, 1.2, 0.9]);
    expect(metrics.timestamp).toBeGreaterThan(0);
  });

  test('getCurrent handles empty or rejected values with safe fallbacks', async () => {
    mockSi.currentLoad.mockRejectedValue(new Error('CPU load fail'));
    mockSi.mem.mockRejectedValue(new Error('Mem fail'));
    mockSi.fsSize.mockRejectedValue(new Error('Disk fail'));
    mockSi.networkStats.mockRejectedValue(new Error('Net fail'));
    mockSi.cpuTemperature.mockRejectedValue(new Error('Temp fail'));
    mockSi.disksIO.mockRejectedValue(new Error('DiskIO fail'));

    const metrics = await monitorService.getCurrent();

    expect(metrics.cpu).toBe(0);
    expect(metrics.cpuTemp).toBeNull();
    expect(metrics.ramPercent).toBe(0);
    expect(metrics.diskUsed).toBe(0);
    expect(metrics.networkRx).toBe(0);
    expect(metrics.diskRead).toBe(0);
  });

  test('saveHistory delegates to MonitorHistory.create and catches errors gracefully', async () => {
    mockMonitorHistory.create.mockResolvedValue({ id: 1 });
    await monitorService.saveHistory({ cpu: 20 });
    expect(mockMonitorHistory.create).toHaveBeenCalledWith({ metrics: { cpu: 20 } });

    // When create throws
    mockMonitorHistory.create.mockRejectedValue(new Error('DB write failed'));
    await expect(monitorService.saveHistory({ cpu: 20 })).resolves.toBeUndefined();
  });

  test('getHistory queries MonitorHistory and filters by timestamp', async () => {
    const now = Date.now();
    mockMonitorHistory.find.mockResolvedValue([
      { id: 1, timestamp: new Date(now - 30 * 60 * 1000).toISOString(), metrics: { cpu: 10 } },
      { id: 2, timestamp: new Date(now - 90 * 60 * 1000).toISOString(), metrics: { cpu: 15 } },
    ]);

    const history = await monitorService.getHistory(60);
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe(1);
  });

  test('getDiskHealth returns layout and smart IO data or handles errors', async () => {
    mockSi.diskLayout.mockResolvedValue([{ device: '/dev/sda', size: 500000 }]);
    mockSi.disksIO.mockResolvedValue({ rIO: 100 });

    const data = await monitorService.getDiskHealth();
    expect(data.disks).toHaveLength(1);
    expect(data.io.rIO).toBe(100);

    mockSi.diskLayout.mockRejectedValue(new Error('SMART fail'));
    mockSi.disksIO.mockRejectedValue(new Error('IO fail'));
    const fallback = await monitorService.getDiskHealth();
    expect(fallback.disks).toEqual([]);
    expect(fallback.io).toEqual({});
  });

  test('getNetworkStats filters out virtual interfaces and returns connections count', async () => {
    mockSi.networkInterfaces.mockResolvedValue([
      { iface: 'eth0', virtual: false },
      { iface: 'docker0', virtual: true },
    ]);
    mockSi.networkStats.mockResolvedValue([{ iface: 'eth0', rx_sec: 10 }]);
    mockSi.networkConnections.mockResolvedValue([{ state: 'ESTABLISHED' }, { state: 'LISTEN' }]);

    const net = await monitorService.getNetworkStats();
    expect(net.interfaces).toHaveLength(1);
    expect(net.interfaces[0].iface).toBe('eth0');
    expect(net.stats).toHaveLength(1);
    expect(net.connections).toBe(2);
  });

  test('checkAlerts flags thresholds for cpu, ram, and disk', () => {
    const alerts = monitorService.checkAlerts(
      { cpu: 95, ramPercent: 92, diskPercent: 80 },
      { cpu: 90, ram: 90, disk: 85 }
    );
    expect(alerts).toHaveLength(2);
    expect(alerts.map(a => a.type)).toEqual(['cpu', 'ram']);
  });

  test('getProcesses maps process attributes and handles errors gracefully', async () => {
    mockSi.processes.mockResolvedValue({
      list: [
        { pid: 1, name: 'systemd', cpu: 0.1, mem: 0.5, user: 'root', state: 'sleeping' },
        { pid: 2, name: 'node', cpu: 12.5, mem: 8.2, user: 'node', state: 'running' },
      ],
    });

    const procs = await monitorService.getProcesses();
    expect(procs).toHaveLength(2);
    expect(procs[1].name).toBe('node');
    expect(procs[1].cpu).toBe(12.5);

    mockSi.processes.mockRejectedValue(new Error('Process list fail'));
    const empty = await monitorService.getProcesses();
    expect(empty).toEqual([]);
  });
});

describe('PrometheusService — OpenMetrics Exporter', () => {
  test('getMetrics generates standard OpenMetrics format with host and app counters', async () => {
    mockDb.prepare.mockImplementation((sql) => {
      if (sql.includes('waf_rules')) {
        return { get: () => ({ c: 14 }) };
      }
      if (sql.includes('users')) {
        return { get: () => ({ c: 3 }) };
      }
      return { get: () => ({ c: 0 }) };
    });

    mockDockerService.getDashboardSummary.mockResolvedValue({
      containers: 8,
      containersRunning: 6,
      containersStopped: 2,
    });

    const output = await prometheusService.getMetrics();

    expect(output).toContain('# HELP node_cpu_count');
    expect(output).toContain('node_cpu_count');
    expect(output).toContain('# HELP node_load1');
    expect(output).toContain('node_load1');
    expect(output).toContain('# HELP node_memory_bytes_total');
    expect(output).toContain('panelku_waf_rules_total 14');
    expect(output).toContain('panelku_users_total 3');
    expect(output).toContain('panelku_docker_containers_total 8');
    expect(output).toContain('panelku_docker_containers_running 6');
    expect(output).toContain('panelku_docker_containers_stopped 2');
  });

  test('getMetrics handles DB or Docker exceptions gracefully', async () => {
    mockDb.prepare.mockImplementation(() => {
      throw new Error('DB query error');
    });
    mockDockerService.getDashboardSummary.mockRejectedValue(new Error('Docker not installed'));

    const output = await prometheusService.getMetrics();
    expect(output).toContain('panelku_waf_rules_total 0');
    expect(output).toContain('panelku_users_total 1');
  });
});

describe('MonitorController — Endpoints', () => {
  test('getCurrent returns success response or 500 error', async () => {
    const res = mockRes();
    jest.spyOn(monitorService, 'getCurrent').mockResolvedValue({ cpu: 25 });
    await monitorController.getCurrent({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.cpu).toBe(25);

    jest.spyOn(monitorService, 'getCurrent').mockRejectedValue(new Error('fail'));
    const errRes = mockRes();
    await monitorController.getCurrent({}, errRes);
    expect(errRes.statusCode).toBe(500);
  });

  test('getMetrics calls dashboardService.getMetrics', async () => {
    const res = mockRes();
    mockDashboardService.getMetrics.mockResolvedValue({ activeSites: 4 });
    await monitorController.getMetrics({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.activeSites).toBe(4);

    mockDashboardService.getMetrics.mockRejectedValue(new Error('dashboard error'));
    const errRes = mockRes();
    await monitorController.getMetrics({}, errRes);
    expect(errRes.statusCode).toBe(500);
  });

  test('getSysInfo returns os and cpu information', async () => {
    mockSi.osInfo.mockResolvedValue({ distro: 'Ubuntu', release: '24.04' });
    mockSi.cpu.mockResolvedValue({ manufacturer: 'Intel', brand: 'Core i7' });

    const res = mockRes();
    await monitorController.getSysInfo({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.os.distro).toBe('Ubuntu');
    expect(res.body.data.cpu.brand).toBe('Core i7');
  });

  test('getHistory, getDiskHealth, getNetworkStats, and getProcesses endpoints', async () => {
    jest.spyOn(monitorService, 'getHistory').mockResolvedValue([{ cpu: 10 }]);
    jest.spyOn(monitorService, 'getDiskHealth').mockResolvedValue({ disks: [] });
    jest.spyOn(monitorService, 'getNetworkStats').mockResolvedValue({ interfaces: [] });
    jest.spyOn(monitorService, 'getProcesses').mockResolvedValue([{ pid: 100 }]);

    const resHist = mockRes();
    await monitorController.getHistory({ query: { minutes: '30' } }, resHist);
    expect(resHist.statusCode).toBe(200);
    expect(resHist.body.data.minutes).toBe(30);

    const resDisk = mockRes();
    await monitorController.getDiskHealth({}, resDisk);
    expect(resDisk.statusCode).toBe(200);

    const resNet = mockRes();
    await monitorController.getNetworkStats({}, resNet);
    expect(resNet.statusCode).toBe(200);

    const resProc = mockRes();
    await monitorController.getProcesses({}, resProc);
    expect(resProc.statusCode).toBe(200);
  });
});
