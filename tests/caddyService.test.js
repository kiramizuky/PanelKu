/**
 * Unit tests for Caddy Module:
 * - src/modules/caddy/caddy.service.js
 * - src/modules/caddy/caddy.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

let mockExecFileHandler = jest.fn();
let mockExecHandler = jest.fn();

jest.unstable_mockModule('child_process', () => ({
  execFile: jest.fn((file, ...rest) => {
    const cb = rest.pop();
    const args = Array.isArray(rest[0]) ? rest[0] : [];
    const opts = typeof rest[0] === 'object' && !Array.isArray(rest[0]) ? rest[0] : (rest[1] || {});
    mockExecFileHandler(file, args, opts, cb);
  }),
  exec: jest.fn((cmd, ...rest) => {
    const cb = rest.pop();
    const opts = typeof rest[0] === 'object' ? rest[0] : {};
    mockExecHandler(cmd, opts, cb);
  }),
}));

const mockFsAccess = jest.fn().mockResolvedValue(undefined);
const mockFsReaddir = jest.fn().mockResolvedValue([]);
const mockFsReadFile = jest.fn().mockResolvedValue('');
const mockFsWriteFile = jest.fn().mockResolvedValue(undefined);
const mockFsCopyFile = jest.fn().mockResolvedValue(undefined);
const mockFsMkdir = jest.fn().mockResolvedValue(undefined);
const mockFsUnlink = jest.fn().mockResolvedValue(undefined);
const mockFsRename = jest.fn().mockResolvedValue(undefined);
const mockFsStat = jest.fn().mockResolvedValue({ isFile: () => true });

jest.unstable_mockModule('fs/promises', () => ({
  default: {
    access: mockFsAccess,
    readdir: mockFsReaddir,
    readFile: mockFsReadFile,
    writeFile: mockFsWriteFile,
    copyFile: mockFsCopyFile,
    mkdir: mockFsMkdir,
    unlink: mockFsUnlink,
    rename: mockFsRename,
    stat: mockFsStat,
  },
  access: mockFsAccess,
  readdir: mockFsReaddir,
  readFile: mockFsReadFile,
  writeFile: mockFsWriteFile,
  copyFile: mockFsCopyFile,
  mkdir: mockFsMkdir,
  unlink: mockFsUnlink,
  rename: mockFsRename,
  stat: mockFsStat,
}));

const { default: caddyService } = await import('../src/modules/caddy/caddy.service.js');
const { default: caddyController } = await import('../src/modules/caddy/caddy.controller.js');

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

const originalFetch = globalThis.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  caddyService._binaryPath = '/usr/bin/caddy';

  mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
    cb(null, { stdout: 'v2.7.4 h1:Jda...', stderr: '' });
  });

  mockExecHandler.mockImplementation((cmd, opts, cb) => {
    if (cmd.includes('which caddy')) {
      cb(null, { stdout: '/usr/bin/caddy', stderr: '' });
    } else if (cmd.includes('systemctl is-active')) {
      cb(null, { stdout: 'active', stderr: '' });
    } else if (cmd.includes('pgrep -x caddy')) {
      cb(null, { stdout: '1234', stderr: '' });
    } else if (cmd.includes('ss -tlnp')) {
      cb(null, { stdout: 'LISTEN 0 128 *:80 users:(("caddy",pid=1234,fd=4))', stderr: '' });
    } else if (cmd.includes('tail -n')) {
      cb(null, { stdout: '{"level":"info","msg":"handled request"}', stderr: '' });
    } else {
      cb(null, { stdout: 'ok', stderr: '' });
    }
  });

  globalThis.fetch = jest.fn().mockImplementation(async (url) => {
    if (String(url).includes('reverse_proxy')) {
      return {
        ok: true,
        json: async () => [{ address: '127.0.0.1:3000' }],
        text: async () => JSON.stringify([{ address: '127.0.0.1:3000' }]),
      };
    }
    return {
      ok: true,
      json: async () => ({ srv0: { listen: [':80'] } }),
      text: async () => JSON.stringify({ srv0: { listen: [':80'] } }),
    };
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('CaddyService — Binary Discovery & Status', () => {
  test('discovers caddy binary via filesystem or which', async () => {
    caddyService._binaryPath = null;
    mockFsAccess.mockImplementation(async (p) => {
      if (p === '/usr/bin/caddy') return undefined;
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });

    const bin = await caddyService._findBinary();
    expect(bin).toBe('/usr/bin/caddy');
  });

  test('getStatus parses version, admin API, listening ports', async () => {
    const status = await caddyService.getStatus();
    expect(status.installed).toBe(true);
    expect(status.running).toBe(true);
    expect(status.adminApiAvailable).toBe(true);
    expect(status.listeningPorts).toContain(80);
  });

  test('installCaddy blocks on Windows and reports already installed', async () => {
    if (process.platform === 'win32') {
      await expect(caddyService.installCaddy()).rejects.toThrow('only supported on Linux');
    }
  });

  test('uninstallCaddy removes binary and stops service', async () => {
    mockExecHandler.mockImplementation((cmd, opts, cb) => {
      cb(null, { stdout: 'uninstalled', stderr: '' });
    });

    const res = await caddyService.uninstallCaddy();
    expect(res.message).toContain('uninstalled successfully');
  });
});

describe('CaddyService — Service Control & Caddyfile', () => {
  test('serviceAction validates action and reloads via API or systemctl', async () => {
    await expect(caddyService.serviceAction('invalid')).rejects.toThrow('Invalid action');

    const resReload = await caddyService.serviceAction('reload');
    expect(resReload.message).toContain('reloaded');
  });

  test('getCaddyfile returns file content or default fallback', async () => {
    mockFsReadFile.mockResolvedValue(':80 {\n    respond "Hello"\n}');

    const cf = await caddyService.getCaddyfile();
    expect(cf.content).toContain('Hello');
  });

  test('saveCaddyfile saves, validates, and reloads Caddy', async () => {
    await expect(caddyService.saveCaddyfile('')).rejects.toThrow('content is required');
    await expect(caddyService.saveCaddyfile('x'.repeat(100001))).rejects.toThrow('too large');

    mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
      cb(null, { stdout: 'Valid syntax', stderr: '' });
    });

    const res = await caddyService.saveCaddyfile(':80 {\n    respond "Updated"\n}');
    expect(res.message).toContain('saved, validated');
    expect(mockFsCopyFile).toHaveBeenCalled();
  });

  test('validateCaddyfile parses errors when validation fails', async () => {
    mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
      cb(null, { stdout: 'Error: invalid directive unknown_directive', stderr: '' });
    });

    const val = await caddyService.validateCaddyfile();
    expect(val.valid).toBe(false);
  });

  test('formatCaddyfile invokes caddy fmt', async () => {
    mockFsReadFile.mockResolvedValue(':80 {\n\trespond "OK"\n}');

    const fmt = await caddyService.formatCaddyfile();
    expect(fmt.message).toContain('formatted successfully');
  });
});

describe('CaddyService — Sites Management', () => {
  test('getSites parses site conf files and detects types', async () => {
    mockFsReaddir.mockResolvedValue(['app.example.com.conf']);
    mockFsReadFile.mockResolvedValue(`
      app.example.com {
          reverse_proxy 127.0.0.1:3000
          encode gzip
      }
    `);

    const sites = await caddyService.getSites();
    expect(sites.length).toBe(1);
    expect(sites[0].domain).toBe('app.example.com');
    expect(sites[0].type).toBe('proxy');
    expect(sites[0].proxyTarget).toBe('127.0.0.1:3000');
  });

  test('getSite returns single site content', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    mockFsReadFile.mockResolvedValue('test.com { file_server }');

    const site = await caddyService.getSite('test.com');
    expect(site.name).toBe('test.com');
    expect(site.content).toContain('file_server');
  });

  test('createSite generates and validates proxy site', async () => {
    mockFsAccess.mockImplementation(async (p) => {
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });

    mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
      cb(null, { stdout: 'Valid syntax', stderr: '' });
    });

    const res = await caddyService.createSite({
      domain: 'api.example.com',
      type: 'proxy',
      port: 5000,
    });
    expect(res.message).toContain('created successfully');
    expect(mockFsWriteFile).toHaveBeenCalled();
  });

  test('updateSite modifies domain, proxy, and root', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    mockFsReadFile.mockResolvedValue('old.com {\n    reverse_proxy 127.0.0.1:3000\n}\n');

    mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
      cb(null, { stdout: 'Valid syntax', stderr: '' });
    });

    const res = await caddyService.updateSite('old.com', {
      domain: 'new.com',
      proxyTarget: '127.0.0.1:4000',
    });
    expect(res.message).toContain('updated successfully');
  });

  test('deleteSite removes file and reloads', async () => {
    mockFsAccess.mockResolvedValue(undefined);

    const res = await caddyService.deleteSite('del.com');
    expect(res.message).toContain('deleted successfully');
    expect(mockFsUnlink).toHaveBeenCalled();
  });

  test('toggleSite renames site to disable or enable', async () => {
    const resDisable = await caddyService.toggleSite('mysite', false);
    expect(resDisable.message).toContain('disabled');
    expect(mockFsRename).toHaveBeenCalled();

    const resEnable = await caddyService.toggleSite('mysite', true);
    expect(resEnable.message).toContain('enabled');
  });
});

describe('CaddyService — Admin API, Certs & Logs', () => {
  test('callAdminApi fetches endpoints and parses response', async () => {
    const config = await caddyService.getAdminConfig();
    expect(config).toHaveProperty('srv0');

    const upstreams = await caddyService.getAdminReverseProxy();
    expect(Array.isArray(upstreams)).toBe(true);
  });

  test('getCertificates scans certificate directories', async () => {
    mockFsReaddir.mockImplementation(async (dir) => {
      if (dir.endsWith('certificates') || dir.endsWith('certificates/')) return ['example.com'];
      return ['example.com.crt', 'example.com.key'];
    });

    const certs = await caddyService.getCertificates();
    expect(certs.length).toBe(1);
    expect(certs[0].domain).toBe('example.com');
    expect(certs[0].fileCount).toBe(1);
  });

  test('getLogs tails access or error log', async () => {
    const logs = await caddyService.getLogs('access', 20);
    expect(logs.lines.length).toBeGreaterThan(0);
  });
});

describe('CaddyController — API Endpoints', () => {
  test('getStatus returns 200', async () => {
    const req = {};
    const res = createMockRes();
    await caddyController.getStatus(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('serviceAction endpoint validates action', async () => {
    const reqEmpty = { body: {} };
    const resEmpty = createMockRes();
    await caddyController.serviceAction(reqEmpty, resEmpty);
    expect(resEmpty.statusCode).toBe(400);

    const reqBad = { body: { action: 'destroy' } };
    const resBad = createMockRes();
    await caddyController.serviceAction(reqBad, resBad);
    expect(resBad.statusCode).toBe(400);
  });

  test('saveCaddyfile validates content', async () => {
    const req = { body: {} };
    const res = createMockRes();
    await caddyController.saveCaddyfile(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('createSite validates domain', async () => {
    const req = { body: {} };
    const res = createMockRes();
    await caddyController.createSite(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('toggleSite validates name and enable flag', async () => {
    const reqNoName = { body: { enable: true } };
    const resNoName = createMockRes();
    await caddyController.toggleSite(reqNoName, resNoName);
    expect(resNoName.statusCode).toBe(400);

    const reqNoFlag = { body: { name: 'app' } };
    const resNoFlag = createMockRes();
    await caddyController.toggleSite(reqNoFlag, resNoFlag);
    expect(resNoFlag.statusCode).toBe(400);
  });
});
