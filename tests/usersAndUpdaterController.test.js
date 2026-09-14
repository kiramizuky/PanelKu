/**
 * Unit tests for UsersController & UpdaterController:
 * - src/modules/users/users.controller.js
 * - src/modules/updater/updater.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockUsersService = {
  list: jest.fn(),
  getById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  changePassword: jest.fn(),
  delete: jest.fn(),
  toggleStatus: jest.fn(),
  regenerateApiKey: jest.fn(),
  revokeApiKey: jest.fn(),
};

const mockUpdaterService = {
  getVersionInfo: jest.fn(),
  checkForUpdates: jest.fn(),
  getChangelog: jest.fn(),
  getDiffPreview: jest.fn(),
  performUpdate: jest.fn(),
  performRollback: jest.fn(),
  restartPanel: jest.fn(),
  runHealthCheck: jest.fn(),
  getUpdateHistory: jest.fn(),
  clearUpdateHistory: jest.fn(),
  listBackups: jest.fn(),
  createPreUpdateBackup: jest.fn(),
  getScheduleConfig: jest.fn(),
  setScheduleConfig: jest.fn(),
};

const mockAuditRepo = {
  log: jest.fn().mockResolvedValue(true),
};

jest.unstable_mockModule('../src/modules/users/users.service.js', () => ({
  default: mockUsersService,
}));

jest.unstable_mockModule('../src/modules/updater/updater.service.js', () => ({
  default: mockUpdaterService,
}));

jest.unstable_mockModule('../src/repositories/audit.repository.js', () => ({
  default: mockAuditRepo,
}));

const { default: usersController } = await import('../src/modules/users/users.controller.js');
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

describe('UsersController', () => {
  test('list returns paginated results on success', async () => {
    mockUsersService.list.mockResolvedValue({ data: [{ id: 'u1' }], total: 1, page: 1, limit: 10 });
    const req = { query: { page: '1', limit: '10', search: 'admin' } };
    const res = createMockRes();

    await usersController.list(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  test('list handles error and returns 500', async () => {
    mockUsersService.list.mockRejectedValue(new Error('DB failure'));
    const req = { query: {} };
    const res = createMockRes();

    await usersController.list(req, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
  });

  test('getById returns single user', async () => {
    mockUsersService.getById.mockResolvedValue({ id: 'u1', username: 'admin' });
    const req = { params: { id: 'u1' } };
    const res = createMockRes();

    await usersController.getById(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.user.id).toBe('u1');
  });

  test('getById handles error (404 / 500)', async () => {
    const err = new Error('User not found');
    err.statusCode = 404;
    mockUsersService.getById.mockRejectedValue(err);
    const req = { params: { id: 'missing' } };
    const res = createMockRes();

    await usersController.getById(req, res);
    expect(res.statusCode).toBe(404);
  });

  test('create creates a new user and returns 201', async () => {
    mockUsersService.create.mockResolvedValue({ id: 'u2', username: 'tester' });
    const req = { body: { username: 'tester', password: 'Password123!' } };
    const res = createMockRes();

    await usersController.create(req, res);
    expect(res.statusCode).toBe(201);
    expect(res.body.data.user.username).toBe('tester');
  });

  test('create handles validation error with 400', async () => {
    const err = new Error('Invalid email');
    err.statusCode = 400;
    mockUsersService.create.mockRejectedValue(err);
    const req = { body: {} };
    const res = createMockRes();

    await usersController.create(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('update modifies user', async () => {
    mockUsersService.update.mockResolvedValue({ id: 'u1', email: 'new@test.local' });
    const req = { params: { id: 'u1' }, body: { email: 'new@test.local' } };
    const res = createMockRes();

    await usersController.update(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.user.email).toBe('new@test.local');
  });

  test('update handles error', async () => {
    mockUsersService.update.mockRejectedValue(new Error('Update failed'));
    const req = { params: { id: 'u1' }, body: {} };
    const res = createMockRes();

    await usersController.update(req, res);
    expect(res.statusCode).toBe(500);
  });

  test('updateMyProfile updates logged-in user profile', async () => {
    mockUsersService.update.mockResolvedValue({ id: 'u_logged', username: 'myname' });
    const req = { user: { _id: 'u_logged' }, body: { username: 'myname', email: 'me@local.host' } };
    const res = createMockRes();

    await usersController.updateMyProfile(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.user.username).toBe('myname');
  });

  test('updateMyProfile handles error', async () => {
    mockUsersService.update.mockRejectedValue(new Error('Profile update error'));
    const req = { user: { id: 'u_logged' }, body: {} };
    const res = createMockRes();

    await usersController.updateMyProfile(req, res);
    expect(res.statusCode).toBe(500);
  });

  test('changePassword verifies password and records audit log', async () => {
    mockUsersService.changePassword.mockResolvedValue(true);
    const req = {
      user: { id: 'u1', username: 'admin' },
      body: { currentPassword: 'OldPassword123!', newPassword: 'NewPassword123!' },
      ip: '127.0.0.1',
      headers: { 'user-agent': 'Jest' },
    };
    const res = createMockRes();

    await usersController.changePassword(req, res);
    expect(res.statusCode).toBe(200);
    expect(mockUsersService.changePassword).toHaveBeenCalledWith('u1', 'OldPassword123!', 'NewPassword123!');
    expect(mockAuditRepo.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'PASSWORD_CHANGED' }));
  });

  test('changePassword handles error', async () => {
    const err = new Error('Wrong password');
    err.statusCode = 400;
    mockUsersService.changePassword.mockRejectedValue(err);
    const req = { user: { _id: 'u1' }, body: {} };
    const res = createMockRes();

    await usersController.changePassword(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('delete removes user', async () => {
    mockUsersService.delete.mockResolvedValue(true);
    const req = { params: { id: 'u2' }, user: { _id: 'u1' } };
    const res = createMockRes();

    await usersController.delete(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('User deleted successfully');
  });

  test('delete handles error', async () => {
    mockUsersService.delete.mockRejectedValue(new Error('Cannot delete self'));
    const req = { params: { id: 'u1' }, user: { id: 'u1' } };
    const res = createMockRes();

    await usersController.delete(req, res);
    expect(res.statusCode).toBe(500);
  });

  test('toggleStatus toggles active state', async () => {
    mockUsersService.toggleStatus.mockResolvedValue({ id: 'u2', isActive: false });
    const req = { params: { id: 'u2' } };
    const res = createMockRes();

    await usersController.toggleStatus(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.user.isActive).toBe(false);
  });

  test('toggleStatus handles error', async () => {
    mockUsersService.toggleStatus.mockRejectedValue(new Error('Superadmin immutable'));
    const req = { params: { id: 'u1' } };
    const res = createMockRes();

    await usersController.toggleStatus(req, res);
    expect(res.statusCode).toBe(500);
  });

  test('regenerateApiKey generates a key', async () => {
    mockUsersService.regenerateApiKey.mockResolvedValue('key-12345');
    const req = { user: { _id: 'u1' } };
    const res = createMockRes();

    await usersController.regenerateApiKey(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.apiKey).toBe('key-12345');
  });

  test('regenerateApiKey handles error', async () => {
    mockUsersService.regenerateApiKey.mockRejectedValue(new Error('Key gen failed'));
    const req = { user: { _id: 'u1' } };
    const res = createMockRes();

    await usersController.regenerateApiKey(req, res);
    expect(res.statusCode).toBe(500);
  });

  test('revokeApiKey revokes the key', async () => {
    mockUsersService.revokeApiKey.mockResolvedValue(true);
    const req = { user: { _id: 'u1' } };
    const res = createMockRes();

    await usersController.revokeApiKey(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('API key revoked');
  });

  test('revokeApiKey handles error', async () => {
    mockUsersService.revokeApiKey.mockRejectedValue(new Error('Revoke failed'));
    const req = { user: { _id: 'u1' } };
    const res = createMockRes();

    await usersController.revokeApiKey(req, res);
    expect(res.statusCode).toBe(500);
  });

  test('getAiSettings returns ai settings', async () => {
    mockUsersService.getById.mockResolvedValue({ id: 'u1', aiSettings: { provider: 'openai', model: 'gpt-4' } });
    const req = { user: { _id: 'u1' } };
    const res = createMockRes();

    await usersController.getAiSettings(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.aiSettings.provider).toBe('openai');
  });

  test('getAiSettings handles error', async () => {
    mockUsersService.getById.mockRejectedValue(new Error('Not found'));
    const req = { user: { _id: 'u1' } };
    const res = createMockRes();

    await usersController.getAiSettings(req, res);
    expect(res.statusCode).toBe(500);
  });

  test('updateAiSettings updates ai configuration', async () => {
    mockUsersService.update.mockResolvedValue({
      id: 'u1',
      aiSettings: { provider: 'gemini', apiKey: 'abc', model: 'gemini-1.5' },
    });
    const req = {
      user: { _id: 'u1' },
      body: { provider: 'gemini', apiKey: 'abc', model: 'gemini-1.5' },
    };
    const res = createMockRes();

    await usersController.updateAiSettings(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.aiSettings.provider).toBe('gemini');
  });

  test('updateAiSettings handles error', async () => {
    mockUsersService.update.mockRejectedValue(new Error('AI config failed'));
    const req = { user: { _id: 'u1' }, body: {} };
    const res = createMockRes();

    await usersController.updateAiSettings(req, res);
    expect(res.statusCode).toBe(500);
  });
});

describe('UpdaterController', () => {
  test('getVersionInfo returns version data', async () => {
    mockUpdaterService.getVersionInfo.mockResolvedValue({ current: '3.5.0', branch: 'main' });
    const req = {};
    const res = createMockRes();

    await updaterController.getVersionInfo(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.current).toBe('3.5.0');
  });

  test('getVersionInfo handles error', async () => {
    mockUpdaterService.getVersionInfo.mockRejectedValue(new Error('Git error'));
    const req = {};
    const res = createMockRes();

    await updaterController.getVersionInfo(req, res);
    expect(res.statusCode).toBe(500);
  });

  test('checkForUpdates checks remote status', async () => {
    mockUpdaterService.checkForUpdates.mockResolvedValue({ hasUpdate: false });
    const req = {};
    const res = createMockRes();

    await updaterController.checkForUpdates(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.hasUpdate).toBe(false);
  });

  test('checkForUpdates handles error', async () => {
    mockUpdaterService.checkForUpdates.mockRejectedValue(new Error('Network error'));
    const req = {};
    const res = createMockRes();

    await updaterController.checkForUpdates(req, res);
    expect(res.statusCode).toBe(500);
  });

  test('getChangelog returns log entries', async () => {
    mockUpdaterService.getChangelog.mockResolvedValue([{ hash: 'abc', message: 'feat: add' }]);
    const req = { query: { limit: '20' } };
    const res = createMockRes();

    await updaterController.getChangelog(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.entries).toHaveLength(1);
    expect(mockUpdaterService.getChangelog).toHaveBeenCalledWith(20);
  });

  test('getChangelog handles error', async () => {
    mockUpdaterService.getChangelog.mockRejectedValue(new Error('Log error'));
    const req = { query: {} };
    const res = createMockRes();

    await updaterController.getChangelog(req, res);
    expect(res.statusCode).toBe(500);
  });

  test('getDiffPreview returns diff content', async () => {
    mockUpdaterService.getDiffPreview.mockResolvedValue({ diff: '+ new line' });
    const req = {};
    const res = createMockRes();

    await updaterController.getDiffPreview(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.diff).toBe('+ new line');
  });

  test('getDiffPreview handles error', async () => {
    mockUpdaterService.getDiffPreview.mockRejectedValue(new Error('Diff failed'));
    const req = {};
    const res = createMockRes();

    await updaterController.getDiffPreview(req, res);
    expect(res.statusCode).toBe(500);
  });

  test('performUpdate triggers update process', async () => {
    mockUpdaterService.performUpdate.mockResolvedValue({ success: true });
    const req = { body: { method: 'git', branch: 'main' } };
    const res = createMockRes();

    await updaterController.performUpdate(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('Update completed successfully');
  });

  test('performUpdate handles error', async () => {
    mockUpdaterService.performUpdate.mockRejectedValue(new Error('Update failed'));
    const req = { body: {} };
    const res = createMockRes();

    await updaterController.performUpdate(req, res);
    expect(res.statusCode).toBe(500);
  });

  test('dryRunUpdate triggers dry run', async () => {
    mockUpdaterService.performUpdate.mockResolvedValue({ success: true, dryRun: true });
    const req = { body: { method: 'git' } };
    const res = createMockRes();

    await updaterController.dryRunUpdate(req, res);
    expect(res.statusCode).toBe(200);
    expect(mockUpdaterService.performUpdate).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  test('dryRunUpdate handles error', async () => {
    mockUpdaterService.performUpdate.mockRejectedValue(new Error('Dry run failed'));
    const req = { body: {} };
    const res = createMockRes();

    await updaterController.dryRunUpdate(req, res);
    expect(res.statusCode).toBe(500);
  });

  test('performRollback requires commit or restoreBackup', async () => {
    const req = { body: {} };
    const res = createMockRes();

    await updaterController.performRollback(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('performRollback executes rollback when valid', async () => {
    mockUpdaterService.performRollback.mockResolvedValue({ success: true });
    const req = { body: { commit: 'abcdef1' } };
    const res = createMockRes();

    await updaterController.performRollback(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('Rollback completed');
  });

  test('performRollback handles error', async () => {
    mockUpdaterService.performRollback.mockRejectedValue(new Error('Rollback failed'));
    const req = { body: { commit: 'abcdef1' } };
    const res = createMockRes();

    await updaterController.performRollback(req, res);
    expect(res.statusCode).toBe(500);
  });

  test('restartPanel initiates restart', async () => {
    mockUpdaterService.restartPanel.mockResolvedValue(true);
    const req = {};
    const res = createMockRes();

    await updaterController.restartPanel(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('Panel is restarting...');
  });

  test('restartPanel handles error', async () => {
    mockUpdaterService.restartPanel.mockRejectedValue(new Error('Restart failed'));
    const req = {};
    const res = createMockRes();

    await updaterController.restartPanel(req, res);
    expect(res.statusCode).toBe(500);
  });

  test('runHealthCheck checks panel health', async () => {
    mockUpdaterService.runHealthCheck.mockResolvedValue({ status: 'healthy' });
    const req = {};
    const res = createMockRes();

    await updaterController.runHealthCheck(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe('healthy');
  });

  test('runHealthCheck handles error', async () => {
    mockUpdaterService.runHealthCheck.mockRejectedValue(new Error('Health check failed'));
    const req = {};
    const res = createMockRes();

    await updaterController.runHealthCheck(req, res);
    expect(res.statusCode).toBe(500);
  });

  test('getUpdateHistory and clearUpdateHistory manage history log', async () => {
    mockUpdaterService.getUpdateHistory.mockResolvedValue([{ id: 1, action: 'update' }]);
    mockUpdaterService.clearUpdateHistory.mockResolvedValue(true);

    const req = {};
    const res1 = createMockRes();
    await updaterController.getUpdateHistory(req, res1);
    expect(res1.statusCode).toBe(200);
    expect(res1.body.data).toHaveLength(1);

    const res2 = createMockRes();
    await updaterController.clearUpdateHistory(req, res2);
    expect(res2.statusCode).toBe(200);
    expect(res2.body.message).toBe('Update history cleared');
  });

  test('getUpdateHistory & clearUpdateHistory handle errors', async () => {
    mockUpdaterService.getUpdateHistory.mockRejectedValue(new Error('History error'));
    mockUpdaterService.clearUpdateHistory.mockRejectedValue(new Error('Clear error'));

    const req = {};
    const res1 = createMockRes();
    await updaterController.getUpdateHistory(req, res1);
    expect(res1.statusCode).toBe(500);

    const res2 = createMockRes();
    await updaterController.clearUpdateHistory(req, res2);
    expect(res2.statusCode).toBe(500);
  });

  test('listBackups and createBackup manage backups', async () => {
    mockUpdaterService.listBackups.mockResolvedValue(['backup-1.tar.gz']);
    mockUpdaterService.createPreUpdateBackup.mockResolvedValue({ filename: 'backup-2.tar.gz' });

    const req = {};
    const res1 = createMockRes();
    await updaterController.listBackups(req, res1);
    expect(res1.statusCode).toBe(200);
    expect(res1.body.data).toHaveLength(1);

    const res2 = createMockRes();
    await updaterController.createBackup(req, res2);
    expect(res2.statusCode).toBe(200);
    expect(res2.body.message).toBe('Backup created successfully');
  });

  test('listBackups and createBackup handle errors', async () => {
    mockUpdaterService.listBackups.mockRejectedValue(new Error('List backup error'));
    mockUpdaterService.createPreUpdateBackup.mockRejectedValue(new Error('Create backup error'));

    const req = {};
    const res1 = createMockRes();
    await updaterController.listBackups(req, res1);
    expect(res1.statusCode).toBe(500);

    const res2 = createMockRes();
    await updaterController.createBackup(req, res2);
    expect(res2.statusCode).toBe(500);
  });

  test('getScheduleConfig and setScheduleConfig manage auto update schedules', async () => {
    mockUpdaterService.getScheduleConfig.mockResolvedValue({ enabled: true, cron: '0 4 * * *' });
    mockUpdaterService.setScheduleConfig.mockResolvedValue({ enabled: false });

    const req1 = {};
    const res1 = createMockRes();
    await updaterController.getScheduleConfig(req1, res1);
    expect(res1.statusCode).toBe(200);
    expect(res1.body.data.enabled).toBe(true);

    const req2 = { body: { enabled: false } };
    const res2 = createMockRes();
    await updaterController.setScheduleConfig(req2, res2);
    expect(res2.statusCode).toBe(200);
    expect(res2.body.data.enabled).toBe(false);
  });

  test('getScheduleConfig and setScheduleConfig handle errors', async () => {
    mockUpdaterService.getScheduleConfig.mockRejectedValue(new Error('Schedule get error'));
    mockUpdaterService.setScheduleConfig.mockRejectedValue(new Error('Schedule set error'));

    const req1 = {};
    const res1 = createMockRes();
    await updaterController.getScheduleConfig(req1, res1);
    expect(res1.statusCode).toBe(500);

    const req2 = { body: {} };
    const res2 = createMockRes();
    await updaterController.setScheduleConfig(req2, res2);
    expect(res2.statusCode).toBe(500);
  });
});
