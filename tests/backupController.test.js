/**
 * Unit tests for BackupController:
 * - src/modules/backup/backup.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockBackupService = {
  getRcloneStatus: jest.fn(),
  installRclone: jest.fn(),
  testRemote: jest.fn(),
  listRemoteFiles: jest.fn(),
  getBackupJobs: jest.fn(),
  createBackupJob: jest.fn(),
  updateBackupJob: jest.fn(),
  deleteBackupJob: jest.fn(),
  runBackupJob: jest.fn(),
  queueBackupJob: jest.fn(),
  getBackups: jest.fn(),
  createBackup: jest.fn(),
  queueCreateBackup: jest.fn(),
  deleteBackup: jest.fn(),
  restoreBackup: jest.fn(),
  queueRestoreBackup: jest.fn(),
  getQueueJobStatus: jest.fn(),
  getQueueMetrics: jest.fn(),
  getS3Config: jest.fn(),
  updateS3Config: jest.fn(),
  testS3Connection: jest.fn(),
  listS3Backups: jest.fn(),
  downloadFromS3: jest.fn(),
  getRcloneConfigPathSetting: jest.fn(),
  setRcloneConfigPathSetting: jest.fn(),
  testRcloneConfigPath: jest.fn(),
  listRemoteBackups: jest.fn(),
  restoreFromRemote: jest.fn(),
};

const mockSnapshotService = {
  listSnapshots: jest.fn(),
  createSnapshot: jest.fn(),
  rollbackSnapshot: jest.fn(),
  verifySnapshot: jest.fn(),
  deleteSnapshot: jest.fn(),
};

jest.unstable_mockModule('../src/modules/backup/backup.service.js', () => ({
  default: mockBackupService,
}));

jest.unstable_mockModule('../src/modules/backup/snapshot.service.js', () => ({
  default: mockSnapshotService,
}));

const { default: backupController } = await import('../src/modules/backup/backup.controller.js');

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

describe('BackupController — Rclone Management', () => {
  test('getRcloneStatus returns status', async () => {
    mockBackupService.getRcloneStatus.mockResolvedValue({ installed: true });
    const req = {};
    const res = createMockRes();

    await backupController.getRcloneStatus(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.status.installed).toBe(true);
  });

  test('getRcloneStatus handles error', async () => {
    mockBackupService.getRcloneStatus.mockRejectedValue(new Error('Rclone check failed'));
    const req = {};
    const res = createMockRes();

    await backupController.getRcloneStatus(req, res);
    expect(res.statusCode).toBe(500);
  });

  test('installRclone initiates install', async () => {
    mockBackupService.installRclone.mockResolvedValue({ success: true, message: 'Installed' });
    const req = {};
    const res = createMockRes();

    await backupController.installRclone(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('Installed');
  });

  test('installRclone handles error', async () => {
    mockBackupService.installRclone.mockRejectedValue(new Error('Install error'));
    const req = {};
    const res = createMockRes();

    await backupController.installRclone(req, res);
    expect(res.statusCode).toBe(500);
  });

  test('testRemote tests remote connection', async () => {
    mockBackupService.testRemote.mockResolvedValue({ connected: true });
    const req = { body: { name: 'gdrive' } };
    const res = createMockRes();

    await backupController.testRemote(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('Connection successful');
  });

  test('testRemote rejects missing name', async () => {
    const req = { body: {} };
    const res = createMockRes();

    await backupController.testRemote(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('testRemote handles error', async () => {
    mockBackupService.testRemote.mockRejectedValue(new Error('Auth failed'));
    const req = { body: { name: 'gdrive' } };
    const res = createMockRes();

    await backupController.testRemote(req, res);
    expect(res.statusCode).toBe(500);
  });

  test('listRemoteFiles lists files', async () => {
    mockBackupService.listRemoteFiles.mockResolvedValue([{ name: 'file.tar.gz' }]);
    const req = { query: { remote: 'gdrive', path: '/backups' } };
    const res = createMockRes();

    await backupController.listRemoteFiles(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  test('listRemoteFiles validates remote parameter', async () => {
    const req = { query: {} };
    const res = createMockRes();

    await backupController.listRemoteFiles(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('listRemoteFiles handles error', async () => {
    mockBackupService.listRemoteFiles.mockRejectedValue(new Error('Path not found'));
    const req = { query: { remote: 'gdrive' } };
    const res = createMockRes();

    await backupController.listRemoteFiles(req, res);
    expect(res.statusCode).toBe(500);
  });
});

describe('BackupController — Backup Jobs', () => {
  test('getBackupJobs returns jobs list', async () => {
    mockBackupService.getBackupJobs.mockResolvedValue([{ id: 'job-1' }]);
    const req = {};
    const res = createMockRes();

    await backupController.getBackupJobs(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  test('getBackupJobs handles error', async () => {
    mockBackupService.getBackupJobs.mockRejectedValue(new Error('DB err'));
    const req = {};
    const res = createMockRes();

    await backupController.getBackupJobs(req, res);
    expect(res.statusCode).toBe(500);
  });

  test('createBackupJob creates new job', async () => {
    mockBackupService.createBackupJob.mockResolvedValue({ id: 'job-1', message: 'Job created' });
    const req = { body: { name: 'nightly' } };
    const res = createMockRes();

    await backupController.createBackupJob(req, res);
    expect(res.statusCode).toBe(201);
  });

  test('createBackupJob handles error', async () => {
    mockBackupService.createBackupJob.mockRejectedValue(new Error('Validation failed'));
    const req = { body: {} };
    const res = createMockRes();

    await backupController.createBackupJob(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('updateBackupJob modifies job', async () => {
    mockBackupService.updateBackupJob.mockResolvedValue({ id: 'job-1', message: 'Updated' });
    const req = { params: { id: 'job-1' }, body: { schedule: '0 0 * * *' } };
    const res = createMockRes();

    await backupController.updateBackupJob(req, res);
    expect(res.statusCode).toBe(200);
  });

  test('updateBackupJob handles error', async () => {
    mockBackupService.updateBackupJob.mockRejectedValue(new Error('Not found'));
    const req = { params: { id: 'job-1' }, body: {} };
    const res = createMockRes();

    await backupController.updateBackupJob(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('deleteBackupJob removes job', async () => {
    mockBackupService.deleteBackupJob.mockResolvedValue({ message: 'Deleted' });
    const req = { params: { id: 'job-1' } };
    const res = createMockRes();

    await backupController.deleteBackupJob(req, res);
    expect(res.statusCode).toBe(200);
  });

  test('deleteBackupJob handles error', async () => {
    mockBackupService.deleteBackupJob.mockRejectedValue(new Error('Delete err'));
    const req = { params: { id: 'job-1' } };
    const res = createMockRes();

    await backupController.deleteBackupJob(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('runBackupJob runs sync and async', async () => {
    mockBackupService.runBackupJob.mockResolvedValue({ success: true, message: 'Done' });
    mockBackupService.queueBackupJob.mockResolvedValue({ id: 'task-1' });

    // sync
    const res1 = createMockRes();
    await backupController.runBackupJob({ params: { id: 'job-1' }, query: {} }, res1);
    expect(res1.statusCode).toBe(200);

    // async
    const res2 = createMockRes();
    await backupController.runBackupJob({ params: { id: 'job-1' }, query: { async: 'true' } }, res2);
    expect(res2.statusCode).toBe(202);
  });

  test('runBackupJob handles error', async () => {
    mockBackupService.runBackupJob.mockRejectedValue(new Error('Run failed'));
    const res = createMockRes();

    await backupController.runBackupJob({ params: { id: 'job-1' }, query: {} }, res);
    expect(res.statusCode).toBe(500);
  });
});

describe('BackupController — Local Backups and Queue', () => {
  test('getBackups returns backup archives', async () => {
    mockBackupService.getBackups.mockResolvedValue([{ filename: 'backup.zip' }]);
    const req = {};
    const res = createMockRes();

    await backupController.getBackups(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  test('getBackups handles error', async () => {
    mockBackupService.getBackups.mockRejectedValue(new Error('IO error'));
    const req = {};
    const res = createMockRes();

    await backupController.getBackups(req, res);
    expect(res.statusCode).toBe(500);
  });

  test('createBackup validates required fields', async () => {
    const res = createMockRes();
    await backupController.createBackup({ body: {} }, res);
    expect(res.statusCode).toBe(400);
  });

  test('createBackup supports sync and async creation', async () => {
    mockBackupService.createBackup.mockResolvedValue({ filename: 'new.tar.gz' });
    mockBackupService.queueCreateBackup.mockResolvedValue({ id: 'queue-1' });

    const res1 = createMockRes();
    await backupController.createBackup({ body: { type: 'website', target: 'site1' }, query: {} }, res1);
    expect(res1.statusCode).toBe(200);

    const res2 = createMockRes();
    await backupController.createBackup({ body: { type: 'website', target: 'site1' }, query: { async: 'true' } }, res2);
    expect(res2.statusCode).toBe(202);
  });

  test('createBackup handles error', async () => {
    mockBackupService.createBackup.mockRejectedValue(new Error('Backup creation failed'));
    const res = createMockRes();

    await backupController.createBackup({ body: { type: 'website', target: 'site1' }, query: {} }, res);
    expect(res.statusCode).toBe(500);
  });

  test('deleteBackup deletes backup file', async () => {
    mockBackupService.deleteBackup.mockResolvedValue(true);
    const res1 = createMockRes();
    await backupController.deleteBackup({ body: { filename: 'file.tar.gz' } }, res1);
    expect(res1.statusCode).toBe(200);

    const res2 = createMockRes();
    await backupController.deleteBackup({ body: {} }, res2);
    expect(res2.statusCode).toBe(400);
  });

  test('deleteBackup handles error', async () => {
    mockBackupService.deleteBackup.mockRejectedValue(new Error('Delete error'));
    const res = createMockRes();
    await backupController.deleteBackup({ body: { filename: 'file.tar.gz' } }, res);
    expect(res.statusCode).toBe(500);
  });

  test('restoreBackup validates params and handles sync & async', async () => {
    mockBackupService.restoreBackup.mockResolvedValue({ message: 'Restored' });
    mockBackupService.queueRestoreBackup.mockResolvedValue({ id: 'task-restore' });

    // Missing fields
    const res1 = createMockRes();
    await backupController.restoreBackup({ body: {} }, res1);
    expect(res1.statusCode).toBe(400);

    // Sync
    const res2 = createMockRes();
    await backupController.restoreBackup({ body: { filename: 'f.tar.gz', target: '/var/www' }, query: {} }, res2);
    expect(res2.statusCode).toBe(200);

    // Async
    const res3 = createMockRes();
    await backupController.restoreBackup(
      { body: { filename: 'f.tar.gz', target: '/var/www' }, query: { async: 'true' } },
      res3
    );
    expect(res3.statusCode).toBe(202);
  });

  test('restoreBackup handles error', async () => {
    mockBackupService.restoreBackup.mockRejectedValue(new Error('Restore failed'));
    const res = createMockRes();
    await backupController.restoreBackup({ body: { filename: 'f.tar.gz', target: '/var/www' }, query: {} }, res);
    expect(res.statusCode).toBe(500);
  });

  test('getQueueJobStatus returns job status or 404', async () => {
    mockBackupService.getQueueJobStatus.mockResolvedValueOnce({ id: '1', status: 'completed' });
    mockBackupService.getQueueJobStatus.mockResolvedValueOnce(null);

    const res1 = createMockRes();
    await backupController.getQueueJobStatus({ params: { jobId: '1' } }, res1);
    expect(res1.statusCode).toBe(200);

    const res2 = createMockRes();
    await backupController.getQueueJobStatus({ params: { jobId: '2' } }, res2);
    expect(res2.statusCode).toBe(404);
  });

  test('getQueueJobStatus handles error', async () => {
    mockBackupService.getQueueJobStatus.mockRejectedValue(new Error('Queue err'));
    const res = createMockRes();
    await backupController.getQueueJobStatus({ params: { jobId: '1' } }, res);
    expect(res.statusCode).toBe(500);
  });

  test('getQueueMetrics returns metrics', async () => {
    mockBackupService.getQueueMetrics.mockResolvedValue({ waiting: 0, active: 1 });
    const res = createMockRes();
    await backupController.getQueueMetrics({}, res);
    expect(res.statusCode).toBe(200);
  });

  test('getQueueMetrics handles error', async () => {
    mockBackupService.getQueueMetrics.mockRejectedValue(new Error('Queue err'));
    const res = createMockRes();
    await backupController.getQueueMetrics({}, res);
    expect(res.statusCode).toBe(500);
  });
});

describe('BackupController — S3 & Rclone Config', () => {
  test('getS3Config, updateS3Config, and testS3Connection work correctly', async () => {
    mockBackupService.getS3Config.mockResolvedValue({ bucket: 'mybucket' });
    mockBackupService.updateS3Config.mockResolvedValue({ success: true, message: 'Saved' });
    mockBackupService.testS3Connection.mockResolvedValue({ success: true, message: 'Connected' });

    const res1 = createMockRes();
    await backupController.getS3Config({}, res1);
    expect(res1.statusCode).toBe(200);

    const res2 = createMockRes();
    await backupController.updateS3Config({ body: { bucket: 'newbucket' } }, res2);
    expect(res2.statusCode).toBe(200);

    const res3 = createMockRes();
    await backupController.testS3Connection({}, res3);
    expect(res3.statusCode).toBe(200);
  });

  test('getS3Config, updateS3Config, testS3Connection handle error', async () => {
    mockBackupService.getS3Config.mockRejectedValue(new Error('S3 error'));
    mockBackupService.updateS3Config.mockRejectedValue(new Error('S3 update error'));
    mockBackupService.testS3Connection.mockRejectedValue(new Error('S3 conn error'));

    const res1 = createMockRes();
    await backupController.getS3Config({}, res1);
    expect(res1.statusCode).toBe(500);

    const res2 = createMockRes();
    await backupController.updateS3Config({ body: {} }, res2);
    expect(res2.statusCode).toBe(400);

    const res3 = createMockRes();
    await backupController.testS3Connection({}, res3);
    expect(res3.statusCode).toBe(500);
  });

  test('listS3Backups and downloadFromS3 work correctly', async () => {
    mockBackupService.listS3Backups.mockResolvedValue([{ key: 'b1.tar.gz' }]);
    mockBackupService.downloadFromS3.mockResolvedValue({ message: 'Downloaded' });

    const res1 = createMockRes();
    await backupController.listS3Backups({ query: { prefix: 'backups/' } }, res1);
    expect(res1.statusCode).toBe(200);

    const res2 = createMockRes();
    await backupController.downloadFromS3({ body: { key: 'b1.tar.gz' } }, res2);
    expect(res2.statusCode).toBe(200);

    const res3 = createMockRes();
    await backupController.downloadFromS3({ body: {} }, res3);
    expect(res3.statusCode).toBe(400);
  });

  test('listS3Backups and downloadFromS3 handle errors', async () => {
    mockBackupService.listS3Backups.mockRejectedValue(new Error('List err'));
    mockBackupService.downloadFromS3.mockRejectedValue(new Error('Download err'));

    const res1 = createMockRes();
    await backupController.listS3Backups({ query: {} }, res1);
    expect(res1.statusCode).toBe(500);

    const res2 = createMockRes();
    await backupController.downloadFromS3({ body: { key: 'k' } }, res2);
    expect(res2.statusCode).toBe(500);
  });

  test('getRcloneConfigPath, setRcloneConfigPath, testRcloneConfigPath manage rclone path', async () => {
    mockBackupService.getRcloneConfigPathSetting.mockResolvedValue('/etc/rclone.conf');
    mockBackupService.setRcloneConfigPathSetting.mockResolvedValue({ path: '/etc/rclone.conf' });
    mockBackupService.testRcloneConfigPath.mockResolvedValue({ count: 3 });

    const res1 = createMockRes();
    await backupController.getRcloneConfigPath({}, res1);
    expect(res1.statusCode).toBe(200);

    const res2 = createMockRes();
    await backupController.setRcloneConfigPath({ body: { path: '/new/path' } }, res2);
    expect(res2.statusCode).toBe(200);

    const res3 = createMockRes();
    await backupController.testRcloneConfigPath({ body: { path: '/new/path' } }, res3);
    expect(res3.statusCode).toBe(200);

    const res4 = createMockRes();
    await backupController.testRcloneConfigPath({ body: {} }, res4);
    expect(res4.statusCode).toBe(400);
  });

  test('listRemoteBackups and restoreFromRemote manage remote archives', async () => {
    mockBackupService.listRemoteBackups.mockResolvedValue([{ name: 'archive.tar.gz' }]);
    mockBackupService.restoreFromRemote.mockResolvedValue({ message: 'Remote restored' });

    const res1 = createMockRes();
    await backupController.listRemoteBackups({ query: { remote: 'gdrive', path: 'backups' } }, res1);
    expect(res1.statusCode).toBe(200);

    const res2 = createMockRes();
    await backupController.listRemoteBackups({ query: {} }, res2);
    expect(res2.statusCode).toBe(400);

    const res3 = createMockRes();
    await backupController.restoreFromRemote(
      { body: { remote: 'gdrive', remotePath: 'backups/a.tar.gz', localTarget: '/var/www' } },
      res3
    );
    expect(res3.statusCode).toBe(200);

    const res4 = createMockRes();
    await backupController.restoreFromRemote({ body: {} }, res4);
    expect(res4.statusCode).toBe(400);
  });

  test('listRemoteBackups and restoreFromRemote handle errors', async () => {
    mockBackupService.listRemoteBackups.mockRejectedValue(new Error('Remote list err'));
    mockBackupService.restoreFromRemote.mockRejectedValue(new Error('Restore err'));

    const res1 = createMockRes();
    await backupController.listRemoteBackups({ query: { remote: 'gdrive' } }, res1);
    expect(res1.statusCode).toBe(500);

    const res2 = createMockRes();
    await backupController.restoreFromRemote(
      { body: { remote: 'gdrive', remotePath: 'p', localTarget: 't' } },
      res2
    );
    expect(res2.statusCode).toBe(500);
  });
});

describe('BackupController — Volume Snapshots', () => {
  test('listSnapshots returns snapshot collection', async () => {
    mockSnapshotService.listSnapshots.mockResolvedValue([{ id: 'snap-1' }]);
    const res = createMockRes();
    await backupController.listSnapshots({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.snapshots).toHaveLength(1);
  });

  test('listSnapshots handles error', async () => {
    mockSnapshotService.listSnapshots.mockRejectedValue(new Error('Snap list err'));
    const res = createMockRes();
    await backupController.listSnapshots({}, res);
    expect(res.statusCode).toBe(500);
  });

  test('createSnapshot validates and creates volume snapshot', async () => {
    mockSnapshotService.createSnapshot.mockResolvedValue({ id: 'snap-new', name: 'pre-deploy' });

    const res1 = createMockRes();
    await backupController.createSnapshot({ body: {} }, res1);
    expect(res1.statusCode).toBe(400);

    const res2 = createMockRes();
    await backupController.createSnapshot(
      { body: { name: 'pre-deploy', targetPath: '/var/www', description: 'desc' } },
      res2
    );
    expect(res2.statusCode).toBe(200);
  });

  test('createSnapshot handles error', async () => {
    mockSnapshotService.createSnapshot.mockRejectedValue(new Error('Btrfs error'));
    const res = createMockRes();
    await backupController.createSnapshot({ body: { name: 'snap1' } }, res);
    expect(res.statusCode).toBe(500);
  });

  test('rollbackSnapshot, verifySnapshot, deleteSnapshot manage snapshot lifecycle', async () => {
    mockSnapshotService.rollbackSnapshot.mockResolvedValue({ message: 'Rollback OK' });
    mockSnapshotService.verifySnapshot.mockResolvedValue({ message: 'Integrity OK' });
    mockSnapshotService.deleteSnapshot.mockResolvedValue(true);

    const res1 = createMockRes();
    await backupController.rollbackSnapshot({ params: { id: 'snap-1' } }, res1);
    expect(res1.statusCode).toBe(200);

    const res2 = createMockRes();
    await backupController.verifySnapshot({ params: { id: 'snap-1' } }, res2);
    expect(res2.statusCode).toBe(200);

    const res3 = createMockRes();
    await backupController.deleteSnapshot({ params: { id: 'snap-1' } }, res3);
    expect(res3.statusCode).toBe(200);
  });

  test('rollbackSnapshot, verifySnapshot, deleteSnapshot handle errors', async () => {
    mockSnapshotService.rollbackSnapshot.mockRejectedValue(new Error('Rollback err'));
    mockSnapshotService.verifySnapshot.mockRejectedValue(new Error('Verify err'));
    mockSnapshotService.deleteSnapshot.mockRejectedValue(new Error('Delete err'));

    const res1 = createMockRes();
    await backupController.rollbackSnapshot({ params: { id: 'snap-1' } }, res1);
    expect(res1.statusCode).toBe(500);

    const res2 = createMockRes();
    await backupController.verifySnapshot({ params: { id: 'snap-1' } }, res2);
    expect(res2.statusCode).toBe(500);

    const res3 = createMockRes();
    await backupController.deleteSnapshot({ params: { id: 'snap-1' } }, res3);
    expect(res3.statusCode).toBe(500);
  });
});
