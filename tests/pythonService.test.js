/**
 * Unit tests for Python Module:
 * - src/modules/python/python.service.js
 * - src/modules/python/python.controller.js
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
const mockFsMkdir = jest.fn().mockResolvedValue(undefined);
const mockFsRm = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('fs/promises', () => ({
  default: {
    access: mockFsAccess,
    readdir: mockFsReaddir,
    readFile: mockFsReadFile,
    writeFile: mockFsWriteFile,
    mkdir: mockFsMkdir,
    rm: mockFsRm,
  },
  access: mockFsAccess,
  readdir: mockFsReaddir,
  readFile: mockFsReadFile,
  writeFile: mockFsWriteFile,
  mkdir: mockFsMkdir,
  rm: mockFsRm,
}));

const { default: pythonService } = await import('../src/modules/python/python.service.js');
const { default: pythonController } = await import('../src/modules/python/python.controller.js');

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
  pythonService.pyenvRoot = null;
  pythonService._initialized = false;

  mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
    cb(null, { stdout: '3.11.5\n3.10.12', stderr: '' });
  });

  mockExecHandler.mockImplementation((cmd, opts, cb) => {
    if (cmd.includes('python3 --version')) {
      cb(null, { stdout: 'Python 3.11.5', stderr: '' });
    } else if (cmd.includes('pip3 list') || cmd.includes('pip list')) {
      cb(null, { stdout: JSON.stringify([{ name: 'flask', version: '3.0.0' }]), stderr: '' });
    } else if (cmd.includes('which pyenv')) {
      cb(null, { stdout: '/root/.pyenv/bin/pyenv', stderr: '' });
    } else {
      cb(null, { stdout: 'ok', stderr: '' });
    }
  });
});

describe('PythonService — Discovery & Status', () => {
  test('discovers pyenv directory via access or which fallback', async () => {
    mockFsAccess.mockImplementation(async (filePath) => {
      if (filePath.includes('.pyenv/bin/pyenv')) return undefined;
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });

    const dir = await pythonService._findPyenvDir();
    expect(dir).toBeTruthy();
    expect(pythonService.pyenvRoot).toBe(dir);
  });

  test('getStatus returns status with installed versions and python binary info', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    pythonService.pyenvRoot = '/root/.pyenv';

    const status = await pythonService.getStatus();
    expect(status.pyenvInstalled).toBe(true);
    expect(status.currentVersion).toBe('3.11.5');
    expect(status.installedVersions.length).toBeGreaterThan(0);
  });

  test('getStatus handles system python fallback when pyenv not installed', async () => {
    pythonService.pyenvRoot = null;
    mockFsAccess.mockImplementation(async (p) => {
      if (p === '/usr/bin/python3') return undefined;
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });

    mockExecHandler.mockImplementation((cmd, opts, cb) => {
      if (cmd.includes('which pyenv')) {
        cb(null, { stdout: '', stderr: '' });
      } else {
        cb(null, { stdout: 'Python 3.10.0', stderr: '' });
      }
    });

    const status = await pythonService.getStatus();
    expect(status.currentVersion).toBe('3.10.0');
    expect(status.installedVersions).toContain('system');
  });

  test('installPyenv rejects on Windows platform', async () => {
    if (process.platform === 'win32') {
      await expect(pythonService.installPyenv()).rejects.toThrow('not natively supported on Windows');
    }
  });
});

describe('PythonService — Version Management', () => {
  beforeEach(() => {
    pythonService.pyenvRoot = '/root/.pyenv';
    pythonService._initialized = true;
  });

  test('listRemote filters versions', async () => {
    mockExecFileHandler.mockImplementation((file, args, opts, cb) => {
      cb(null, { stdout: '3.10.1\n3.11.0rc1\n3.11.5\n3.12.0a1', stderr: '' });
    });

    const all = await pythonService.listRemote('all');
    expect(all).toContain('3.10.1');
    expect(all).toContain('3.11.5');

    const stable = await pythonService.listRemote('stable');
    expect(stable).toContain('3.10.1');
    expect(stable).toContain('3.11.5');
    expect(stable).not.toContain('3.11.0rc1');
  });

  test('installVersion validates version format and invokes pyenv', async () => {
    await expect(pythonService.installVersion('bad_version')).rejects.toThrow('Invalid Python version format');

    const res = await pythonService.installVersion('3.11.5');
    expect(res.message).toContain('installed successfully');
  });

  test('uninstallVersion validates version format and invokes pyenv', async () => {
    await expect(pythonService.uninstallVersion('invalid')).rejects.toThrow('Invalid Python version format');

    const res = await pythonService.uninstallVersion('3.11.5');
    expect(res.message).toContain('uninstalled');
  });

  test('setGlobal validates format and sets version', async () => {
    await expect(pythonService.setGlobal('')).rejects.toThrow('Version is required');
    await expect(pythonService.setGlobal('not a version!@#')).rejects.toThrow('Invalid version format');

    const res = await pythonService.setGlobal('3.11.5');
    expect(res.message).toContain('set as global default');

    const resSys = await pythonService.setGlobal('system');
    expect(resSys.message).toContain('set as global default');
  });
});

describe('PythonService — Virtual Environments', () => {
  test('listVirtualEnvs scans directories and parses pyvenv.cfg', async () => {
    mockFsReaddir.mockImplementation(async (dir) => {
      if (dir === '/opt') return ['myenv'];
      return [];
    });
    mockFsAccess.mockImplementation(async (p) => {
      if (p.includes('pyvenv.cfg')) return undefined;
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });
    mockFsReadFile.mockResolvedValue('home = /usr/bin\nversion = 3.11.5\n');

    const venvs = await pythonService.listVirtualEnvs();
    expect(venvs.length).toBe(1);
    expect(venvs[0].name).toBe('myenv');
    expect(venvs[0].pythonVersion).toBe('3.11.5');
  });

  test('createVirtualEnv validates name and rejects existing directory', async () => {
    await expect(pythonService.createVirtualEnv('')).rejects.toThrow('Name is required');
    await expect(pythonService.createVirtualEnv('bad name with spaces')).rejects.toThrow();

    // Simulates existing directory
    mockFsAccess.mockResolvedValue(undefined);
    await expect(pythonService.createVirtualEnv('existing_env')).rejects.toThrow('already exists');
  });

  test('createVirtualEnv creates directory and runs python -m venv', async () => {
    mockFsAccess.mockImplementation(async () => {
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });

    const res = await pythonService.createVirtualEnv('new_env');
    expect(res.message).toContain('created');
    expect(mockFsMkdir).toHaveBeenCalled();
  });

  test('deleteVirtualEnv removes target directory', async () => {
    mockFsAccess.mockResolvedValue(undefined);

    const res = await pythonService.deleteVirtualEnv('old_env');
    expect(res.message).toContain('deleted');
    expect(mockFsRm).toHaveBeenCalled();
  });

  test('deleteVirtualEnv throws if environment not found', async () => {
    mockFsAccess.mockRejectedValue(new Error('ENOENT'));
    await expect(pythonService.deleteVirtualEnv('missing_env')).rejects.toThrow('not found');
  });
});

describe('PythonService — Pip Packages', () => {
  test('listPipPackages returns parsed JSON packages', async () => {
    mockExecHandler.mockImplementation((cmd, opts, cb) => {
      cb(null, {
        stdout: JSON.stringify([
          { name: 'fastapi', version: '0.100.0' },
          { name: 'uvicorn', version: '0.22.0' },
        ]),
        stderr: '',
      });
    });

    const pkgs = await pythonService.listPipPackages();
    expect(pkgs.length).toBe(2);
    expect(pkgs[0].name).toBe('fastapi');
  });

  test('installPipPackage and uninstallPipPackage validate package name', async () => {
    await expect(pythonService.installPipPackage('')).rejects.toThrow('Package name is required');
    await expect(pythonService.installPipPackage('bad;rm -rf /')).rejects.toThrow('Invalid package name');

    const resInstall = await pythonService.installPipPackage('requests==2.31.0');
    expect(resInstall.message).toContain('installed');

    await expect(pythonService.uninstallPipPackage('bad;command')).rejects.toThrow('Invalid package name');
    const resUninstall = await pythonService.uninstallPipPackage('requests');
    expect(resUninstall.message).toContain('uninstalled');
  });
});

describe('PythonService — WSGI & Supervisor & Python Info', () => {
  test('getWsgiServers parses running processes', async () => {
    mockExecHandler.mockImplementation((cmd, opts, cb) => {
      if (cmd.includes('ps aux')) {
        cb(null, {
          stdout: 'www-data 1234 0.5 1.2 12345 6789 pts/0 S 12:00 0:01 /usr/bin/python3 -m gunicorn app:main --bind 127.0.0.1:8000',
          stderr: '',
        });
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
    });

    const servers = await pythonService.getWsgiServers();
    expect(servers.length).toBe(1);
    expect(servers[0].pid).toBe('1234');
    expect(servers[0].type).toBe('gunicorn');
  });

  test('startWsgi validates input and launches gunicorn or uvicorn', async () => {
    await expect(pythonService.startWsgi({})).rejects.toThrow('App module is required');
    await expect(pythonService.startWsgi({ appModule: 'app; rm -rf' })).rejects.toThrow('Invalid app module format');

    const res = await pythonService.startWsgi({
      type: 'uvicorn',
      appModule: 'main:app',
      port: 8080,
      workers: 2,
    });
    expect(res.message).toContain('uvicorn started');
  });

  test('stopWsgi validates PID and kills process', async () => {
    await expect(pythonService.stopWsgi('abc')).rejects.toThrow('Valid PID is required');

    const res = await pythonService.stopWsgi('1234');
    expect(res.message).toContain('stopped');
  });

  test('getSupervisorStatus and supervisor actions', async () => {
    mockExecHandler.mockImplementation((cmd, opts, cb) => {
      if (cmd.includes('supervisorctl status')) {
        cb(null, { stdout: 'webapp RUNNING pid 5555, uptime 0:10:00', stderr: '' });
      } else if (cmd.includes('supervisorctl restart')) {
        cb(null, { stdout: 'webapp: stopped\nwebapp: started', stderr: '' });
      } else {
        cb(null, { stdout: 'ok', stderr: '' });
      }
    });

    const status = await pythonService.getSupervisorStatus();
    expect(status.isInstalled).toBe(true);
    expect(status.processes.length).toBe(1);
    expect(status.processes[0].name).toBe('webapp');

    const resAction = await pythonService.supervisorAction('webapp', 'restart');
    expect(resAction.message).toContain('Supervisor restart');

    await expect(pythonService.supervisorAction('webapp', 'invalid_action')).rejects.toThrow('Invalid action');
  });

  test('createSupervisorConfig writes config file', async () => {
    const res = await pythonService.createSupervisorConfig({
      name: 'fastapi_app',
      command: 'python3 -m uvicorn main:app',
      user: 'www-data',
    });
    expect(res.message).toContain('Supervisor config created');
    expect(mockFsWriteFile).toHaveBeenCalled();
  });

  test('getPythonInfo retrieves system info', async () => {
    mockExecHandler.mockImplementation((cmd, opts, cb) => {
      if (cmd.includes('python3 --version')) cb(null, { stdout: 'Python 3.11.5', stderr: '' });
      else if (cmd.includes('pip3 --version')) cb(null, { stdout: 'pip 23.2.1 from ...', stderr: '' });
      else if (cmd.includes('which python3')) cb(null, { stdout: '/usr/bin/python3', stderr: '' });
      else if (cmd.includes('which gunicorn')) cb(null, { stdout: '/usr/local/bin/gunicorn', stderr: '' });
      else cb(null, { stdout: '', stderr: '' });
    });

    const info = await pythonService.getPythonInfo();
    expect(info.version).toBe('3.11.5');
    expect(info.pipVersion).toBe('23.2.1');
    expect(info.gunicornInstalled).toBe(true);
  });
});

describe('PythonController — API Endpoints', () => {
  test('getStatus returns status and info', async () => {
    const req = {};
    const res = createMockRes();
    await pythonController.getStatus(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('installVersion validates version param', async () => {
    const reqEmpty = { body: {} };
    const resEmpty = createMockRes();
    await pythonController.installVersion(reqEmpty, resEmpty);
    expect(resEmpty.statusCode).toBe(400);

    const reqValid = { body: { version: '3.11.5' } };
    const resValid = createMockRes();
    await pythonController.installVersion(reqValid, resValid);
    expect(resValid.statusCode).toBe(200);
  });

  test('createVirtualEnv validates name param', async () => {
    const reqEmpty = { body: {} };
    const resEmpty = createMockRes();
    await pythonController.createVirtualEnv(reqEmpty, resEmpty);
    expect(resEmpty.statusCode).toBe(400);
  });

  test('installPipPackage validates name param', async () => {
    const reqEmpty = { body: {} };
    const resEmpty = createMockRes();
    await pythonController.installPipPackage(reqEmpty, resEmpty);
    expect(resEmpty.statusCode).toBe(400);
  });

  test('startWsgi validates appModule param', async () => {
    const reqEmpty = { body: {} };
    const resEmpty = createMockRes();
    await pythonController.startWsgi(reqEmpty, resEmpty);
    expect(resEmpty.statusCode).toBe(400);
  });

  test('stopWsgi validates pid param', async () => {
    const reqEmpty = { body: {} };
    const resEmpty = createMockRes();
    await pythonController.stopWsgi(reqEmpty, resEmpty);
    expect(resEmpty.statusCode).toBe(400);
  });

  test('createSupervisorConfig validates name and command', async () => {
    const reqNoName = { body: { command: 'echo 1' } };
    const resNoName = createMockRes();
    await pythonController.createSupervisorConfig(reqNoName, resNoName);
    expect(resNoName.statusCode).toBe(400);

    const reqNoCmd = { body: { name: 'app' } };
    const resNoCmd = createMockRes();
    await pythonController.createSupervisorConfig(reqNoCmd, resNoCmd);
    expect(resNoCmd.statusCode).toBe(400);
  });
});
