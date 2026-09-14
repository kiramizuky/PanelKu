/**
 * Unit tests for Backup Module:
 * - src/modules/backup/backup.service.js
 * - src/modules/backup/backup.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach, afterAll } from '@jest/globals';
import path from 'path';

let settingsStore = {};

jest.unstable_mockModule('../src/models/Setting.js', () => ({
  default: {
    get: jest.fn(async (key, fallback = null) => {
      return settingsStore[key] !== undefined ? settingsStore[key] : fallback;
    }),
    set: jest.fn(async (key, value) => {
      settingsStore[key] = value;
      return true;
    }),
  },
}));

jest.unstable_mockModule('../plugins/shared/rclone-helper.js', () => ({
  detectRclone: jest.fn(async () => ({ installed: true, bin: 'rclone', version: 'v1.65.0' })),
  getRcloneStatus: jest.fn(async () => ({ installed: true, remotes: ['gdrive', 's3remote'] })),
}));

jest.unstable_mockModule('../src/modules/database/database.service.js', () => ({
  default: {
    backupDatabase: jest.fn(async () => ({ filePath: '/tmp/test.db' })),
    loadMysqlConfig: jest.fn(async () => ({})),
    loadPgConfig: jest.fn(async () => ({})),
    listMysqlDatabases: jest.fn(async () => []),
    listPgDatabases: jest.fn(async () => []),
  },
}));

const { default: backupService, validateRestoreTarget } = await import('../src/modules/backup/backup.service.js');
const { default: backupController } = await import('../src/modules/backup/backup.controller.js');
const { default: queueManager } = await import('../src/core/queue/QueueManager.js');

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 100));
  await queueManager.closeAll();
});

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
  settingsStore = {};
});

describe('BackupService — Path and Target Validation', () => {
  test('validateRestoreTarget accepts valid relative and /var/www paths', () => {
    expect(validateRestoreTarget('app/site')).toBe(path.resolve('/var/www', 'app/site'));
    expect(validateRestoreTarget('/var/www/myweb')).toBe(path.resolve('/var/www', 'myweb'));
  });

  test('validateRestoreTarget blocks traversal and prefix escapes', () => {
    expect(() => validateRestoreTarget('/var/www2')).toThrow(/within \/var\/www/);
    expect(() => validateRestoreTarget('../etc')).toThrow(/within \/var\/www/);
    expect(() => validateRestoreTarget('')).toThrow(/required/);
  });
});

describe('BackupService — Backup Jobs Management', () => {
  test('createBackupJob validates required fields and creates job', async () => {
    const jobData = {
      name: 'daily-web',
      source: 'var/www/html',
      remote: 'gdrive',
      destPath: 'backups/daily',
      schedule: '0 2 * * *',
    };

    const res = await backupService.createBackupJob(jobData);
    expect(res.job).toBeDefined();
    expect(res.job.name).toBe('daily-web');
    expect(res.job.remote).toBe('gdrive');

    const list = await backupService.getBackupJobs();
    expect(list.jobs).toHaveLength(1);
    expect(list.jobs[0].id).toBe(res.job.id);
  });

  test('createBackupJob rejects invalid remote names or patterns', async () => {
    await expect(
      backupService.createBackupJob({ name: 'job1', source: 'var/www', remote: 'bad;remote' })
    ).rejects.toThrow('Invalid remote name');

    await expect(
      backupService.createBackupJob({
        name: 'job2',
        source: 'var/www',
        remote: 'valid',
        includePatterns: ['safe*', 'unsafe;rm'],
      })
    ).rejects.toThrow('Invalid include pattern');
  });

  test('updateBackupJob modifies job settings', async () => {
    const created = await backupService.createBackupJob({
      name: 'orig-job',
      source: 'var/www',
      remote: 'gdrive',
    });

    const updated = await backupService.updateBackupJob(created.job.id, {
      name: 'new-job-name',
      schedule: '0 4 * * *',
    });

    expect(updated.job.name).toBe('new-job-name');
    expect(updated.job.schedule).toBe('0 4 * * *');
  });

  test('updateBackupJob throws 404 for unknown job', async () => {
    await expect(backupService.updateBackupJob('unknown-id', { name: 'x' })).rejects.toThrow(
      'Backup job not found'
    );
  });

  test('deleteBackupJob removes existing job and rejects unknown ID', async () => {
    const created = await backupService.createBackupJob({
      name: 'to-delete',
      source: 'var/www',
      remote: 'gdrive',
    });

    const delRes = await backupService.deleteBackupJob(created.job.id);
    expect(delRes.message).toBe('Backup job deleted');

    await expect(backupService.deleteBackupJob('non-existent')).rejects.toThrow('Backup job not found');
  });
});

describe('BackupService — S3 Configuration', () => {
  test('getS3Config returns empty object by default and saves updated config', async () => {
    const emptyConfig = await backupService.getS3Config();
    expect(emptyConfig).toEqual({});

    await backupService.updateS3Config({
      enabled: true,
      bucket: 'my-panel-backups',
      region: 'ap-southeast-1',
      accessKey: 'AKIA123',
      secretKey: 'secret123',
    });

    const saved = await backupService.getS3Config();
    expect(saved.enabled).toBe(true);
    expect(saved.bucket).toBe('my-panel-backups');
  });

  test('updateS3Config validates bucket name format', async () => {
    await expect(
      backupService.updateS3Config({ bucket: 'INVALID_BUCKET_NAME!' })
    ).rejects.toThrow('Invalid S3 bucket name format');
  });
});

describe('BackupService — Queue Integration', () => {
  test('queueCreateBackup adds task to queue and retrieves status', async () => {
    const queued = await backupService.queueCreateBackup('sqlite', 'panelku');
    expect(queued.id).toBeDefined();
    expect(queued.queueName).toBe('backup');

    const status = await backupService.getQueueJobStatus(queued.id);
    expect(status).toBeDefined();
    expect(status.id).toBe(queued.id);
  });
});

describe('BackupController', () => {
  test('getRcloneStatus returns status data', async () => {
    const req = {};
    const res = createMockRes();

    await backupController.getRcloneStatus(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('testRemote rejects missing remote name', async () => {
    const req = { body: {} };
    const res = createMockRes();

    await backupController.testRemote(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('createBackupJob returns 201 on success', async () => {
    const req = {
      body: {
        name: 'controller-job',
        source: 'var/www',
        remote: 'gdrive',
      },
    };
    const res = createMockRes();

    await backupController.createBackupJob(req, res);
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.job.name).toBe('controller-job');
  });

  test('runBackupJob handles async queue execution with 202 Accepted', async () => {
    const created = await backupService.createBackupJob({
      name: 'async-job',
      source: 'var/www',
      remote: 'gdrive',
    });

    const req = {
      params: { id: created.job.id },
      query: { async: 'true' },
    };
    const res = createMockRes();

    await backupController.runBackupJob(req, res);
    expect(res.statusCode).toBe(202);
    expect(res.body.data.id).toBeDefined();
  });
});
