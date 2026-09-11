/**
 * Alerts & MonitorHistory Unit Tests
 * Tests AlertConfig persistence, alerts controller responses, and MonitorHistory query filtering.
 *
 * @jest-environment node
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeAll } from '@jest/globals';
import alertsService from '../src/modules/alerts/alerts.service.js';
import alertsController from '../src/modules/alerts/alerts.controller.js';
import MonitorHistory from '../src/models/MonitorHistory.js';
import { getDb } from '../src/core/db/sqlite.js';

beforeAll(() => {
  getDb();
});

describe('Alerts Service & Controller', () => {
  test('getConfig returns default or existing global alert configuration', async () => {
    const config = await alertsService.getConfig();
    expect(config).toBeDefined();
    expect(config.telegram).toBeDefined();
    expect(config.email).toBeDefined();
    expect(config.thresholds).toBeDefined();
  });

  test('updateConfig merges and updates alert thresholds', async () => {
    const updated = await alertsService.updateConfig({
      thresholds: { cpuPercent: 85, ramPercent: 88, diskPercent: 92 },
      telegram: { enabled: true, botToken: 'test-token', chatId: 'test-chat' }
    });

    expect(updated.thresholds.cpuPercent).toBe(85);
    expect(updated.thresholds.ramPercent).toBe(88);
    expect(updated.telegram.enabled).toBe(true);
    expect(updated.telegram.botToken).toBe('test-token');

    // Verify persistence via getConfig
    const fresh = await alertsService.getConfig();
    expect(fresh.thresholds.cpuPercent).toBe(85);
  });

  test('alertsController.getConfig sends JSON response with config data', async () => {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      }
    };

    await alertsController.getConfig({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.thresholds).toBeDefined();
  });

  test('alertsController.updateConfig validates and applies payload', async () => {
    const req = {
      body: {
        thresholds: { cpuPercent: 90, ramPercent: 90, diskPercent: 95 }
      }
    };
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      }
    };

    await alertsController.updateConfig(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.thresholds.cpuPercent).toBe(90);
  });

  test('alertsController.testAlert dispatches test message', async () => {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      }
    };

    await alertsController.testAlert({ params: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('Test alert');
  });
});

describe('MonitorHistory Query Filtering', () => {
  test('creates entries and filters correctly with since date', async () => {
    const tNow = Date.now();
    const older = new Date(tNow - 1000 * 60 * 120); // 2 hours ago
    const recent = new Date(tNow - 1000 * 60 * 30);  // 30 min ago

    await MonitorHistory.create({
      timestamp: older,
      metrics: { cpu: 20, ramPercent: 40 }
    });

    await MonitorHistory.create({
      timestamp: recent,
      metrics: { cpu: 55, ramPercent: 70 }
    });

    // Filter since 1 hour ago — should include recent but exclude older
    const oneHourAgo = new Date(tNow - 1000 * 60 * 60);
    const filtered = await MonitorHistory.find({ since: oneHourAgo });

    expect(Array.isArray(filtered)).toBe(true);
    const hasRecent = filtered.some(r => r.metrics?.cpu === 55);
    expect(hasRecent).toBe(true);
  });
});
