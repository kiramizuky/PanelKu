/**
 * Migrator — Unit tests for the SQLite migration system
 *
 * Tests migration runner, rollback, and status tracking.
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach, afterAll } from '@jest/globals';

// ── Mocks ──
jest.unstable_mockModule('../src/config/logger.js', () => ({
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

// Use a temporary in-memory SQLite for testing
process.env.PANELKU_DB_PATH = ':memory:';

import Database from 'better-sqlite3';

const db = new Database(':memory:');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const { runMigrations, rollbackMigration, getMigrationStatus } = await import('../src/core/db/Migrator.js');

afterAll(() => {
  db.close();
});

describe('Migrator — Migration System', () => {
  beforeEach(() => {
    // Clean up schema_migrations table
    try { db.exec('DROP TABLE IF EXISTS schema_migrations'); } catch {}
  });

  test('runMigrations creates schema_migrations table and applies migrations', async () => {
    const result = await runMigrations(db);

    // Should have applied at least 2 migrations (001_initial, 002_alter)
    expect(result.applied.length).toBeGreaterThanOrEqual(2);
    expect(result.applied).toContain('001');
    expect(result.applied).toContain('002');

    // Verify tracking table exists and has records
    const rows = db.prepare('SELECT COUNT(*) as count FROM schema_migrations').get();
    expect(rows.count).toBeGreaterThanOrEqual(2);
  });

  test('runMigrations is idempotent — re-running skips applied migrations', async () => {
    // First run
    await runMigrations(db);

    // Second run — should skip all
    const result = await runMigrations(db);
    expect(result.applied.length).toBe(0);
    expect(result.skipped.length).toBeGreaterThanOrEqual(2);
  });

  test('getMigrationStatus returns correct status', async () => {
    // Run first batch
    await runMigrations(db);

    const status = await getMigrationStatus(db);
    expect(status.applied.length).toBeGreaterThanOrEqual(2);
    expect(status.pending.length).toBe(0); // All current migrations applied
  });

  test('getMigrationStatus shows pending before running', async () => {
    const status = await getMigrationStatus(db);
    expect(status.applied.length).toBe(0);
    expect(status.pending.length).toBeGreaterThanOrEqual(2);
  });

  test('rollbackMigration removes last applied migration', async () => {
    // Apply all
    await runMigrations(db);

    const before = await getMigrationStatus(db);
    const lastApplied = before.applied[before.applied.length - 1].version;

    // Rollback last
    const result = await rollbackMigration(db);
    expect(result.rolledBack).toBe(lastApplied);

    // Verify it's now pending
    const after = await getMigrationStatus(db);
    const rolledBack = after.applied.find(m => m.version === lastApplied);
    expect(rolledBack).toBeUndefined();
  });

  test('rollbackMigration returns null when no migrations to rollback', async () => {
    const result = await rollbackMigration(db);
    expect(result.rolledBack).toBeNull();
  });

  test('migration 001 creates all base tables', async () => {
    await runMigrations(db);

    // Check that key tables exist
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const tableNames = tables.map(t => t.name);

    expect(tableNames).toContain('roles');
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('sessions');
    expect(tableNames).toContain('websites');
    expect(tableNames).toContain('settings');
    expect(tableNames).toContain('audit_logs');
    expect(tableNames).toContain('alert_configs');
    expect(tableNames).toContain('monitor_history');
    expect(tableNames).toContain('waf_rules');
    expect(tableNames).toContain('honeypot_hits');
    expect(tableNames).toContain('notifications');
    expect(tableNames).toContain('whatsapp_sessions');
    expect(tableNames).toContain('cluster_nodes');
    expect(tableNames).toContain('passkeys');
    expect(tableNames).toContain('webpush_subscriptions');
    expect(tableNames).toContain('security_scans');
    expect(tableNames).toContain('incident_reports');
    expect(tableNames).toContain('backup_snapshots');
  });

  test('migration 002 adds alter columns to existing tables', async () => {
    await runMigrations(db);

    // Check that alter columns exist
    const usersCols = db.prepare("PRAGMA table_info(users)").all();
    const usersColNames = usersCols.map(c => c.name);

    expect(usersColNames).toContain('ai_settings');
    expect(usersColNames).toContain('is_ldap_user');
    expect(usersColNames).toContain('sso_links');
    expect(usersColNames).toContain('must_change_password');
    expect(usersColNames).toContain('password_changed_at');

    const websitesCols = db.prepare("PRAGMA table_info(websites)").all();
    const websitesColNames = websitesCols.map(c => c.name);

    expect(websitesColNames).toContain('git_branch');
    expect(websitesColNames).toContain('target_host');

    const alertCols = db.prepare("PRAGMA table_info(alert_configs)").all();
    const alertColNames = alertCols.map(c => c.name);

    expect(alertColNames).toContain('whatsapp');
  });
});
