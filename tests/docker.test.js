/**
 * DockerService.deployCompose — R3-H2 command-injection regression tests
 *
 * Fix: `projectName` (from req.body) was interpolated raw into
 * `docker compose -p ${projectName} ...` AND used as the compose directory
 * name (path traversal). Now validated with `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`
 * in BOTH the controller (HTTP layer) and the service (defense-in-depth for
 * all callers, including plugins).
 *
 * child_process / fs are mocked — no real docker or disk writes.
 */

// ── Environment setup (MUST be before app imports) ──
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// ── Mock external deps (native-ESM style) ──
jest.unstable_mockModule('dockerode', () => ({
  default: jest.fn().mockReturnValue({}),
}));
jest.unstable_mockModule('../src/config/logger.js', () => ({
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.unstable_mockModule('../src/modules/system/package-manager.js', () => ({
  default: { init: jest.fn(async () => {}), pmType: 'apt' },
}));
// deployCompose uses dynamic `await import(...)` — mock the same specifiers
jest.unstable_mockModule('fs/promises', () => ({
  default: {
    mkdir: jest.fn(async () => {}),
    writeFile: jest.fn(async () => {}),
  },
}));
jest.unstable_mockModule('child_process', () => ({
  // promisify-style callback mock (the service wraps exec with util.promisify)
  exec: jest.fn((cmd, ...rest) => {
    const cb = rest.pop();
    if (typeof cb !== 'function') return;
    cb(null, { stdout: 'started', stderr: '' });
  }),
}));

const { default: dockerService } = await import('../src/modules/docker/docker.service.js');
const { default: dockerController } = await import('../src/modules/docker/docker.controller.js');
const { exec } = await import('child_process');
const fsPromises = (await import('fs/promises')).default;

function fakeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

function execCommands() {
  return exec.mock.calls.map(c => c.slice(0, -1)[0]);
}

beforeEach(() => {
  exec.mockClear();
  fsPromises.mkdir.mockClear();
  fsPromises.writeFile.mockClear();
  exec.mockImplementation((cmd, ...rest) => {
    const cb = rest.pop();
    if (typeof cb !== 'function') return;
    cb(null, { stdout: 'started', stderr: '' });
  });
});

describe('DockerService.deployCompose — R3-H2 rejects injection project names', () => {
  test.each([
    ['semicolon chain', 'x; rm -rf /'],
    ['quote break', 'x"; rm -rf / #'],
    // P0 regression payload: single-quote + semicolon + rm + hash comment
    ['single-quote hash', "x'; rm -rf / #"],
    ['command substitution', '$(id)'],
    ['backticks', 'x`id`'],
    ['pipe', 'x | cat /etc/passwd'],
    ['space arg', 'x --help'],
    ['path traversal', '../../etc'],
    ['slash', 'a/b'],
    ['dot', 'a.b'],
    ['too long', 'a'.repeat(65)],
    ['empty', ''],
    ['non-string', 12345],
  ])('rejects %s payload', async (_name, payload) => {
    await expect(dockerService.deployCompose(payload, 'yaml')).rejects.toThrow(/Invalid project name/);
    // validation must happen before any fs/exec side effect
    expect(fsPromises.mkdir).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('DockerService.deployCompose — accepts legitimate project names', () => {
  test('deploys a valid name via docker compose -p', async () => {
    const result = await dockerService.deployCompose('my-app', 'version: "3"');
    expect(result.success).toBe(true);
    expect(result.log).toContain('started');
    expect(fsPromises.mkdir).toHaveBeenCalledTimes(1);
    expect(fsPromises.writeFile).toHaveBeenCalledTimes(1);
    const cmds = execCommands();
    expect(cmds[0]).toContain('docker compose -p my-app');
    expect(cmds[0]).toContain('up -d');
  });

  test('accepts names used by plugin callers (hardcoded names)', async () => {
    for (const name of ['adguard', 'minio', 'nextcloud', 'uptime-kuma', 'openclaw', 'db-admin']) {
      exec.mockClear();
      fsPromises.mkdir.mockClear();
      await dockerService.deployCompose(name, 'yaml');
      expect(fsPromises.mkdir).toHaveBeenCalledTimes(1);
      expect(execCommands()[0]).toContain(`-p ${name}`);
    }
  });
});

describe('DockerController.deployCompose — R3-H2 controller-layer validation', () => {
  test('rejects malicious projectName with HTTP 400 (never reaches the service)', async () => {
    const res = fakeRes();
    await dockerController.deployCompose({ body: { projectName: 'x; rm -rf /', yaml: 'y' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(exec).not.toHaveBeenCalled();
  });

  test('rejects missing yaml with HTTP 400', async () => {
    const res = fakeRes();
    await dockerController.deployCompose({ body: { projectName: 'my-app' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('passes a valid projectName through to the service (200)', async () => {
    const res = fakeRes();
    await dockerController.deployCompose({ body: { projectName: 'my-app', yaml: 'version: "3"' } }, res);
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
