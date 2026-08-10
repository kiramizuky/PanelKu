/**
 * BackupService — R3-L3 restore-target boundary regression tests
 *
 * Fix: the files-restore branch checked `resolvedTarget.startsWith('/var/www')`
 * which allowed escapes like `/var/www2/...`. Now `validateRestoreTarget()`
 * uses `path.relative('/var/www', resolved)` and rejects anything that
 * escapes the root (boundary-aware, blocks `..` traversal too).
 */

// ── Environment setup (MUST be before app imports) ──
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect } from '@jest/globals';
import path from 'path';

// ── Mock external deps (native-ESM style) ──
jest.unstable_mockModule('../src/config/logger.js', () => ({
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.unstable_mockModule('../src/models/Setting.js', () => ({
  default: { get: jest.fn(async () => null), set: jest.fn(async () => {}) },
}));
jest.unstable_mockModule('../plugins/shared/rclone-helper.js', () => ({
  detectRclone: jest.fn(async () => ({ installed: true, bin: 'rclone' })),
  getRcloneStatus: jest.fn(async () => ({ installed: true })),
}));
jest.unstable_mockModule('child_process', () => ({
  spawn: jest.fn(() => {
    const child = { stdout: { on: jest.fn() }, stderr: { on: jest.fn() }, on: jest.fn(), stdin: { write: jest.fn(), end: jest.fn() } };
    return child;
  }),
  exec: jest.fn((cmd, ...rest) => {
    const cb = rest.pop();
    if (typeof cb !== 'function') return;
    cb(null, { stdout: '', stderr: '' });
  }),
}));
jest.unstable_mockModule('fs/promises', () => ({
  default: {
    access: jest.fn(async () => {}),
    mkdir: jest.fn(async () => {}),
    readFile: jest.fn(async () => ''),
    writeFile: jest.fn(async () => {}),
    readdir: jest.fn(async () => []),
    unlink: jest.fn(async () => {}),
    rm: jest.fn(async () => {}),
  },
}));

const { validateRestoreTarget } = await import('../src/modules/backup/backup.service.js');

describe('BackupService.validateRestoreTarget — R3-L3 boundary check', () => {
  test('accepts targets inside /var/www', () => {
    // path.resolve is platform-dependent (drive letter on Windows) — compare
    // against the same resolution instead of a hardcoded string.
    expect(validateRestoreTarget('/var/www/app')).toBe(path.resolve('/var/www', '/var/www/app'));
    expect(validateRestoreTarget('/var/www')).toBe(path.resolve('/var/www', '/var/www'));
    expect(validateRestoreTarget('app/site')).toBe(path.resolve('/var/www', 'app/site'));
  });

  test('rejects sibling prefix escape (/var/www2)', () => {
    // The OLD check `startsWith('/var/www')` let this through — now rejected.
    expect(() => validateRestoreTarget('/var/www2')).toThrow(/within \/var\/www/);
    expect(() => validateRestoreTarget('/var/www-evil')).toThrow(/within \/var\/www/);
  });

  test('rejects traversal and absolute escapes', () => {
    expect(() => validateRestoreTarget('../etc')).toThrow(/within \/var\/www/);
    expect(() => validateRestoreTarget('/etc')).toThrow(/within \/var\/www/);
    expect(() => validateRestoreTarget('../../../../etc')).toThrow(/within \/var\/www/);
  });

  test('rejects empty / whitespace targets (must not silently target web root)', () => {
    expect(() => validateRestoreTarget('')).toThrow(/required/);
    expect(() => validateRestoreTarget('   ')).toThrow(/required/);
    expect(() => validateRestoreTarget(undefined)).toThrow(/required/);
  });
});
