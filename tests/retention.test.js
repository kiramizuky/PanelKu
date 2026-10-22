/**
 * Sprint 1 — Retention policies
 * audit_logs (90d / 200k), monitor_history (7d), update_history (50),
 * rotated log cleanup.
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'panelku-retention-'));
process.env.PANELKU_STORAGE = storageDir;
process.env.PANELKU_DB_PATH = path.join(storageDir, 'retention.db');

const { getDb, generateId } = await import('../src/core/db/sqlite.js');
const {
  pruneAuditLogs,
  pruneMonitorHistory,
  pruneUpdateHistory,
  pruneLogFiles,
  runRetention,
  RETENTION_DEFAULTS,
} = await import('../src/jobs/retention.job.js');

const DAY = 24 * 60 * 60 * 1000;

function insertAudit(db, id, createdAt) {
  db.prepare(`
    INSERT INTO audit_logs (id, user_id, username, action, resource, details, ip, user_agent, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(id, null, 'tester', 'TEST', 'system', '{}', '127.0.0.1', 'jest', 'success', createdAt);
}

function insertMonitor(db, id, timestamp) {
  db.prepare('INSERT INTO monitor_history (id, timestamp, metrics) VALUES (?,?,?)')
    .run(id, timestamp, '{}');
}

beforeAll(() => {
  getDb();
});

afterAll(async () => {
  try { getDb().close(); } catch { /* ignore */ }
  await fs.rm(storageDir, { recursive: true, force: true });
});

describe('Retention', () => {
  test('audit logs are pruned by age and row cap', () => {
    const db = getDb();
    db.prepare('DELETE FROM audit_logs').run();

    insertAudit(db, generateId(), new Date(Date.now() - 100 * DAY).toISOString()); // too old
    insertAudit(db, generateId(), new Date().toISOString()); // keep

    const byAge = pruneAuditLogs(db, RETENTION_DEFAULTS);
    expect(byAge.deletedByAge).toBe(1);

    // Force a tiny cap to test the OFFSET deletion branch.
    for (let i = 0; i < 5; i++) {
      insertAudit(db, generateId(), new Date(Date.now() - i * 1000).toISOString());
    }
    const capped = pruneAuditLogs(db, { ...RETENTION_DEFAULTS, auditMaxRows: 3 });
    expect(capped.remaining).toBe(3);
    expect(capped.deletedByCount).toBeGreaterThanOrEqual(2);
  });

  test('monitor history older than 7 days is removed', () => {
    const db = getDb();
    db.prepare('DELETE FROM monitor_history').run();

    insertMonitor(db, generateId(), new Date(Date.now() - 8 * DAY).toISOString());
    insertMonitor(db, generateId(), new Date(Date.now() - 6 * DAY).toISOString());

    const result = pruneMonitorHistory(db, RETENTION_DEFAULTS);
    expect(result.deleted).toBe(1);
    expect(result.remaining).toBe(1);
  });

  test('update history keeps 50 updates and 10 backups', async () => {
    const updates = Array.from({ length: 60 }, (_, i) => ({ type: 'update', status: 'success', id: i }));
    const backups = Array.from({ length: 15 }, (_, i) => ({ id: `b${i}` }));
    await fs.writeFile(
      path.join(storageDir, 'update_history.json'),
      JSON.stringify({ updates, backups }),
      'utf8'
    );

    const result = await pruneUpdateHistory({ storageDir });
    expect(result.trimmedUpdates).toBe(10);
    expect(result.trimmedBackups).toBe(5);

    const saved = JSON.parse(await fs.readFile(path.join(storageDir, 'update_history.json'), 'utf8'));
    expect(saved.updates).toHaveLength(50);
    expect(saved.backups).toHaveLength(10);
  });

  test('rotated log files older than the retention window are removed', async () => {
    const logsDir = path.join(storageDir, 'logs');
    await fs.mkdir(logsDir, { recursive: true });

    const oldFile = path.join(logsDir, 'combined1.log');
    const newFile = path.join(logsDir, 'error1.log');
    const activeFile = path.join(logsDir, 'combined.log');

    await fs.writeFile(oldFile, 'old', 'utf8');
    await fs.writeFile(newFile, 'new', 'utf8');
    await fs.writeFile(activeFile, 'active', 'utf8');

    const old = new Date(Date.now() - 30 * DAY);
    await fs.utimes(oldFile, old, old);

    const result = await pruneLogFiles({ logsDir, logDays: 14 });
    expect(result.deleted).toBe(1);
    await expect(fs.access(oldFile)).rejects.toBeTruthy();
    await expect(fs.access(newFile)).resolves.toBeUndefined();
    await expect(fs.access(activeFile)).resolves.toBeUndefined();
  });

  test('runRetention combines all policies', async () => {
    const result = await runRetention({
      storageDir,
      logsDir: path.join(storageDir, 'logs'),
      auditMaxRows: 100,
    });
    expect(result).toHaveProperty('audit');
    expect(result).toHaveProperty('monitor');
    expect(result).toHaveProperty('updates');
    expect(result).toHaveProperty('logs');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
