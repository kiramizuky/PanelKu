/**
 * AIRepairService — R3-M1 command-injection regression tests
 *
 * Fix: `getAutoFixSuggestions()` passed raw user params (service/port/path)
 * straight into `systemctl status ${service}` etc. Now `_validateFixContext()`
 * rejects anything unsafe before any exec, and `applyAutoFix()` uses the same
 * shared validator. Shell commands also quote the validated service name.
 *
 * All cases throw BEFORE any real shell command runs (child_process is mocked).
 */

// ── Environment setup (MUST be before app imports) ──
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

// ── Mock external deps (native-ESM style) ──
// NOTE: the service wraps `exec` with util.promisify, so the mock MUST call
// the trailing callback (promisify style) — returning a promise never settles.
jest.unstable_mockModule('child_process', () => ({
  // exec may be called as exec(cmd, cb) or exec(cmd, {options}, cb)
  exec: jest.fn((cmd, ...rest) => {
    const done = rest.pop();
    if (typeof done !== 'function') return;
    done(null, { stdout: '', stderr: '' });
  }),
}));
jest.unstable_mockModule('../src/config/logger.js', () => ({
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.unstable_mockModule('../src/models/Setting.js', () => ({
  default: { get: jest.fn(async () => '{}'), set: jest.fn(async () => {}) },
}));
jest.unstable_mockModule('../src/models/Notification.js', () => ({
  default: { create: jest.fn(async () => ({})) },
}));

const { default: aiRepairService } = await import('../src/modules/ai-repair/ai-repair.service.js');
const { exec } = await import('child_process');
const Notification = (await import('../src/models/Notification.js')).default;

beforeEach(() => {
  exec.mockClear();
  exec.mockImplementation((cmd, ...rest) => {
    const done = rest.pop();
    if (typeof done !== 'function') return;
    done(null, { stdout: '', stderr: '' });
  });
  Notification.create.mockClear();
  Notification.create.mockImplementation(async () => ({}));
});

describe('AIRepairService._validateFixContext — accepts legitimate params', () => {
  test('accepts valid service names (with .service suffix)', () => {
    expect(aiRepairService._validateFixContext({ service: 'nginx' })).toBe('nginx');
    expect(aiRepairService._validateFixContext({ service: 'nginx.service' })).toBe('nginx.service');
    expect(aiRepairService._validateFixContext({ service: 'my_app-2' })).toBe('my_app-2');
  });

  test('accepts valid port and path', () => {
    expect(aiRepairService._validateFixContext({ port: '8080' })).toBe(8080);
    expect(aiRepairService._validateFixContext({ path: '/var/www/html' })).toBe('/var/www/html');
  });

  test('empty params return empty context', () => {
    expect(aiRepairService._validateFixContext({})).toBe('');
  });
});

describe('AIRepairService._validateFixContext — rejects injection payloads', () => {
  test('rejects malicious service names', () => {
    expect(() => aiRepairService._validateFixContext({ service: 'nginx; rm -rf /' })).toThrow(/Invalid service name/);
    expect(() => aiRepairService._validateFixContext({ service: '$(whoami)' })).toThrow(/Invalid service name/);
    expect(() => aiRepairService._validateFixContext({ service: 'nginx`id`' })).toThrow(/Invalid service name/);
    expect(() => aiRepairService._validateFixContext({ service: 'nginx | cat /etc/passwd' })).toThrow(/Invalid service name/);
  });

  test('rejects out-of-range ports and non-numeric ports', () => {
    expect(() => aiRepairService._validateFixContext({ port: '70000' })).toThrow(/Invalid port/);
    expect(() => aiRepairService._validateFixContext({ port: '0' })).toThrow(/Invalid port/);
    expect(() => aiRepairService._validateFixContext({ port: 'abc;id' })).toThrow(/Invalid port/);
  });

  test('rejects paths with traversal or shell metacharacters', () => {
    expect(() => aiRepairService._validateFixContext({ path: '/var/www/../../etc' })).toThrow(/Invalid path/);
    expect(() => aiRepairService._validateFixContext({ path: '/tmp; rm -rf /' })).toThrow(/Invalid path/);
    expect(() => aiRepairService._validateFixContext({ path: '$(touch /tmp/pwn)' })).toThrow(/Invalid path/);
    expect(() => aiRepairService._validateFixContext({ path: 'relative/path' })).toThrow(/Invalid path/);
  });
});

describe('AIRepairService.getAutoFixSuggestions — R3-M1 blocks injection at suggestion time', () => {
  test('rejects malicious service BEFORE any exec runs', async () => {
    await expect(aiRepairService.getAutoFixSuggestions('service.down', { service: 'nginx; id' }))
      .rejects.toThrow(/Invalid service name/);
    expect(exec).not.toHaveBeenCalled();
  });

  test('rejects malicious path BEFORE any exec runs', async () => {
    await expect(aiRepairService.getAutoFixSuggestions('permission.denied', { path: '/etc;rm -rf' }))
      .rejects.toThrow(/Invalid path/);
    expect(exec).not.toHaveBeenCalled();
  });

  test('accepts valid absolute path for suggestions', async () => {
    const result = await aiRepairService.getAutoFixSuggestions('permission.denied', { path: '/var/www/html' });
    expect(result.id).toBe('permission.denied');
  });

  test('rejects out-of-range port BEFORE any exec runs', async () => {
    await expect(aiRepairService.getAutoFixSuggestions('port.conflict', { port: '99999' }))
      .rejects.toThrow(/Invalid port/);
    expect(exec).not.toHaveBeenCalled();
  });

  test('accepts valid service and quotes it in the shell command', async () => {
    const result = await aiRepairService.getAutoFixSuggestions('service.down', { service: 'nginx' });
    expect(result.id).toBe('service.down');
    expect(result.fixAvailable).toBe(true);
    const calls = exec.mock.calls.map(([cmd]) => cmd);
    expect(calls.some(c => c.includes('systemctl status "nginx"'))).toBe(true);
  });
});

describe('AIRepairService.applyAutoFix — R3-M1 shared validation', () => {
  test('rejects malicious service before any exec and before Notification', async () => {
    await expect(aiRepairService.applyAutoFix('service.down', { service: 'bad; rm -rf /' }))
      .rejects.toThrow(/Invalid service name/);
    expect(exec).not.toHaveBeenCalled();
    expect(Notification.create).not.toHaveBeenCalled();
  });

  test('accepts valid service and runs the fix', async () => {
    // is-active returns "active" so the fix reports success
    exec.mockImplementation((cmd, ...rest) => {
      const done = rest.pop();
      if (typeof done !== 'function') return;
      done(null, { stdout: cmd.includes('is-active') ? 'active' : '', stderr: '' });
    });
    const result = await aiRepairService.applyAutoFix('service.down', { service: 'nginx' });
    expect(result.success).toBe(true);
    expect(Notification.create).toHaveBeenCalledTimes(1);
  });

  test('port with trailing junk is coerced by parseInt — junk never reaches exec', async () => {
    const result = await aiRepairService.applyAutoFix('port.conflict', { port: '8080; rm -rf /' });
    expect(result.success).toBe(true);
    const cmds = exec.mock.calls.map(([cmd]) => cmd);
    // lsof only ever runs against the parsed port; the junk text is not executed
    expect(cmds.some(c => c.includes('lsof -ti :8080'))).toBe(true);
    expect(cmds.some(c => c.includes('rm -rf'))).toBe(false);
  });

  test('applies permission fix on a validated absolute path', async () => {
    const result = await aiRepairService.applyAutoFix('permission.denied', { path: '/var/www/html' });
    expect(result.success).toBe(true);
    const cmds = exec.mock.calls.map(([cmd]) => cmd);
    expect(cmds.some(c => c.includes('chmod -R 755 "/var/www/html"'))).toBe(true);
  });
});
