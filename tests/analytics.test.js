/**
 * Analytics Module Unit Tests
 *
 * @jest-environment node
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { describe, test, expect, beforeAll } from '@jest/globals';
import analyticsService from '../src/modules/analytics/analytics.service.js';
import analyticsController from '../src/modules/analytics/analytics.controller.js';
import MonitorHistory from '../src/models/MonitorHistory.js';
import { getDb } from '../src/core/db/sqlite.js';

beforeAll(() => {
  getDb();
});

describe('Analytics Service', () => {
  test('getMetricsHistory returns series and stats structure', async () => {
    // Seed at least one history entry
    await MonitorHistory.create({
      cpu: 45,
      ramUsed: 4000,
      ramTotal: 8000,
      diskUsed: 50,
      diskTotal: 100,
    });

    const res = await analyticsService.getMetricsHistory(24);
    expect(res).toBeDefined();
    expect(Array.isArray(res.series)).toBe(true);
    expect(res.stats).toBeDefined();
    expect(res.stats.cpu).toBeDefined();
    expect(res.stats.ram).toBeDefined();
    expect(res.stats.disk).toBeDefined();
    expect(typeof res.count).toBe('number');
  });

  test('getRealtimeMetrics returns snapshot of system resources', async () => {
    const res = await analyticsService.getRealtimeMetrics();
    expect(res).toBeDefined();
    expect(res.cpu).toBeDefined();
    expect(typeof res.cpu.usage).toBe('number');
    expect(res.memory).toBeDefined();
    expect(res.disk).toBeDefined();
  });

  test('getWebLogs validates server and logType', async () => {
    await expect(
      analyticsService.getWebLogs('invalid_server', 'access')
    ).rejects.toThrow('Unknown web server: invalid_server');

    await expect(
      analyticsService.getWebLogs('nginx', 'invalid_type')
    ).rejects.toThrow('Invalid log type');
  });

  test('getSystemLogs returns graceful fallback structure when logs unavailable', async () => {
    const logs = await analyticsService.getSystemLogs('syslog', 10);
    expect(logs).toBeDefined();
    expect(Array.isArray(logs.lines)).toBe(true);
  });
});

describe('Analytics Controller', () => {
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

  test('getMetricsHistory returns HTTP 200', async () => {
    const res = mockRes();
    await analyticsController.getMetricsHistory({ query: { hours: '12' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.stats).toBeDefined();
  });

  test('getRealtimeMetrics returns HTTP 200', async () => {
    const res = mockRes();
    await analyticsController.getRealtimeMetrics({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.cpu).toBeDefined();
  });

  test('getSystemLogs returns HTTP 200', async () => {
    const res = mockRes();
    await analyticsController.getSystemLogs({ query: { type: 'syslog', lines: '20' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('getWebLogs handles invalid server with error response', async () => {
    const res = mockRes();
    await analyticsController.getWebLogs({ query: { service: 'unknown_srv' } }, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
  });

  test('getServiceHealth returns HTTP 200', async () => {
    const res = mockRes();
    await analyticsController.getServiceHealth({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
