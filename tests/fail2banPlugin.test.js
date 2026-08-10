/**
 * Fail2ban Manager plugin — R3-L1 jail-name validation regression tests
 *
 * Fix: jail names obtained from `fail2ban-client status` output are now
 * validated with validateJailName() (^[a-zA-Z0-9_-]+$) before they are
 * interpolated into `fail2ban-client status ${name}` (defense-in-depth).
 * The ban/unban routes use the same shared validator.
 */

// ── Environment setup (MUST be before app imports) ──
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect } from '@jest/globals';

// ── Mock external deps (native-ESM style) ──
jest.unstable_mockModule('../src/middleware/auth.js', () => ({
  requireAuth: (req, res, next) => next(),
}));
jest.unstable_mockModule('../plugins/shared/dep-installer.js', () => ({
  ensureCommand: jest.fn(async () => {}),
}));
jest.unstable_mockModule('child_process', () => ({
  exec: jest.fn((cmd, ...rest) => {
    const cb = rest.pop();
    if (typeof cb !== 'function') return;
    cb(null, { stdout: 'ok', stderr: '' });
  }),
}));

const { default: fail2banPlugin, validateJailName } = await import('../plugins/fail2ban-manager/index.js');

describe('fail2ban-manager validateJailName — R3-L1', () => {
  test('accepts legitimate jail names', () => {
    expect(validateJailName('sshd')).toBe('sshd');
    expect(validateJailName('nginx-http-auth')).toBe('nginx-http-auth');
    expect(validateJailName('my_jail_2')).toBe('my_jail_2');
  });

  test('rejects injection payloads', () => {
    expect(() => validateJailName('sshd; rm -rf /')).toThrow(/Invalid jail name|invalid characters/);
    expect(() => validateJailName('$(whoami)')).toThrow(/invalid characters/);
    expect(() => validateJailName('sshd`id`')).toThrow(/invalid characters/);
    expect(() => validateJailName('sshd | cat /etc/passwd')).toThrow(/invalid characters/);
    expect(() => validateJailName('sshd#comment')).toThrow(/invalid characters/);
    expect(() => validateJailName('')).toThrow(/Invalid jail name/);
    expect(() => validateJailName(undefined)).toThrow(/Invalid jail name/);
  });
});

describe('fail2ban-manager register — ban route uses shared validator', () => {
  const routes = {};
  const fakeApp = {
    get: (path, ...handlers) => { routes[path] = handlers[handlers.length - 1]; },
    post: (path, ...handlers) => { routes[path] = handlers[handlers.length - 1]; },
  };
  fail2banPlugin.register(fakeApp, {});

  test('ban rejects malicious jail name', async () => {
    const res = { json: jest.fn() };
    await routes['/api/plugins/fail2ban/ban'](
      { body: { jail: 'sshd; rm -rf /', ip: '192.0.2.1' } },
      res
    );
    expect(res.json).toHaveBeenCalledWith({ success: false, message: expect.stringMatching(/jail|invalid/i) });
  });

  test('ban rejects invalid IP', async () => {
    const res = { json: jest.fn() };
    await routes['/api/plugins/fail2ban/ban'](
      { body: { jail: 'sshd', ip: 'not-an-ip; id' } },
      res
    );
    expect(res.json).toHaveBeenCalledWith({ success: false, message: expect.stringMatching(/IP/i) });
  });

  test('ban accepts valid jail + IP', async () => {
    const res = { json: jest.fn() };
    await routes['/api/plugins/fail2ban/ban'](
      { body: { jail: 'sshd', ip: '192.0.2.1' } },
      res
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, message: expect.stringContaining('banned successfully') });
  });
});
