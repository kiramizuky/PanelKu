/**
 * BackupService — Unit tests for CRUD operations, rclone, S3 config, validation helpers
 *
 * Uses native ESM + jest.unstable_mockModule pattern.
 * External deps (fs, child_process, Setting, rclone-helper, queueManager) are mocked.
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach, beforeAll, afterAll } from '@jest/globals';

// ── Mocks ──
jest.unstable_mockModule('../src/config/logger.js', () => ({
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.unstable_mockModule('../src/models/Setting.js', () => ({
  default: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => {}),
  },
}));

jest.unstable_mockModule('../plugins/shared/rclone-helper.js', () => ({
  detectRclone: jest.fn(async () => ({ installed: true, bin: 'rclone', version: '1.65.0' })),
  getRcloneStatus: jest.fn(async () => ({ installed: true, version: '1.65.0', remotes: [] })),
}));

jest.unstable_mockModule('child_process', () => ({
  spawn: jest.fn(() => {
    const child = {
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
      on: jest.fn((event, cb) => {
        if (event === 'close') cb(0);
      }),
      stdin: { write: jest.fn(), end: jest.fn() },
    };
    return child;
  }),
  exec: jest.fn((cmd, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    if (typeof cb === 'function') cb(null, { stdout: '', stderr: '' });
    return { kill: jest.fn() };
  }),
}));

const fsMock = {
  access: jest.fn(async () => {}),
  mkdir: jest.fn(async () => {}),
  readFile: jest.fn(async () => ''),
  writeFile: jest.fn(async () => {}),
  readdir: jest.fn(async () => []),
  unlink: jest.fn(async () => {}),
  rm: jest.fn(async () => {}),
  stat: jest.fn(async () => ({ size: 1024, mtime: new Date() })),
};
jest.unstable_mockModule('fs/promises', () => ({ default: fsMock }));

jest.unstable_mockModule('../src/core/queue/QueueManager.js', () => ({
  default: {
    registerWorker: jest.fn(),
    addJob: jest.fn(async () => ({ id: 'job-1', name: 'test', queueName: 'backup', isFallback: true })),
    getJob: jest.fn(async () => null),
    getQueueMetrics: jest.fn(async () => ({ waiting: 0, active: 0, completed: 0, failed: 0 })),
    closeAll: jest.fn(async () => {}),
  },
}));

// ── Dynamic imports ──
const { default: backupService } = await import('../src/modules/backup/backup.service.js');
const { validateRestoreTarget } = await import('../src/modules/backup/backup.service.js');
const Setting = (await import('../src/models/Setting.js')).default;
const { detectRclone } = await import('../plugins/shared/rclone-helper.js');

beforeEach(() => {
  jest.clearAllMocks();
});

afterAll(async () => {
  const { default: queueManager } = await import('../src/core/queue/QueueManager.js');
  await queueManager.closeAll();
});

// ═══════════════════════════════════════════════════════════
//  VALIDATION HELPERS
// ═══════════════════════════════════════════════════════════

describe('BackupService — Validation Helpers', () => {
  describe('validateRestoreTarget', () => {
    test('accepts targets inside /var/www', () => {
      expect(validateRestoreTarget('app/site')).toBeTruthy();
      expect(validateRestoreTarget('/var/www/app')).toBeTruthy();
    });

    test('rejects sibling prefix escape (/var/www2)', () => {
      expect(() => validateRestoreTarget('/var/www2')).toThrow(/within/);
      expect(() => validateRestoreTarget('/var/www-evil')).toThrow(/within/);
    });

    test('rejects traversal and absolute escapes', () => {
      expect(() => validateRestoreTarget('../etc')).toThrow(/within/);
      expect(() => validateRestoreTarget('/etc')).toThrow(/within/);
      expect(() => validateRestoreTarget('../../../../etc')).toThrow(/within/);
    });

    test('rejects empty / undefined targets', () => {
      expect(() => validateRestoreTarget('')).toThrow(/required/);
      expect(() => validateRestoreTarget(undefined)).toThrow(/required/);
      expect(() => validateRestoreTarget(null)).toThrow(/required/);
    });
  });
});

// ═══════════════════════════════════════════════════════════
//  RCLONE MANAGEMENT
// ═══════════════════════════════════════════════════════════

describe('BackupService — Rclone Management', () => {
  test('getRcloneStatus returns status from helper', async () => {
    Setting.get.mockResolvedValue(null);
    const result = await backupService.getRcloneStatus();
    expect(result.installed).toBe(true);
  });

  test('getRcloneConfigPathSetting returns stored path', async () => {
    Setting.get.mockResolvedValue('/etc/rclone.conf');
    const result = await backupService.getRcloneConfigPathSetting();
    expect(result).toBe('/etc/rclone.conf');
  });

  test('getRcloneConfigPathSetting returns null when not set', async () => {
    Setting.get.mockResolvedValue(null);
    const result = await backupService.getRcloneConfigPathSetting();
    expect(result).toBeNull();
  });

  test('setRcloneConfigPathSetting with null clears the setting', async () => {
    const result = await backupService.setRcloneConfigPathSetting(null);
    expect(result.path).toBeNull();
    expect(Setting.set).toHaveBeenCalledWith('rclone_custom_config_path', null);
  });

  test('setRcloneConfigPathSetting rejects non-absolute paths', async () => {
    await expect(backupService.setRcloneConfigPathSetting('relative/path'))
      .rejects.toThrow(/absolute path/);
  });

  test('setRcloneConfigPathSetting rejects paths with traversal', async () => {
    await expect(backupService.setRcloneConfigPathSetting('/etc/../etc/passwd'))
      .rejects.toThrow(/Invalid config path/);
  });

  test('installRclone returns message if already installed', async () => {
    detectRclone.mockResolvedValue({ installed: true, version: '1.65.0' });
    const result = await backupService.installRclone();
    expect(result.message).toContain('already installed');
    expect(result.version).toBe('1.65.0');
  });

  test('testRemote validates remote name format', async () => {
    await expect(backupService.testRemote('invalid; rm -rf /'))
      .rejects.toThrow(/Invalid/);
  });

  test('testRemote succeeds with valid name', async () => {
    detectRclone.mockResolvedValue({ installed: true, bin: 'rclone' });
    // execAsync resolves with stdout string — mock exec callback with (err, stdout, stderr)
    const { exec } = await import('child_process');
    exec.mockImplementation((cmd, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      if (typeof cb === 'function') cb(null, 'dir1\n', '');
      return { kill: jest.fn() };
    });
    const result = await backupService.testRemote('myremote');
    expect(result.success).toBe(true);
  });

  test('listRemoteFiles validates remote name', async () => {
    await expect(backupService.listRemoteFiles('bad;name'))
      .rejects.toThrow(/Invalid/);
  });
});

// ═══════════════════════════════════════════════════════════
//  BACKUP JOBS CRUD
// ═══════════════════════════════════════════════════════════

describe('BackupService — Backup Jobs CRUD', () => {
  test('getBackupJobs returns empty array when no jobs exist', async () => {
    Setting.get.mockResolvedValue(null);
    const result = await backupService.getBackupJobs();
    expect(result.jobs).toEqual([]);
  });

  test('createBackupJob creates a new job with valid data', async () => {
    Setting.get.mockResolvedValue('[]');
    Setting.set.mockResolvedValue(true);

    const result = await backupService.createBackupJob({
      name: 'daily-backup',
      source: 'var/www',
      remote: 'myremote',
      destPath: 'backups',
      schedule: '0 2 * * *',
      type: 'sync',
      includePatterns: [],
      excludePatterns: [],
    });

    expect(result.message).toContain('created');
    expect(result.job.name).toBe('daily-backup');
    expect(result.job.remote).toBe('myremote');
    expect(result.job.id).toBeTruthy();
    expect(Setting.set).toHaveBeenCalled();
  });

  test('createBackupJob rejects missing required fields', async () => {
    await expect(backupService.createBackupJob({ name: 'test', source: 'var/www' }))
      .rejects.toThrow(/required/);
    await expect(backupService.createBackupJob({ source: 'var/www', remote: 'rclone' }))
      .rejects.toThrow(/required/);
    await expect(backupService.createBackupJob({ remote: 'rclone', name: 'test' }))
      .rejects.toThrow(/required/);
  });

  test('createBackupJob rejects invalid remote name', async () => {
    Setting.get.mockResolvedValue('[]');
    await expect(backupService.createBackupJob({
      name: 'test',
      source: 'var/www',
      remote: 'bad; rm -rf /',
      includePatterns: [],
      excludePatterns: [],
    })).rejects.toThrow(/Invalid remote name/);
  });

  test('createBackupJob rejects invalid dest path', async () => {
    Setting.get.mockResolvedValue('[]');
    await expect(backupService.createBackupJob({
      name: 'test',
      source: 'var/www',
      remote: 'myremote',
      destPath: 'escape;;injection',
      includePatterns: [],
      excludePatterns: [],
    })).rejects.toThrow(/Invalid destination path/);
  });

  test('createBackupJob rejects invalid include pattern', async () => {
    Setting.get.mockResolvedValue('[]');
    await expect(backupService.createBackupJob({
      name: 'test',
      source: 'var/www',
      remote: 'myremote',
      includePatterns: ['bad;pattern'],
      excludePatterns: [],
    })).rejects.toThrow(/Invalid include pattern/);
  });

  test('updateBackupJob updates existing job', async () => {
    const jobs = [{ id: 'j1', name: 'old', source: '/var/www', remote: 'r1', destPath: 'backups', includePatterns: [], excludePatterns: [] }];
    Setting.get.mockResolvedValue(JSON.stringify(jobs));
    Setting.set.mockResolvedValue(true);

    const result = await backupService.updateBackupJob('j1', { name: 'new-name' });
    expect(result.job.name).toBe('new-name');
  });

  test('updateBackupJob throws 404 for non-existent job', async () => {
    Setting.get.mockResolvedValue('[]');
    await expect(backupService.updateBackupJob('nonexistent', { name: 'x' }))
      .rejects.toThrow(/not found/);
  });

  test('deleteBackupJob removes job', async () => {
    const jobs = [{ id: 'j1', name: 'test' }];
    Setting.get.mockResolvedValue(JSON.stringify(jobs));
    Setting.set.mockResolvedValue(true);

    const result = await backupService.deleteBackupJob('j1');
    expect(result.message).toContain('deleted');
  });

  test('deleteBackupJob throws 404 for non-existent job', async () => {
    Setting.get.mockResolvedValue('[]');
    await expect(backupService.deleteBackupJob('nonexistent'))
      .rejects.toThrow(/not found/);
  });
});

// ═══════════════════════════════════════════════════════════
//  LOCAL BACKUPS
// ═══════════════════════════════════════════════════════════

describe('BackupService — Local Backups', () => {
  test('getBackups returns sorted list of backup files', async () => {
    fsMock.readdir.mockResolvedValue(['backup1.tar.gz', 'backup2.tar.gz']);
    fsMock.stat.mockResolvedValue({ size: 2048, mtime: new Date('2026-01-01') });

    const result = await backupService.getBackups();
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('backup1.tar.gz');
  });

  test('getBackups returns empty array on error', async () => {
    fsMock.readdir.mockRejectedValue(new Error('ENOENT'));
    const result = await backupService.getBackups();
    expect(result).toEqual([]);
  });

  test('deleteBackup validates filename (no path traversal)', async () => {
    await expect(backupService.deleteBackup('../etc/passwd'))
      .rejects.toThrow(/Invalid filename/);
    await expect(backupService.deleteBackup('file/../../etc'))
      .rejects.toThrow(/Invalid filename/);
  });

  test('deleteBackup deletes valid file', async () => {
    fsMock.unlink.mockResolvedValue();
    const result = await backupService.deleteBackup('backup.tar.gz');
    expect(result).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
//  S3 CONFIGURATION
// ═══════════════════════════════════════════════════════════

describe('BackupService — S3 Configuration', () => {
  test('getS3Config returns parsed config', async () => {
    Setting.get.mockResolvedValue(JSON.stringify({ enabled: true, bucket: 'my-bucket' }));
    const result = await backupService.getS3Config();
    expect(result.enabled).toBe(true);
    expect(result.bucket).toBe('my-bucket');
  });

  test('getS3Config returns empty object when not set', async () => {
    Setting.get.mockResolvedValue(null);
    const result = await backupService.getS3Config();
    expect(result).toEqual({});
  });

  test('updateS3Config validates bucket name format', async () => {
    await expect(backupService.updateS3Config({ bucket: 'INVALID_BUCKET' }))
      .rejects.toThrow(/Invalid S3 bucket name/);
    await expect(backupService.updateS3Config({ bucket: 'a' }))
      .rejects.toThrow(/Invalid S3 bucket name/);
  });

  test('updateS3Config saves valid config', async () => {
    const result = await backupService.updateS3Config({
      enabled: true,
      bucket: 'my-bucket',
      region: 'us-east-1',
      accessKey: 'AKIA...',
      secretKey: 'secret',
    });
    expect(result.message).toContain('saved');
    expect(Setting.set).toHaveBeenCalled();
  });

  test('testS3Connection rejects when not fully configured', async () => {
    Setting.get.mockResolvedValue(JSON.stringify({ enabled: false }));
    await expect(backupService.testS3Connection()).rejects.toThrow(/not fully configured/);
  });

  test('listS3Backups rejects when S3 not configured', async () => {
    Setting.get.mockResolvedValue(JSON.stringify({ enabled: false }));
    await expect(backupService.listS3Backups()).rejects.toThrow(/not configured/);
  });
});

// ═══════════════════════════════════════════════════════════
//  QUEUE INTEGRATION
// ═══════════════════════════════════════════════════════════

describe('BackupService — Queue Integration', () => {
  test('queueBackupJob enqueues a job', async () => {
    const result = await backupService.queueBackupJob('job-123');
    expect(result).toBeDefined();
    expect(result.id).toBe('job-1');
  });

  test('queueCreateBackup enqueues a job', async () => {
    const result = await backupService.queueCreateBackup('mysql', 'mydb');
    expect(result).toBeDefined();
  });

  test('queueRestoreBackup enqueues a job', async () => {
    const result = await backupService.queueRestoreBackup('backup.sql', '/var/www');
    expect(result).toBeDefined();
  });

  test('getQueueJobStatus returns job status', async () => {
    const result = await backupService.getQueueJobStatus('job-1');
    expect(result).toBeNull(); // mocked returns null
  });

  test('getQueueMetrics returns metrics', async () => {
    const result = await backupService.getQueueMetrics();
    expect(result).toHaveProperty('waiting');
    expect(result).toHaveProperty('active');
  });
});
