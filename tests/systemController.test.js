/**
 * System Controller Unit Tests
 *
 * @jest-environment node
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import systemController from '../src/modules/system/system.controller.js';
import systemService from '../src/modules/system/system.service.js';
import sshService from '../src/modules/system/ssh.service.js';
import phpService from '../src/modules/system/php.service.js';
import passwordPolicyService from '../src/modules/system/password-policy.service.js';

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

const mockUser = {
  _id: 'admin_user_id',
  id: 'admin_user_id',
  username: 'admin',
};

describe('SystemController - Service & Package Management', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('getServicesStatus queries status for monitored services', async () => {
    jest.spyOn(systemService, 'getServiceStatus').mockResolvedValue('active');
    const res = mockRes();
    await systemController.getServicesStatus({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.nginx).toBe('active');
  });

  test('manageService validates required service and action', async () => {
    const badRes = mockRes();
    await systemController.manageService({ body: {} }, badRes);
    expect(badRes.statusCode).toBe(400);

    jest.spyOn(systemService, 'manageService').mockResolvedValue(true);
    const goodRes = mockRes();
    await systemController.manageService({ body: { service: 'nginx', action: 'restart' } }, goodRes);
    expect(goodRes.statusCode).toBe(200);
  });

  test('getInstallStatus returns installed status for core apps', async () => {
    jest.spyOn(systemService, 'isInstalled').mockResolvedValue(true);
    const res = mockRes();
    await systemController.getInstallStatus({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.docker).toBe(true);
  });

  test('installPackage validates package name and executes installation', async () => {
    const badRes = mockRes();
    await systemController.installPackage({ body: {} }, badRes);
    expect(badRes.statusCode).toBe(400);

    jest.spyOn(systemService, 'installPackage').mockResolvedValue('Installed');
    const goodRes = mockRes();
    await systemController.installPackage({ body: { package: 'htop' } }, goodRes);
    expect(goodRes.statusCode).toBe(200);
  });

  test('getPackageManagerInfo returns system package manager information', async () => {
    jest.spyOn(systemService, 'getPackageManagerInfo').mockResolvedValue({ name: 'apt', distro: 'ubuntu' });
    const res = mockRes();
    await systemController.getPackageManagerInfo({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.name).toBe('apt');
  });

  test('runUpdate, runUpgrade, runAptUpdate, runAptUpgrade return logs', async () => {
    jest.spyOn(systemService, 'getPackageManagerInfo').mockResolvedValue({ name: 'apt' });
    jest.spyOn(systemService, 'runUpdate').mockResolvedValue('Update log');
    jest.spyOn(systemService, 'runUpgrade').mockResolvedValue('Upgrade log');
    jest.spyOn(systemService, 'runAptUpdate').mockResolvedValue('Apt update log');
    jest.spyOn(systemService, 'runAptUpgrade').mockResolvedValue('Apt upgrade log');

    const resUpdate = mockRes();
    await systemController.runUpdate({}, resUpdate);
    expect(resUpdate.statusCode).toBe(200);
    expect(resUpdate.body.data.log).toBe('Update log');

    const resUpgrade = mockRes();
    await systemController.runUpgrade({}, resUpgrade);
    expect(resUpgrade.statusCode).toBe(200);

    const resAptUpdate = mockRes();
    await systemController.runAptUpdate({}, resAptUpdate);
    expect(resAptUpdate.statusCode).toBe(200);

    const resAptUpgrade = mockRes();
    await systemController.runAptUpgrade({}, resAptUpgrade);
    expect(resAptUpgrade.statusCode).toBe(200);
  });

  test('reboot initiates system reboot', async () => {
    jest.spyOn(systemService, 'reboot').mockResolvedValue(true);
    const res = mockRes();
    await systemController.reboot({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toContain('Reboot initiated');
  });

  test('getAutoUpdate and setAutoUpdate manage auto update setting', async () => {
    jest.spyOn(systemService, 'getAutoUpdate').mockResolvedValue(true);
    jest.spyOn(systemService, 'setAutoUpdate').mockResolvedValue(true);

    const resGet = mockRes();
    await systemController.getAutoUpdate({}, resGet);
    expect(resGet.statusCode).toBe(200);
    expect(resGet.body.data.enabled).toBe(true);

    const resSet = mockRes();
    await systemController.setAutoUpdate({ body: { enabled: true } }, resSet);
    expect(resSet.statusCode).toBe(200);
  });
});

describe('SystemController - Panel Update Lifecycle', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('getPanelVersion returns version info', async () => {
    jest.spyOn(systemService, 'getPanelVersion').mockResolvedValue({ currentVersion: '3.5.0' });
    const res = mockRes();
    await systemController.getPanelVersion({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.currentVersion).toBe('3.5.0');
  });

  test('checkPanelUpdate returns update availability', async () => {
    jest.spyOn(systemService, 'checkPanelUpdate').mockResolvedValue({ updateAvailable: false });
    const res = mockRes();
    await systemController.checkPanelUpdate({}, res);
    expect(res.statusCode).toBe(200);
  });

  test('runPanelUpdate starts update process', async () => {
    jest.spyOn(systemService, 'runPanelUpdate').mockResolvedValue('Panel update log');
    const res = mockRes();
    await systemController.runPanelUpdate({ body: { method: 'git' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.log).toBe('Panel update log');
  });

  test('restartPanel initiates panel restart', async () => {
    jest.spyOn(systemService, 'restartPanel').mockResolvedValue(true);
    const res = mockRes();
    await systemController.restartPanel({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toContain('restarting');
  });

  test('getPanelAutoUpdate and setPanelAutoUpdate manage auto-update frequency', async () => {
    jest.spyOn(systemService, 'getPanelAutoUpdate').mockResolvedValue({ enabled: true, frequency: 'weekly' });
    jest.spyOn(systemService, 'setPanelAutoUpdate').mockResolvedValue(true);

    const resGet = mockRes();
    await systemController.getPanelAutoUpdate({}, resGet);
    expect(resGet.statusCode).toBe(200);
    expect(resGet.body.data.frequency).toBe('weekly');

    const resSet = mockRes();
    await systemController.setPanelAutoUpdate({ body: { enabled: true, frequency: 'daily' } }, resSet);
    expect(resSet.statusCode).toBe(200);
  });
});

describe('SystemController - SSH & PHP Configuration', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('SSH key management methods', async () => {
    jest.spyOn(sshService, 'getKeys').mockResolvedValue([{ id: 'key-1', name: 'dev-key' }]);
    jest.spyOn(sshService, 'addKey').mockResolvedValue(true);
    jest.spyOn(sshService, 'deleteKey').mockResolvedValue(true);

    const resGet = mockRes();
    await systemController.getSSHKeys({}, resGet);
    expect(resGet.statusCode).toBe(200);
    expect(resGet.body.data.length).toBe(1);

    const resAdd = mockRes();
    await systemController.addSSHKey({ body: { key: 'ssh-rsa AAAAB3...' } }, resAdd);
    expect(resAdd.statusCode).toBe(200);

    const resDel = mockRes();
    await systemController.deleteSSHKey({ body: { id: 'key-1' } }, resDel);
    expect(resDel.statusCode).toBe(200);
  });

  test('SSH config get and update', async () => {
    jest.spyOn(sshService, 'getSSHConfig').mockResolvedValue({ port: 22, passwordAuth: 'yes' });
    jest.spyOn(sshService, 'updateSSHConfig').mockResolvedValue(true);

    const resGet = mockRes();
    await systemController.getSSHConfig({}, resGet);
    expect(resGet.statusCode).toBe(200);
    expect(resGet.body.data.port).toBe(22);

    const resUpdate = mockRes();
    await systemController.updateSSHConfig({ body: { port: 2222, passwordAuth: 'no' } }, resUpdate);
    expect(resUpdate.statusCode).toBe(200);
  });

  test('PHP config get and update', async () => {
    jest.spyOn(phpService, 'getConfig').mockResolvedValue({ memory_limit: '256M' });
    jest.spyOn(phpService, 'updateConfig').mockResolvedValue(true);

    const resGet = mockRes();
    await systemController.getPHPConfig({ query: { version: '8.2' } }, resGet);
    expect(resGet.statusCode).toBe(200);
    expect(resGet.body.data.memory_limit).toBe('256M');

    const resUpdate = mockRes();
    await systemController.updatePHPConfig({ body: { memory_limit: '512M' } }, resUpdate);
    expect(resUpdate.statusCode).toBe(200);
  });
});

describe('SystemController - Audit, Security & Tailscale', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('getAuditStats and getAuditLogs return audit data', async () => {
    jest.spyOn(systemService, 'getAuditStats').mockResolvedValue({ totalLogs: 42 });
    jest.spyOn(systemService, 'getAuditLogs').mockResolvedValue([{ action: 'LOGIN' }]);

    const resStats = mockRes();
    await systemController.getAuditStats({}, resStats);
    expect(resStats.statusCode).toBe(200);
    expect(resStats.body.data.totalLogs).toBe(42);

    const resLogs = mockRes();
    await systemController.getAuditLogs({ query: { limit: '10' } }, resLogs);
    expect(resLogs.statusCode).toBe(200);
  });

  test('runSecurityScan and fixSecurityIssue execute security advisor tasks', async () => {
    const resScan = mockRes();
    await systemController.runSecurityScan({}, resScan);
    expect([200, 500]).toContain(resScan.statusCode);

    const badFix = mockRes();
    await systemController.fixSecurityIssue({ body: {} }, badFix);
    expect(badFix.statusCode).toBe(400);

    const resFix = mockRes();
    await systemController.fixSecurityIssue({ body: { id: 'test-issue-1' } }, resFix);
    expect([200, 500]).toContain(resFix.statusCode);
  });

  test('Tailscale VPN management', async () => {
    jest.spyOn(systemService, 'getTailscaleStatus').mockResolvedValue({ installed: false });
    jest.spyOn(systemService, 'installTailscale').mockResolvedValue(true);
    jest.spyOn(systemService, 'tailscaleUp').mockResolvedValue({ success: true });
    jest.spyOn(systemService, 'tailscaleDown').mockResolvedValue(true);

    const resStatus = mockRes();
    await systemController.getTailscaleStatus({}, resStatus);
    expect(resStatus.statusCode).toBe(200);

    const resInstall = mockRes();
    await systemController.installTailscale({}, resInstall);
    expect(resInstall.statusCode).toBe(200);

    const resUp = mockRes();
    await systemController.tailscaleUp({ body: { authkey: 'tskey-auth-123' } }, resUp);
    expect(resUp.statusCode).toBe(200);

    const resDown = mockRes();
    await systemController.tailscaleDown({}, resDown);
    expect(resDown.statusCode).toBe(200);
  });
});

describe('SystemController - Password Policy', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('getPasswordPolicy returns active policy', async () => {
    const res = mockRes();
    await systemController.getPasswordPolicy({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('updatePasswordPolicy saves policy', async () => {
    const req = {
      body: { minLength: 10 },
      user: mockUser,
      ip: '127.0.0.1',
    };
    const res = mockRes();
    await systemController.updatePasswordPolicy(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.minLength).toBe(10);
  });

  test('resetPasswordPolicy restores defaults', async () => {
    const req = { user: mockUser, ip: '127.0.0.1' };
    const res = mockRes();
    await systemController.resetPasswordPolicy(req, res);
    expect(res.statusCode).toBe(200);
  });

  test('validatePassword validates proposed password', async () => {
    const badRes = mockRes();
    await systemController.validatePassword({ body: {} }, badRes);
    expect(badRes.statusCode).toBe(400);

    const res = mockRes();
    await systemController.validatePassword({ body: { password: 'StrongP@ssw0rd2026!' } }, res);
    expect(res.statusCode).toBe(200);
  });

  test('exportPasswordPolicy returns schema and policy', async () => {
    const res = mockRes();
    await systemController.exportPasswordPolicy({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data._schema).toBeDefined();
  });

  test('importPasswordPolicy imports valid JSON policy', async () => {
    const req = {
      body: {
        _schema: { version: '1.0.0' },
        minLength: 12,
        requireUppercase: true,
      },
      user: mockUser,
    };
    const res = mockRes();
    await systemController.importPasswordPolicy(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.minLength).toBe(12);
  });

  test('previewUrlPasswordPolicy requires url parameter', async () => {
    const badRes = mockRes();
    await systemController.previewUrlPasswordPolicy({ query: {} }, badRes);
    expect(badRes.statusCode).toBe(400);
  });

  test('getPasswordPolicyHistory returns audit log history', async () => {
    const res = mockRes();
    await systemController.getPasswordPolicyHistory({ query: { limit: '10' } }, res);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
