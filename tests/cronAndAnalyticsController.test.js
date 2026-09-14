/**
 * Cron Controller & Analytics Controller Unit Tests
 *
 * @jest-environment node
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import cronController from '../src/modules/cron/cron.controller.js';
import analyticsController from '../src/modules/analytics/analytics.controller.js';
import cronService from '../src/modules/cron/cron.service.js';
import analyticsService from '../src/modules/analytics/analytics.service.js';

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(d) {
      this.body = d;
      return this;
    },
  };
}

describe('CronController', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('getTasks returns task list', async () => {
    jest.spyOn(cronService, 'getTasks').mockResolvedValue([{ id: 'c1', name: 'backup' }]);
    const res = mockRes();
    await cronController.getTasks({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBe(1);
  });

  test('addTask validates input parameters', async () => {
    const badRes = mockRes();
    await cronController.addTask({ body: {} }, badRes);
    expect(badRes.statusCode).toBe(400);

    jest.spyOn(cronService, 'addTask').mockResolvedValue({ id: 'c2', name: 'sync' });
    const goodRes = mockRes();
    await cronController.addTask({ body: { schedule: '0 * * * *', command: 'echo 1', name: 'sync' } }, goodRes);
    expect(goodRes.statusCode).toBe(200);
  });

  test('deleteTask removes cron task', async () => {
    jest.spyOn(cronService, 'deleteTask').mockResolvedValue(true);
    const res = mockRes();
    await cronController.deleteTask({ params: { id: 'c1' } }, res);
    expect(res.statusCode).toBe(200);
  });

  test('toggleTask toggles status', async () => {
    jest.spyOn(cronService, 'toggleTask').mockResolvedValue({ id: 'c1', status: 'active' });
    const res = mockRes();
    await cronController.toggleTask({ params: { id: 'c1' } }, res);
    expect(res.statusCode).toBe(200);
  });
});

describe('AnalyticsController', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('getMetricsHistory and getRealtimeMetrics', async () => {
    jest.spyOn(analyticsService, 'getMetricsHistory').mockResolvedValue({ history: [] });
    jest.spyOn(analyticsService, 'getRealtimeMetrics').mockResolvedValue({ cpu: 15 });

    const resHist = mockRes();
    await analyticsController.getMetricsHistory({ query: { hours: '12' } }, resHist);
    expect(resHist.statusCode).toBe(200);

    const resRt = mockRes();
    await analyticsController.getRealtimeMetrics({}, resRt);
    expect(resRt.statusCode).toBe(200);
  });

  test('logs: getSystemLogs and getWebLogs', async () => {
    jest.spyOn(analyticsService, 'getSystemLogs').mockResolvedValue(['log1', 'log2']);
    jest.spyOn(analyticsService, 'getWebLogs').mockResolvedValue(['nginx log']);

    const resSys = mockRes();
    await analyticsController.getSystemLogs({ query: { type: 'syslog', lines: '50' } }, resSys);
    expect(resSys.statusCode).toBe(200);

    const resWeb = mockRes();
    await analyticsController.getWebLogs({ query: { service: 'nginx', logType: 'access', lines: '50' } }, resWeb);
    expect(resWeb.statusCode).toBe(200);
  });

  test('serviceHealth, topProcesses, network and docker analytics', async () => {
    jest.spyOn(analyticsService, 'getServiceHealth').mockResolvedValue({ healthy: true });
    jest.spyOn(analyticsService, 'getTopProcesses').mockResolvedValue([{ pid: 101, name: 'node' }]);
    jest.spyOn(analyticsService, 'getNetworkAnalytics').mockResolvedValue({ rx_bytes: 1000 });
    jest.spyOn(analyticsService, 'getDockerAnalytics').mockResolvedValue({ containers: 3 });

    const resHealth = mockRes();
    await analyticsController.getServiceHealth({}, resHealth);
    expect(resHealth.statusCode).toBe(200);

    const resProc = mockRes();
    await analyticsController.getTopProcesses({ query: { sort: 'cpu', limit: '10' } }, resProc);
    expect(resProc.statusCode).toBe(200);

    const resNet = mockRes();
    await analyticsController.getNetworkAnalytics({}, resNet);
    expect(resNet.statusCode).toBe(200);

    const resDoc = mockRes();
    await analyticsController.getDockerAnalytics({}, resDoc);
    expect(resDoc.statusCode).toBe(200);
  });
});
