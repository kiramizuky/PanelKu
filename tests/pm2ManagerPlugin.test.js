/**
 * PM2 Manager plugin — R3-M8 command-injection regression tests
 *
 * Fix: the `/api/plugins/pm2/action` and `/api/plugins/pm2/logs` handlers
 * interpolated `name` (user input) straight into `pm2 ${action} ${name}`.
 * Now `validateAppName()` (exported) rejects anything with shell
 * metacharacters before it reaches `execAsync`.
 */

// ── Environment setup (MUST be before app imports) ──
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// ── Mock external deps (native-ESM style) ──
// NOTE: the plugin wraps `exec` with util.promisify, so the mock MUST call
// the trailing callback (promisify style) — returning a promise hangs.
// Mock path is relative to THIS test file; jest resolves it to the same
// canonical file the plugin imports (../../middleware/auth.js).
jest.unstable_mockModule('../src/middleware/auth.js', () => ({
  requireAuth: (req, res, next) => next(),
}));
jest.unstable_mockModule('child_process', () => ({
  exec: jest.fn((cmd, ...rest) => {
    const cb = rest.pop();
    if (typeof cb !== 'function') return;
    cb(null, { stdout: 'ok', stderr: '' });
  }),
}));

const { default: pm2Plugin, validateAppName } = await import('../plugins/pm2-manager/index.js');
const { exec } = await import('child_process');

/** Return exec call args with the trailing promisify callback stripped. */
function execCalls() {
  return exec.mock.calls.map(c => c.slice(0, -1));
}

beforeEach(() => {
  exec.mockClear();
  exec.mockImplementation((cmd, ...rest) => {
    const cb = rest.pop();
    if (typeof cb !== 'function') return;
    cb(null, { stdout: 'ok', stderr: '' });
  });
});

describe('pm2-manager validateAppName — R3-M8', () => {
  test('accepts legitimate PM2 names', () => {
    expect(validateAppName('my-app')).toBe('my-app');
    expect(validateAppName('app_2')).toBe('app_2');
    expect(validateAppName('./server.js')).toBe('./server.js');
  });

  test('rejects injection payloads', () => {
    expect(() => validateAppName('app; rm -rf /')).toThrow(/Invalid application name/);
    expect(() => validateAppName('$(whoami)')).toThrow(/Invalid application name/);
    expect(() => validateAppName('app`id`')).toThrow(/Invalid application name/);
    expect(() => validateAppName('app | cat /etc/passwd')).toThrow(/Invalid application name/);
    expect(() => validateAppName('')).toThrow(/Invalid application name/);
    expect(() => validateAppName(undefined)).toThrow(/Invalid application name/);
  });
});

describe('pm2-manager register — R3-M8 handlers block injection before exec', () => {
  // Capture route handlers from the fake app
  const routes = {};
  const fakeApp = {
    get: (path, ...handlers) => { routes[path] = handlers[handlers.length - 1]; },
    post: (path, ...handlers) => { routes[path] = handlers[handlers.length - 1]; },
  };
  pm2Plugin.register(fakeApp, {});

  test('/api/plugins/pm2/action rejects malicious name without running exec', async () => {
    const res = { json: jest.fn() };
    await routes['/api/plugins/pm2/action'](
      { body: { name: 'app; rm -rf /', action: 'restart' } },
      res
    );
    expect(exec).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Invalid application name' });
  });

  test('/api/plugins/pm2/action runs valid name through exec', async () => {
    const res = { json: jest.fn() };
    await routes['/api/plugins/pm2/action']({ body: { name: 'my-app', action: 'restart' } }, res);
    expect(execCalls()).toContainEqual(['pm2 restart my-app']);
    expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Application restarted successfully' });
  });

  test('/api/plugins/pm2/logs rejects malicious name without running exec', async () => {
    const res = { json: jest.fn() };
    await routes['/api/plugins/pm2/logs']({ query: { name: 'x; id' } }, res);
    expect(exec).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Invalid application name' });
  });

  test('/api/plugins/pm2/logs runs valid name through exec', async () => {
    const res = { json: jest.fn() };
    await routes['/api/plugins/pm2/logs']({ query: { name: 'my-app' } }, res);
    expect(execCalls()).toContainEqual(['pm2 logs my-app --raw --lines 100 --err --out']);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: 'ok' });
  });
});
