/**
 * NodeJsService PM2 — R3-M2/M3 command-injection regression tests
 *
 * Fixes:
 *  - R3-M2: `pm2Action()`/`getPm2Logs()` interpolated `name` into a shell
 *    string with no validation. Now `name` is validated with
 *    `^[a-zA-Z0-9_./-]+$` AND the commands run via `execFile` args array.
 *  - R3-M3: `pm2Start()` appended raw `args` to a shell string. Now the whole
 *    command is built with execFile: `['start', script, '--name', name, '--',
 *    ...tokens]` — no shell involved.
 *
 * child_process is mocked — no real PM2 needed.
 */

// ── Environment setup (MUST be before app imports) ──
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// ── Mock external deps (native-ESM style) ──
// NOTE: the service wraps execFile/exec with util.promisify, so mocks MUST
// call the trailing callback (promisify style) — returning a promise hangs.
jest.unstable_mockModule('child_process', () => ({
  execFile: jest.fn((file, ...rest) => {
    const cb = rest.pop();
    cb(null, { stdout: 'ok', stderr: '' });
  }),
  exec: jest.fn((cmd, cb) => {
    cb(null, { stdout: 'ok', stderr: '' });
  }),
}));
jest.unstable_mockModule('../src/config/logger.js', () => ({
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { default: nodejsService } = await import('../src/modules/nodejs/nodejs.service.js');
const { execFile, exec } = await import('child_process');

/** Return execFile call args with the trailing promisify callback stripped. */
function execFileCalls() {
  return execFile.mock.calls.map(c => c.slice(0, -1));
}

beforeEach(() => {
  execFile.mockClear();
  exec.mockClear();
  execFile.mockImplementation((file, ...rest) => {
    const cb = rest.pop();
    cb(null, { stdout: 'ok', stderr: '' });
  });
  exec.mockImplementation((cmd, cb) => {
    cb(null, { stdout: 'ok', stderr: '' });
  });
});

describe('NodeJsService.pm2Action — R3-M2 name validation', () => {
  test('rejects malicious process names', async () => {
    await expect(nodejsService.pm2Action('app; rm -rf /', 'restart')).rejects.toThrow(/Invalid process name/);
    await expect(nodejsService.pm2Action('$(whoami)', 'restart')).rejects.toThrow(/Invalid process name/);
    await expect(nodejsService.pm2Action('app`id`', 'stop')).rejects.toThrow(/Invalid process name/);
    await expect(nodejsService.pm2Action('app | cat /etc/passwd', 'delete')).rejects.toThrow(/Invalid process name/);
    expect(execFile).not.toHaveBeenCalled();
  });

  test('rejects invalid action even with valid name', async () => {
    await expect(nodejsService.pm2Action('my-app', 'hack')).rejects.toThrow(/Invalid action/);
  });

  test('runs valid name via execFile with args array (no shell)', async () => {
    const result = await nodejsService.pm2Action('my-app', 'restart');
    expect(result.success === undefined).toBe(true); // returns { message, output }
    expect(result.message).toContain('my-app');
    expect(execFileCalls()).toContainEqual(['pm2', ['restart', 'my-app'], { timeout: 30000 }]);
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('NodeJsService.getPm2Logs — R3-M2 name validation', () => {
  test('rejects malicious process names before exec', async () => {
    await expect(nodejsService.getPm2Logs('x; touch /tmp/pwn')).rejects.toThrow(/Invalid process name/);
    expect(execFile).not.toHaveBeenCalled();
  });

  test('runs valid name via execFile with clamped lines', async () => {
    await nodejsService.getPm2Logs('my-app', 100);
    expect(execFileCalls()).toContainEqual(
      ['pm2', ['logs', 'my-app', '--raw', '--lines', '100', '--nostream'], { timeout: 15000 }]
    );
  });

  test('falls back to pm2 show when logs fail', async () => {
    execFile
      .mockImplementationOnce((file, ...rest) => { const cb = rest.pop(); cb(new Error('no logs')); })
      .mockImplementationOnce((file, ...rest) => { const cb = rest.pop(); cb(null, { stdout: 'PM2 show output', stderr: '' }); });
    const out = await nodejsService.getPm2Logs('my-app', 100);
    expect(out).toContain('PM2 show output');
    expect(execFileCalls().at(-1)).toEqual(['pm2', ['show', 'my-app'], { timeout: 10000 }]);
  });
});

describe('NodeJsService.pm2Start — R3-M3 no-shell args', () => {
  test('rejects malicious script paths', async () => {
    await expect(nodejsService.pm2Start('server.js; rm -rf /', 'app')).rejects.toThrow(/Invalid script path/);
    await expect(nodejsService.pm2Start('$(id)', 'app')).rejects.toThrow(/Invalid script path/);
    expect(execFile).not.toHaveBeenCalled();
  });

  test('rejects malicious app names', async () => {
    await expect(nodejsService.pm2Start('server.js', 'bad"name;id')).rejects.toThrow(/Invalid process name/);
    await expect(nodejsService.pm2Start('server.js', 'x`id`')).rejects.toThrow(/Invalid process name/);
    expect(execFile).not.toHaveBeenCalled();
  });

  test('rejects args containing quote characters (no shell to re-join them)', async () => {
    await expect(nodejsService.pm2Start('server.js', 'app', '--grep "foo bar"')).rejects.toThrow(/quote characters/);
    await expect(nodejsService.pm2Start('server.js', 'app', "--tag 'x y'")).rejects.toThrow(/quote characters/);
    expect(execFile).not.toHaveBeenCalled();
  });

  test('splits args into argv tokens — no shell interpolation possible', async () => {
    const result = await nodejsService.pm2Start('server.js', 'app', '--port=3000 --watch');
    expect(result.message).toContain('server.js');
    expect(execFileCalls()).toContainEqual(
      ['pm2', ['start', 'server.js', '--name', 'app', '--', '--port=3000', '--watch'], { timeout: 30000 }]
    );
    // Even a "malicious" arg string cannot inject — it becomes plain argv tokens
    execFile.mockClear();
    await nodejsService.pm2Start('server.js', 'app', '$(whoami); rm -rf /');
    expect(execFileCalls()).toContainEqual(
      ['pm2', ['start', 'server.js', '--name', 'app', '--', '$(whoami);', 'rm', '-rf', '/'], { timeout: 30000 }]
    );
  });

  test('derives app name from script when name omitted', async () => {
    await nodejsService.pm2Start('server.js');
    expect(execFileCalls()).toContainEqual(
      ['pm2', ['start', 'server.js', '--name', 'server'], { timeout: 30000 }]
    );
  });
});
