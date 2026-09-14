/**
 * Unit tests for Updater Module:
 * - src/modules/updater/updater.service.js
 * - src/modules/updater/updater.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const { default: updaterService } = await import('../src/modules/updater/updater.service.js');
const { default: updaterController } = await import('../src/modules/updater/updater.controller.js');

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
});

describe('UpdaterService — Validation Helpers', () => {
  test('validates git ref correctly', () => {
    expect(updaterService._validateGitRef('main')).toBe('main');
    expect(updaterService._validateGitRef('release/v3.5.0')).toBe('release/v3.5.0');
    expect(() => updaterService._validateGitRef('bad;rm')).toThrow('unsafe characters');
    expect(() => updaterService._validateGitRef('')).toThrow('Invalid git reference');
  });

  test('validates commit hash correctly', () => {
    const sha1 = 'a'.repeat(40);
    const sha256 = 'b'.repeat(64);
    expect(updaterService._validateCommitHash(sha1)).toBe(sha1);
    expect(updaterService._validateCommitHash(sha256)).toBe(sha256);
    expect(updaterService._validateCommitHash('')).toBe('');
    expect(() => updaterService._validateCommitHash('abc')).toThrow('Invalid commit hash format');
  });

  test('validates update channel correctly', () => {
    expect(updaterService._validateChannel('stable')).toBe('stable');
    expect(updaterService._validateChannel('beta')).toBe('beta');
    expect(updaterService._validateChannel('dev')).toBe('dev');
    expect(() => updaterService._validateChannel('alpha')).toThrow('Invalid update channel');
  });

  test('validates backup name correctly', () => {
    expect(updaterService._validateBackupName('pre-update-2026-09-14')).toBe('pre-update-2026-09-14');
    expect(() => updaterService._validateBackupName('')).toThrow('Backup name required');
    expect(() => updaterService._validateBackupName('bad/name')).toThrow('Invalid backup name');
    expect(() => updaterService._validateBackupName('a'.repeat(201))).toThrow('Backup name too long');
  });
});

describe('UpdaterService — Version and Update Information', () => {
  test('getVersionInfo returns version and system metadata', async () => {
    const info = await updaterService.getVersionInfo();
    expect(info.current).toBeDefined();
    expect(info.branch).toBeDefined();
    expect(info.nodeVersion).toBe(process.version);
    expect(info.os).toBe(process.platform);
  });

  test('checkForUpdates evaluates updates against remote', async () => {
    const updates = await updaterService.checkForUpdates();
    expect(updates.current).toBeDefined();
    expect(updates.latest).toBeDefined();
    expect(typeof updates.hasUpdate).toBe('boolean');
  });

  test('getChangelog returns array of commit objects', async () => {
    const changelog = await updaterService.getChangelog(5);
    expect(Array.isArray(changelog)).toBe(true);
  });

  test('getDiffPreview returns diff payload', async () => {
    const preview = await updaterService.getDiffPreview();
    expect(preview).toHaveProperty('diff');
  });

  test('performUpdate with dryRun returns dryRun flag without modifying system', async () => {
    const res = await updaterService.performUpdate({ dryRun: true });
    expect(res.success).toBe(true);
    expect(res.dryRun).toBe(true);
  });
});

describe('UpdaterController', () => {
  test('getVersionInfo returns 200 with version information', async () => {
    const req = {};
    const res = createMockRes();

    await updaterController.getVersionInfo(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.current).toBeDefined();
  });

  test('checkForUpdates returns 200 with update status', async () => {
    const req = {};
    const res = createMockRes();

    await updaterController.checkForUpdates(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('getChangelog returns 200 with list of entries', async () => {
    const req = { query: { limit: '10' } };
    const res = createMockRes();

    await updaterController.getChangelog(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.entries).toBeDefined();
  });

  test('dryRunUpdate returns dry run completion response', async () => {
    const req = { body: { method: 'git', branch: 'master' } };
    const res = createMockRes();

    await updaterController.dryRunUpdate(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.dryRun).toBe(true);
  });

  test('performRollback rejects missing commit and backup parameters with 400', async () => {
    const req = { body: {} };
    const res = createMockRes();

    await updaterController.performRollback(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
