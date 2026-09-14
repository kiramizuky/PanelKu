/**
 * Unit tests for Apache Module:
 * - src/modules/apache/apache.service.js
 * - src/modules/apache/apache.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

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

jest.unstable_mockModule('fs/promises', () => ({
  default: {
    access: mockFsAccess,
    readdir: mockFsReaddir,
    readFile: mockFsReadFile,
    writeFile: mockFsWriteFile,
    copyFile: mockFsCopyFile,
    mkdir: mockFsMkdir,
    unlink: mockFsUnlink,
  },
  access: mockFsAccess,
  readdir: mockFsReaddir,
  readFile: mockFsReadFile,
  writeFile: mockFsWriteFile,
  copyFile: mockFsCopyFile,
  mkdir: mockFsMkdir,
  unlink: mockFsUnlink,
}));

const { default: apacheService } = await import('../src/modules/apache/apache.service.js');
const { default: apacheController } = await import('../src/modules/apache/apache.controller.js');

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

beforeEach(() => {
  jest.clearAllMocks();
  apacheService._binary = { bin: 'apache2', svc: 'apache2', confDir: '/etc/apache2', pkg: 'apache2' };

  mockExecHandler.mockImplementation((cmd, opts, cb) => {
    if (cmd.includes('which apache2')) {
      cb(null, { stdout: '/usr/sbin/apache2', stderr: '' });
    } else if (cmd.includes('apache2 -v') || cmd.includes('httpd -v')) {
      cb(null, { stdout: 'Server version: Apache/2.4.52 (Ubuntu)', stderr: '' });
    } else if (cmd.includes('systemctl is-active')) {
      cb(null, { stdout: 'active', stderr: '' });
    } else if (cmd.includes('configtest')) {
      cb(null, { stdout: 'Syntax OK', stderr: '' });
    } else if (cmd.includes('ss -tlnp')) {
      cb(null, { stdout: 'LISTEN 0 128 *:80 users:(("apache2",pid=100,fd=4))', stderr: '' });
    } else if (cmd.includes('tail -n')) {
      cb(null, { stdout: '127.0.0.1 - - [10/Jan/2026] "GET / HTTP/1.1" 200', stderr: '' });
    } else {
      cb(null, { stdout: 'ok', stderr: '' });
    }
  });
});

describe('ApacheService — Status & Service Controls', () => {
  test('getStatus parses version, active status, and listening ports', async () => {
    const status = await apacheService.getStatus();
    expect(status.installed).toBe(true);
    expect(status.running).toBe(true);
    expect(status.version).toBe('2.4.52');
    expect(status.listeningPorts).toContain(80);
  });

  test('serviceAction validates action and reloads/starts service', async () => {
    await expect(apacheService.serviceAction('bad_action')).rejects.toThrow('Invalid action');

    const res = await apacheService.serviceAction('reload');
    expect(res.message).toContain('reloaded successfully');
  });

  test('testConfig checks configuration syntax', async () => {
    const okTest = await apacheService.testConfig();
    expect(okTest.valid).toBe(true);
    expect(okTest.message).toContain('valid');

    mockExecHandler.mockImplementation((cmd, opts, cb) => {
      if (cmd.includes('configtest')) {
        cb(new Error('Syntax error on line 12'));
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
    });

    const failTest = await apacheService.testConfig();
    expect(failTest.valid).toBe(false);
  });
});

describe('ApacheService — Module Management', () => {
  test('getModules lists enabled and available modules on Debian', async () => {
    mockExecHandler.mockImplementation((cmd, opts, cb) => {
      if (cmd.includes('mods-enabled')) {
        cb(null, { stdout: 'rewrite.load\nssl.load\n', stderr: '' });
      } else if (cmd.includes('mods-available')) {
        cb(null, { stdout: 'rewrite.load\nssl.load\nheaders.load\n', stderr: '' });
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
    });

    const mods = await apacheService.getModules();
    expect(mods.enabled).toContain('rewrite');
    expect(mods.available).toContain('headers');
  });

  test('enableModule and disableModule validate name and run a2enmod/a2dismod', async () => {
    await expect(apacheService.enableModule('')).rejects.toThrow('Module name is required');
    await expect(apacheService.enableModule('bad module')).rejects.toThrow('Invalid module name');

    const enableRes = await apacheService.enableModule('headers');
    expect(enableRes.message).toContain('enabled and Apache reloaded');

    const disableRes = await apacheService.disableModule('headers');
    expect(disableRes.message).toContain('disabled and Apache reloaded');
  });
});

describe('ApacheService — Virtual Hosts CRUD', () => {
  test('getVhosts parses configuration files', async () => {
    mockFsReaddir.mockResolvedValue(['example.com.conf']);
    mockFsReadFile.mockResolvedValue(`
      <VirtualHost *:80>
        ServerName example.com
        ServerAlias www.example.com
        DocumentRoot /var/www/example.com
      </VirtualHost>
    `);
    mockFsAccess.mockResolvedValue(undefined);

    const vhosts = await apacheService.getVhosts();
    expect(vhosts.length).toBe(1);
    expect(vhosts[0].serverName).toBe('example.com');
    expect(vhosts[0].documentRoot).toBe('/var/www/example.com');
    expect(vhosts[0].enabled).toBe(true);
  });

  test('getVhost retrieves a single vhost config', async () => {
    mockFsReadFile.mockResolvedValue('<VirtualHost *:80>\nServerName myapp.test\n</VirtualHost>');

    const vhost = await apacheService.getVhost('myapp.test');
    expect(vhost.name).toBe('myapp.test');
    expect(vhost.content).toContain('ServerName myapp.test');
  });

  test('createVhost generates and validates static/proxy/php vhost', async () => {
    // Simulates file not yet existing
    mockFsAccess.mockImplementation(async (p) => {
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });

    const res = await apacheService.createVhost({
      serverName: 'newapp.test',
      type: 'proxy',
      port: 3000,
    });
    expect(res.message).toContain('created and Apache reloaded');
    expect(mockFsWriteFile).toHaveBeenCalled();
  });

  test('createVhost rolls back when config test fails', async () => {
    mockFsAccess.mockImplementation(async () => {
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });

    mockExecHandler.mockImplementation((cmd, opts, cb) => {
      if (cmd.includes('configtest')) {
        cb(null, { stdout: 'Syntax error in new file', stderr: '' });
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
    });

    await expect(apacheService.createVhost({ serverName: 'broken.test' })).rejects.toThrow('Apache config test failed');
    expect(mockFsUnlink).toHaveBeenCalled();
  });

  test('updateVhost modifies existing directives', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    mockFsReadFile.mockResolvedValue('<VirtualHost *:80>\nServerName update.test\nDocumentRoot /var/www/old\n</VirtualHost>');

    const res = await apacheService.updateVhost('update.test', {
      documentRoot: '/var/www/new',
      port: 8080,
    });
    expect(res.message).toContain('updated');
  });

  test('deleteVhost removes file and reloads service', async () => {
    mockFsAccess.mockResolvedValue(undefined);

    const res = await apacheService.deleteVhost('del.test');
    expect(res.message).toContain('deleted');
    expect(mockFsUnlink).toHaveBeenCalled();
  });

  test('toggleVhost enables or disables site', async () => {
    const resEnable = await apacheService.toggleVhost('site.test', true);
    expect(resEnable.message).toContain('enabled');

    const resDisable = await apacheService.toggleVhost('site.test', false);
    expect(resDisable.message).toContain('disabled');
  });
});

describe('ApacheService — Main Config & Logs', () => {
  test('getMainConfig reads configuration', async () => {
    mockFsReadFile.mockResolvedValue('Timeout 300\nKeepAlive On\n');

    const conf = await apacheService.getMainConfig();
    expect(conf.content).toContain('Timeout 300');
  });

  test('saveMainConfig saves and validates config', async () => {
    await expect(apacheService.saveMainConfig('')).rejects.toThrow('Config content is required');

    const res = await apacheService.saveMainConfig('Timeout 60\n');
    expect(res.message).toContain('Main configuration saved');
    expect(mockFsCopyFile).toHaveBeenCalled();
  });

  test('getLogs retrieves tail of log files', async () => {
    const logs = await apacheService.getLogs('example.com', 'error', 50);
    expect(logs.lines.length).toBeGreaterThan(0);
  });
});

describe('ApacheController — API Endpoints', () => {
  test('getStatus returns 200', async () => {
    const req = {};
    const res = createMockRes();
    await apacheController.getStatus(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('serviceAction endpoint validates action body', async () => {
    const reqNoAct = { body: {} };
    const resNoAct = createMockRes();
    await apacheController.serviceAction(reqNoAct, resNoAct);
    expect(resNoAct.statusCode).toBe(400);

    const reqBadAct = { body: { action: 'destroy' } };
    const resBadAct = createMockRes();
    await apacheController.serviceAction(reqBadAct, resBadAct);
    expect(resBadAct.statusCode).toBe(400);
  });

  test('enableModule validates module name', async () => {
    const req = { body: {} };
    const res = createMockRes();
    await apacheController.enableModule(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('createVhost validates serverName', async () => {
    const req = { body: {} };
    const res = createMockRes();
    await apacheController.createVhost(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('toggleVhost validates name and enable flag', async () => {
    const reqNoName = { body: { enable: true } };
    const resNoName = createMockRes();
    await apacheController.toggleVhost(reqNoName, resNoName);
    expect(resNoName.statusCode).toBe(400);

    const reqNoFlag = { body: { name: 'app.com' } };
    const resNoFlag = createMockRes();
    await apacheController.toggleVhost(reqNoFlag, resNoFlag);
    expect(resNoFlag.statusCode).toBe(400);
  });

  test('saveConfig validates content', async () => {
    const req = { body: {} };
    const res = createMockRes();
    await apacheController.saveConfig(req, res);
    expect(res.statusCode).toBe(400);
  });
});
