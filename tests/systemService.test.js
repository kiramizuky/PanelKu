/**
 * SystemService — Unit tests for validation helpers, service management, package management
 *
 * Uses native ESM + jest.unstable_mockModule pattern.
 * child_process, packageManager, logger are mocked.
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// ── Mocks ──
jest.unstable_mockModule('../src/config/logger.js', () => ({
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.unstable_mockModule('../src/modules/system/package-manager.js', () => ({
  default: {
    init: jest.fn(async () => {}),
    pmType: 'apt',
    getCheckInstalledCommand: jest.fn((pkg) => `dpkg -l | grep ${pkg}`),
    getInstallCommand: jest.fn((pkg) => `apt-get install -y ${pkg}`),
    getUpdateCommand: jest.fn(() => 'apt update'),
    getUpgradeCommand: jest.fn(() => 'apt upgrade -y'),
    getPMInfo: jest.fn(() => ({ type: 'apt', name: 'apt-get' })),
  },
}));

jest.unstable_mockModule('../src/core/db/sqlite.js', () => ({
  getDb: jest.fn(() => ({
    prepare: jest.fn(() => ({
      get: jest.fn(() => ({ count: 5 })),
      all: jest.fn(() => []),
    })),
  })),
}));

jest.unstable_mockModule('child_process', () => ({
  exec: jest.fn((cmd, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    if (typeof cb === 'function') cb(null, { stdout: 'active\n', stderr: '' });
    return { kill: jest.fn() };
  }),
  execFile: jest.fn((bin, args, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    if (typeof cb === 'function') cb(null, { stdout: 'ok\n', stderr: '' });
    return { kill: jest.fn() };
  }),
  spawn: jest.fn(() => ({
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() },
    on: jest.fn((event, cb) => {
      if (event === 'close') cb(0);
    }),
  })),
}));

// ── Dynamic imports ──
const { default: systemService } = await import('../src/modules/system/system.service.js');

beforeEach(() => {
  jest.clearAllMocks();
  systemService.mockTailscaleInstalled = false;
  systemService.mockTailscaleConnected = false;
});

// ═══════════════════════════════════════════════════════════
//  VALIDATION HELPERS
// ═══════════════════════════════════════════════════════════

describe('SystemService — Validation Helpers', () => {
  describe('_validateAuthkey', () => {
    test('accepts valid authkey', () => {
      expect(systemService._validateAuthkey('tskey-auth-abc123')).toBe('tskey-auth-abc123');
      expect(systemService._validateAuthkey('')).toBe('');
    });

    test('rejects authkey with invalid characters', () => {
      expect(() => systemService._validateAuthkey('key; rm -rf /')).toThrow(/invalid characters/);
      expect(() => systemService._validateAuthkey('key$(whoami)')).toThrow(/invalid characters/);
    });
  });

  describe('_validateDbPassword', () => {
    test('accepts valid password', () => {
      expect(systemService._validateDbPassword('MyP@ss123')).toBe('MyP@ss123');
    });

    test('rejects empty password', () => {
      expect(() => systemService._validateDbPassword('')).toThrow(/required/);
      expect(() => systemService._validateDbPassword(null)).toThrow(/required/);
    });

    test('rejects password with invalid characters', () => {
      expect(() => systemService._validateDbPassword('pass word')).toThrow(/invalid characters/);
      expect(() => systemService._validateDbPassword('pass;injection')).toThrow(/invalid characters/);
    });
  });

  describe('_validateGitRef', () => {
    test('accepts valid git refs', () => {
      expect(systemService._validateGitRef('main')).toBe('main');
      expect(systemService._validateGitRef('feature/my-branch')).toBe('feature/my-branch');
      expect(systemService._validateGitRef('v1.0.0')).toBe('v1.0.0');
    });

    test('rejects invalid refs', () => {
      expect(() => systemService._validateGitRef('branch; rm -rf /')).toThrow(/unsafe characters/);
      expect(() => systemService._validateGitRef('')).toThrow(/Invalid/);
      expect(() => systemService._validateGitRef(null)).toThrow(/Invalid/);
    });

    test('rejects over-long refs', () => {
      expect(() => systemService._validateGitRef('a'.repeat(300))).toThrow(/too long/);
    });
  });

  describe('_validateCommitHash', () => {
    test('accepts valid 40-char SHA', () => {
      const hash = 'a'.repeat(40);
      expect(systemService._validateCommitHash(hash)).toBe(hash);
    });

    test('accepts valid 64-char SHA', () => {
      const hash = 'b'.repeat(64);
      expect(systemService._validateCommitHash(hash)).toBe(hash);
    });

    test('accepts empty string', () => {
      expect(systemService._validateCommitHash('')).toBe('');
    });

    test('rejects invalid hash', () => {
      expect(() => systemService._validateCommitHash('not-a-hash')).toThrow(/Invalid commit hash/);
    });
  });
});

// ═══════════════════════════════════════════════════════════
//  SERVICE MANAGEMENT
// ═══════════════════════════════════════════════════════════

describe('SystemService — Service Management', () => {
  test('getServiceStatus validates service name', async () => {
    await expect(systemService.getServiceStatus('valid-service')).resolves.toBe(true);
  });

  test('getServiceStatus rejects invalid service name', async () => {
    await expect(systemService.getServiceStatus('service; rm -rf /'))
      .rejects.toThrow(/Invalid service name/);
    await expect(systemService.getServiceStatus(''))
      .rejects.toThrow(/Invalid service name/);
  });

  test('manageService validates service name and action', async () => {
    await expect(systemService.manageService('nginx', 'start')).resolves.toBe(true);
    await expect(systemService.manageService('nginx', 'stop')).resolves.toBe(true);
    await expect(systemService.manageService('nginx', 'restart')).resolves.toBe(true);
  });

  test('manageService rejects invalid action', async () => {
    await expect(systemService.manageService('nginx', 'delete'))
      .rejects.toThrow(/Invalid action/);
    await expect(systemService.manageService('nginx', 'rm -rf /'))
      .rejects.toThrow(/Invalid action/);
  });

  test('manageService rejects invalid service name', async () => {
    await expect(systemService.manageService('nginx; rm -rf /', 'start'))
      .rejects.toThrow(/Invalid service name/);
  });

  test('getServiceLogs validates service name', async () => {
    const result = await systemService.getServiceLogs('nginx', 50);
    expect(result).toBeTruthy();
  });

  test('getServiceLogs rejects invalid service name', async () => {
    await expect(systemService.getServiceLogs('nginx; injection'))
      .rejects.toThrow(/Invalid service name/);
  });
});

// ═══════════════════════════════════════════════════════════
//  PACKAGE MANAGEMENT
// ═══════════════════════════════════════════════════════════

describe('SystemService — Package Management', () => {
  test('isInstalled validates package name', async () => {
    const result = await systemService.isInstalled('nginx');
    expect(typeof result).toBe('boolean');
  });

  test('isInstalled rejects invalid package name', async () => {
    await expect(systemService.isInstalled('nginx; rm -rf /'))
      .rejects.toThrow(/Invalid package name/);
  });

  test('installPackage validates package name', async () => {
    const result = await systemService.installPackage('htop');
    expect(result).toBeTruthy();
  });

  test('installPackage rejects invalid package name', async () => {
    await expect(systemService.installPackage('htop; injection'))
      .rejects.toThrow(/Invalid package name/);
  });

  test('runUpdate runs package manager update', async () => {
    const result = await systemService.runUpdate();
    expect(result).toBeTruthy();
  });

  test('runUpgrade runs package manager upgrade', async () => {
    const result = await systemService.runUpgrade();
    expect(result).toBeTruthy();
  });

  test('getPackageManagerInfo returns package manager info', async () => {
    const result = await systemService.getPackageManagerInfo();
    expect(result).toHaveProperty('type');
    expect(result).toHaveProperty('name');
  });
});

// ═══════════════════════════════════════════════════════════
//  SYSTEM OPERATIONS
// ═══════════════════════════════════════════════════════════

describe('SystemService — System Operations', () => {
  test('getPanelVersion returns version info', async () => {
    const result = await systemService.getPanelVersion();
    expect(result).toHaveProperty('current');
    expect(result).toHaveProperty('lastUpdated');
  });

  test('getAuditStats returns stats', async () => {
    const result = await systemService.getAuditStats();
    expect(result).toHaveProperty('logins');
    expect(result).toHaveProperty('terminalCmds');
    expect(result).toHaveProperty('topCommands');
  });

  test('getAuditLogs returns logs', async () => {
    const result = await systemService.getAuditLogs(10);
    expect(result).toHaveProperty('logs');
    expect(Array.isArray(result.logs)).toBe(true);
  });

  test('getAutoUpdate returns boolean', async () => {
    const result = await systemService.getAutoUpdate();
    expect(typeof result).toBe('boolean');
  });

  test('reboot returns true', async () => {
    const result = await systemService.reboot();
    expect(result).toBe(true);
  });

  test('restartPanel returns true', async () => {
    const result = await systemService.restartPanel();
    expect(result).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
//  TAILSCALE
// ═══════════════════════════════════════════════════════════

describe('SystemService — Tailscale', () => {
  test('isTailscaleInstalled checks installation', async () => {
    const result = await systemService.isTailscaleInstalled();
    expect(typeof result).toBe('boolean');
  });

  test('getTailscaleStatus returns status', async () => {
    const result = await systemService.getTailscaleStatus();
    expect(result).toHaveProperty('installed');
    expect(result).toHaveProperty('status');
  });

  test('tailscaleDown disconnects', async () => {
    const result = await systemService.tailscaleDown();
    expect(result).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
//  PANEL UPDATE
// ═══════════════════════════════════════════════════════════

describe('SystemService — Panel Update', () => {
  test('getPanelAutoUpdate returns config', async () => {
    const result = await systemService.getPanelAutoUpdate();
    expect(result).toHaveProperty('enabled');
    expect(result).toHaveProperty('frequency');
  });

  test('setPanelAutoUpdate saves config', async () => {
    // This writes to storage/panel.json — mock fs if needed
    const result = await systemService.setPanelAutoUpdate({ enabled: true, frequency: 'daily' });
    expect(result).toBe(true);
  });
});
