/**
 * Unit tests for System Module:
 * - src/modules/system/package-manager.js
 * - src/modules/system/system.service.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockDb = {
  prepare: jest.fn(),
};

jest.unstable_mockModule('../src/core/db/sqlite.js', () => ({
  getDb: () => mockDb,
  now: () => '2026-09-14 12:00:00',
}));

const { default: packageManager } = await import('../src/modules/system/package-manager.js');
const { default: systemService } = await import('../src/modules/system/system.service.js');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PackageManager — distro and command generation', () => {
  test('generates expected install/update commands for apt', () => {
    packageManager.pmType = 'apt';
    packageManager.distro = 'ubuntu';
    expect(packageManager.getUpdateCommand()).toBe('sudo apt-get update -y');
    expect(packageManager.getUpgradeCommand()).toBe('sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y');
    expect(packageManager.getInstallCommand('nginx')).toBe('sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nginx');
    expect(packageManager.getCheckInstalledCommand('nginx')).toContain('dpkg -s');
  });

  test('generates expected commands for pacman', () => {
    packageManager.pmType = 'pacman';
    packageManager.distro = 'arch';
    expect(packageManager.getUpdateCommand()).toBe('sudo pacman -Sy --noconfirm');
    expect(packageManager.getUpgradeCommand()).toBe('sudo pacman -Syu --noconfirm');
    expect(packageManager.getInstallCommand('nginx')).toBe('sudo pacman -S --noconfirm --needed nginx');
    expect(packageManager.getCheckInstalledCommand('nginx')).toContain('pacman -Q');
  });

  test('generates expected commands for dnf', () => {
    packageManager.pmType = 'dnf';
    packageManager.distro = 'fedora';
    expect(packageManager.getUpdateCommand()).toBe('sudo dnf check-update || true');
    expect(packageManager.getUpgradeCommand()).toBe('sudo dnf upgrade -y');
    expect(packageManager.getInstallCommand('nginx')).toBe('sudo dnf install -y nginx');
    expect(packageManager.getCheckInstalledCommand('nginx')).toContain('rpm -q');
  });

  test('generates expected commands for emerge (gentoo)', () => {
    packageManager.pmType = 'emerge';
    packageManager.distro = 'gentoo';
    expect(packageManager.getUpdateCommand()).toBe('sudo emerge --sync');
    expect(packageManager.getUpgradeCommand()).toBe('sudo emerge -uDN @world');
    expect(packageManager.getInstallCommand('nginx')).toContain('emerge');
  });

  test('getPMInfo returns correct structured metadata', () => {
    packageManager.distro = 'debian';
    packageManager.pmType = 'apt';
    packageManager.arch = 'x64';
    const info = packageManager.getPMInfo();
    expect(info.distro).toBe('debian');
    expect(info.pmType).toBe('apt');
    expect(info.arch).toBe('x64');
  });
});

describe('SystemService — Input validation helpers', () => {
  test('validates authkeys properly', () => {
    expect(systemService._validateAuthkey('tskey-auth-k123456CNTRL-abcXYZ_123')).toBe('tskey-auth-k123456CNTRL-abcXYZ_123');
    expect(systemService._validateAuthkey('')).toBe('');
    expect(() => systemService._validateAuthkey('bad;rm -rf /')).toThrow('Authkey contains invalid characters');
  });

  test('validates DB passwords properly', () => {
    expect(systemService._validateDbPassword('Secret@123_456')).toBe('Secret@123_456');
    expect(() => systemService._validateDbPassword('')).toThrow('Password is required');
    expect(() => systemService._validateDbPassword('shrt')).toThrow('Password contains invalid characters');
    expect(() => systemService._validateDbPassword('invalid password with space')).toThrow('Password contains invalid characters');
  });

  test('validates Git references properly', () => {
    expect(systemService._validateGitRef('main')).toBe('main');
    expect(systemService._validateGitRef('feature/v3.0-deploy')).toBe('feature/v3.0-deploy');
    expect(() => systemService._validateGitRef('bad; rm -rf')).toThrow('contains unsafe characters');
    expect(() => systemService._validateGitRef('')).toThrow('Invalid git reference');
  });

  test('validates Git commit hashes properly', () => {
    const validSha1 = 'a'.repeat(40);
    const validSha256 = 'b'.repeat(64);
    expect(systemService._validateCommitHash(validSha1)).toBe(validSha1);
    expect(systemService._validateCommitHash(validSha256)).toBe(validSha256);
    expect(systemService._validateCommitHash('')).toBe('');
    expect(() => systemService._validateCommitHash('invalid_hash')).toThrow('Invalid commit hash format');
  });
});

describe('SystemService — Tailscale Management', () => {
  test('handles status when Tailscale is not installed', async () => {
    systemService.mockTailscaleInstalled = false;
    systemService.mockTailscaleConnected = false;

    const status = await systemService.getTailscaleStatus();
    expect(status.installed).toBe(false);
    expect(status.status).toBe('not_installed');
    expect(status.peers).toEqual([]);
  });

  test('handles status when Tailscale is installed and connected in simulation', async () => {
    systemService.mockTailscaleInstalled = true;
    systemService.mockTailscaleConnected = true;

    const status = await systemService.getTailscaleStatus();
    expect(status.installed).toBe(true);
    expect(status.connected).toBe(true);
    expect(status.ip).toBe('100.100.100.100');
  });

  test('tailscaleUp and tailscaleDown toggle connection state in simulation', async () => {
    systemService.mockTailscaleInstalled = true;
    systemService.mockTailscaleConnected = false;

    const upRes = await systemService.tailscaleUp('valid-authkey-123');
    expect(upRes.success).toBe(true);
    expect(upRes.connected).toBe(true);

    const downRes = await systemService.tailscaleDown();
    expect(downRes).toBe(true);
    expect(systemService.mockTailscaleConnected).toBe(false);
  });
});

describe('SystemService — System Services & Package Control', () => {
  test('getServiceStatus validates service name format', async () => {
    await expect(systemService.getServiceStatus('bad;service')).rejects.toThrow('Invalid service name');
    const status = await systemService.getServiceStatus('nginx');
    expect(typeof status).toBe('boolean');
  });

  test('manageService validates service name and action', async () => {
    await expect(systemService.manageService('bad service', 'start')).rejects.toThrow('Invalid service name');
    await expect(systemService.manageService('nginx', 'destroy')).rejects.toThrow('Invalid action');
    const res = await systemService.manageService('nginx', 'restart');
    expect(res).toBe(true);
  });

  test('installPackage validates package name and executes', async () => {
    await expect(systemService.installPackage('invalid package name;')).rejects.toThrow('Invalid package name');
    const out = await systemService.installPackage('nginx');
    expect(out).toBeDefined();
  });

  test('runUpdate and runUpgrade execute package manager workflows', async () => {
    const updateOut = await systemService.runUpdate();
    expect(updateOut).toContain('Reading package lists');

    const upgradeOut = await systemService.runUpgrade();
    expect(upgradeOut).toContain('0 upgraded');
  });
});

describe('SystemService — Audit Logs & Statistics', () => {
  test('getAuditStats aggregates recent logins and commands', async () => {
    mockDb.prepare.mockReturnValue({
      all: jest.fn().mockReturnValue([
        { date: '2026-09-14', count: 12 },
        { date: '2026-09-13', count: 8 },
      ]),
    });

    const stats = await systemService.getAuditStats();
    expect(stats.logins).toHaveLength(2);
    expect(stats.terminalCmds).toBeDefined();
    expect(stats.topCommands).toBeDefined();
  });

  test('getAuditLogs returns formatted system audit logs', async () => {
    const freshDate = new Date(Date.now() + 3600000).toISOString();
    mockDb.prepare.mockReturnValue({
      all: jest.fn().mockReturnValue([
        {
          id: 'log-1',
          created_at: freshDate,
          username: 'admin',
          action: 'POST /api/websites',
          details: 'Created website',
        },
      ]),
    });

    const res = await systemService.getAuditLogs(50);
    expect(res.logs.length).toBeGreaterThanOrEqual(1);
    const sysLog = res.logs.find(l => l.type === 'system');
    expect(sysLog).toBeDefined();
    expect(sysLog.username).toBe('admin');
    expect(sysLog.action).toBe('POST /api/websites');
  });
});
