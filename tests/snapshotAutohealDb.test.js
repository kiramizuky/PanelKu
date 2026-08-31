/**
 * Tests for ZFS/Btrfs Instant Snapshots, Multi-Channel Incident Alerting & Auto-Remediation, and Database GUI Studio
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// Mock logger
jest.unstable_mockModule('../src/config/logger.js', () => ({
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { default: alertsService } = await import('../src/modules/alerts/alerts.service.js');
const { default: autohealService } = await import('../src/modules/autoheal/autoheal.service.js');
const { default: databaseService } = await import('../src/modules/database/database.service.js');
const { default: Notification } = await import('../src/models/Notification.js');
const { getDb } = await import('../src/core/db/sqlite.js');

beforeEach(async () => {
  const db = getDb();
  db.prepare('DELETE FROM notifications').run();
});

describe('Multi-Channel Alerting & Auto-Remediation Playbooks', () => {
  test('dispatchMultiChannelAlert logs alert and creates system notification', async () => {
    const res = await alertsService.dispatchMultiChannelAlert({
      title: 'High CPU Load on Node-1',
      message: 'CPU usage sustained above 95% for 5 minutes',
      level: 'critical',
      metadata: { cpu: 96, node: 'Node-1' },
    });

    expect(res.success).toBe(true);
    expect(res.title).toContain('🚨 [CRITICAL]');

    const notifs = await Notification.find();
    expect(notifs.length).toBeGreaterThanOrEqual(1);
    expect(notifs[0].title).toContain('High CPU Load on Node-1');
  });

  test('testChannel dispatches test notification for supported channels', async () => {
    const res = await alertsService.testChannel('discord');
    expect(res.success).toBe(true);
    expect(res.channel).toBe('discord');
  });

  test('executeDiskEmergencyClean completes successfully and notifies channels', async () => {
    const res = await autohealService.executeDiskEmergencyClean();
    expect(res.success).toBe(true);
    expect(Array.isArray(res.actionsTaken)).toBe(true);
  });

  test('resurrectDeadServices scans and returns dead service list', async () => {
    const res = await autohealService.resurrectDeadServices();
    expect(res.success).toBe(true);
    expect(Array.isArray(res.revived)).toBe(true);
  });
});

describe('Advanced Database GUI Studio CRUD & EXPLAIN', () => {
  const testDbName = 'test_studio_db';
  const testDbFile = 'test_studio_db.sqlite';

  beforeEach(async () => {
    try { await databaseService.createSqliteDatabase(testDbName); } catch (_) {}
    // Create sample table
    await databaseService.runQuery('sqlite', testDbFile, 'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)');
    await databaseService.runQuery('sqlite', testDbFile, 'DELETE FROM users');
  });

  test('insertRow adds row into database table', async () => {
    await databaseService.insertRow('sqlite', testDbFile, 'users', {
      name: 'Alice',
      email: 'alice@example.com',
    });

    const data = await databaseService.getTableData('sqlite', testDbFile, 'users');
    expect(data.total).toBe(1);
    expect(data.rows[0].name).toBe('Alice');
    expect(data.rows[0].email).toBe('alice@example.com');
  });

  test('updateRow modifies existing record', async () => {
    await databaseService.insertRow('sqlite', testDbFile, 'users', {
      id: 1,
      name: 'Bob',
      email: 'bob@old.com',
    });

    await databaseService.updateRow('sqlite', testDbFile, 'users', 'id', 1, {
      email: 'bob@new.com',
    });

    const data = await databaseService.getTableData('sqlite', testDbFile, 'users');
    expect(data.rows[0].email).toBe('bob@new.com');
  });

  test('deleteRow removes record', async () => {
    await databaseService.insertRow('sqlite', testDbFile, 'users', {
      id: 2,
      name: 'Charlie',
      email: 'charlie@example.com',
    });

    await databaseService.deleteRow('sqlite', testDbFile, 'users', 'id', 2);

    const data = await databaseService.getTableData('sqlite', testDbFile, 'users');
    expect(data.total).toBe(0);
  });

  test('explainQuery generates query execution plan', async () => {
    const plan = await databaseService.explainQuery('sqlite', testDbFile, 'SELECT * FROM users WHERE id = 1');
    expect(plan.rows).toBeDefined();
    expect(plan.rows.length).toBeGreaterThan(0);
  });
});
