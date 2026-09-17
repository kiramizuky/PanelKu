/**
 * WebsiteService — Unit tests for website CRUD, nginx config generation, validation
 *
 * Uses native ESM + jest.unstable_mockModule pattern.
 * Website model, cache, eventBus, queueManager, child_process are mocked.
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach, beforeAll, afterAll } from '@jest/globals';

// ── Mocks ──
jest.unstable_mockModule('../src/config/logger.js', () => ({
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.unstable_mockModule('../src/models/Website.js', () => ({
  default: {
    find: jest.fn(async () => []),
    findById: jest.fn(async () => null),
    findOne: jest.fn(async () => null),
    create: jest.fn(async (data) => ({ _id: 'w-new', ...data, settings: {} })),
    findByIdAndUpdate: jest.fn(async (id, data) => ({ _id: id, ...data })),
    findByIdAndDelete: jest.fn(async () => true),
    countDocuments: jest.fn(async () => 0),
  },
}));

jest.unstable_mockModule('../src/helpers/cache.js', () => ({
  default: {
    remember: jest.fn(async (key, ttl, fn) => fn()),
    del: jest.fn(async () => true),
    delPattern: jest.fn(async () => true),
    set: jest.fn(async () => true),
    get: jest.fn(async () => null),
  },
}));

jest.unstable_mockModule('../src/core/events/EventBus.js', () => {
  const bus = {
    publish: jest.fn(),
    subscribe: jest.fn(),
    on: jest.fn(),
    emit: jest.fn(),
  };
  return {
    default: bus,
    EVENTS: {
      WEBSITE_CREATED: 'website.created',
      WEBSITE_UPDATED: 'website.updated',
      WEBSITE_DELETED: 'website.deleted',
      DEPLOY_COMPLETE: 'deploy.complete',
      DEPLOY_FAILED: 'deploy.failed',
      WEBSITE_DEPLOY_STARTED: 'website.deploy_started',
    },
  };
});

jest.unstable_mockModule('../src/core/queue/QueueManager.js', () => ({
  default: {
    registerWorker: jest.fn(),
    addJob: jest.fn(async () => ({ id: 'job-1', name: 'test', queueName: 'deploy', isFallback: true })),
    getJob: jest.fn(async () => null),
    closeAll: jest.fn(async () => {}),
  },
}));

jest.unstable_mockModule('child_process', () => ({
  exec: jest.fn((cmd, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    if (typeof cb === 'function') cb(null, { stdout: '', stderr: '' });
    return { kill: jest.fn() };
  }),
  execFile: jest.fn((bin, args, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    if (typeof cb === 'function') cb(null, { stdout: '', stderr: '' });
    return { kill: jest.fn() };
  }),
}));

const fsMock = {
  access: jest.fn(async () => { throw new Error('ENOENT'); }),
  mkdir: jest.fn(async () => {}),
  writeFile: jest.fn(async () => {}),
  readFile: jest.fn(async () => ''),
  readdir: jest.fn(async () => []),
  unlink: jest.fn(async () => {}),
  rm: jest.fn(async () => {}),
};
jest.unstable_mockModule('fs/promises', () => ({ default: fsMock }));

// ── Dynamic imports ──
const { default: websiteService } = await import('../src/modules/websites/websites.service.js');
const Website = (await import('../src/models/Website.js')).default;
const { EVENTS } = await import('../src/core/events/EventBus.js');
const eventBus = (await import('../src/core/events/EventBus.js')).default;
const { exec, execFile } = await import('child_process');

beforeEach(() => {
  jest.clearAllMocks();
});

afterAll(async () => {
  const { default: queueManager } = await import('../src/core/queue/QueueManager.js');
  await queueManager.closeAll();
});

// ═══════════════════════════════════════════════════════════
//  VALIDATION HELPERS
// ═══════════════════════════════════════════════════════════

describe('WebsiteService — _validateGitRepo', () => {
  test('accepts legitimate URLs', () => {
    expect(websiteService._validateGitRepo('https://github.com/user/repo.git')).toBe('https://github.com/user/repo.git');
    expect(websiteService._validateGitRepo('git@github.com:user/repo.git')).toBe('git@github.com:user/repo.git');
    expect(websiteService._validateGitRepo('ssh://git@example.com/repo.git')).toBe('ssh://git@example.com/repo.git');
    expect(websiteService._validateGitRepo('https://gitlab.com/org/project')).toBe('https://gitlab.com/org/project');
    expect(websiteService._validateGitRepo('file:///var/www/repo')).toBe('file:///var/www/repo');
  });

  test('accepts empty string / undefined (no repo)', () => {
    expect(websiteService._validateGitRepo('')).toBe('');
    expect(websiteService._validateGitRepo(undefined)).toBe('');
    expect(websiteService._validateGitRepo(null)).toBe('');
  });

  test('rejects command injection payloads', () => {
    expect(() => websiteService._validateGitRepo('https://x; rm -rf /')).toThrow();
    expect(() => websiteService._validateGitRepo('https://x $(whoami)')).toThrow();
    expect(() => websiteService._validateGitRepo('https://x `id`')).toThrow();
    expect(() => websiteService._validateGitRepo('https://x | cat /etc/passwd')).toThrow();
    expect(() => websiteService._validateGitRepo('https://x && touch /tmp/pwned')).toThrow();
  });

  test('rejects non-URL strings', () => {
    expect(() => websiteService._validateGitRepo('github.com/user/repo')).toThrow();
    expect(() => websiteService._validateGitRepo('just-a-path')).toThrow();
  });

  test('rejects non-string values', () => {
    expect(() => websiteService._validateGitRepo(123)).toThrow(/must be a string/);
  });

  test('rejects over-long URLs', () => {
    const long = 'https://github.com/' + 'a'.repeat(600);
    expect(() => websiteService._validateGitRepo(long)).toThrow(/too long/);
  });
});

describe('WebsiteService — _validateRootDirectory', () => {
  test('accepts valid absolute paths', () => {
    expect(websiteService._validateRootDirectory('/var/www/app')).toBe('/var/www/app');
    expect(websiteService._validateRootDirectory('/home/user/sites')).toBe('/home/user/sites');
  });

  test('rejects relative paths', () => {
    expect(() => websiteService._validateRootDirectory('var/www')).toThrow(/absolute path/);
  });

  test('rejects path traversal', () => {
    expect(() => websiteService._validateRootDirectory('/var/www/../etc')).toThrow(/Path traversal/);
  });

  test('rejects shell metacharacters', () => {
    expect(() => websiteService._validateRootDirectory('/var/www/app; rm -rf /')).toThrow(/invalid characters/);
    expect(() => websiteService._validateRootDirectory('/var/www/app|cat')).toThrow(/invalid characters/);
    expect(() => websiteService._validateRootDirectory('/var/www/app$(id)')).toThrow(/invalid characters/);
  });

  test('rejects empty / null', () => {
    expect(() => websiteService._validateRootDirectory('')).toThrow(/required/);
    expect(() => websiteService._validateRootDirectory(null)).toThrow(/required/);
  });
});

describe('WebsiteService — _validateTargetHost', () => {
  test.each([
    ['127.0.0.1', '127.0.0.1'],
    ['192.168.1.100', '192.168.1.100'],
    ['backend.local', 'backend.local'],
    ['[::1]', '[::1]'],
    ['', '127.0.0.1'],
    [null, '127.0.0.1'],
    [undefined, '127.0.0.1'],
  ])('accepts valid targetHost: %s -> %s', (input, expected) => {
    expect(websiteService._validateTargetHost(input)).toBe(expected);
  });

  test.each([
    ['semicolon injection', '127.0.0.1; rm -rf /'],
    ['newline injection', '127.0.0.1\nproxy_set_header X-Pwned 1'],
    ['quotes injection', '127.0.0.1"'],
    ['curly braces', '127.0.0.1}'],
  ])('rejects malicious targetHost: %s', (_, input) => {
    expect(() => websiteService._validateTargetHost(input)).toThrow(/invalid characters/);
  });
});

// ═══════════════════════════════════════════════════════════
//  WEBSITE CRUD
// ═══════════════════════════════════════════════════════════

describe('WebsiteService — Website CRUD', () => {
  test('createWebsite creates a new website', async () => {
    Website.findOne.mockResolvedValue(null);
    Website.create.mockImplementation(async (data) => ({ _id: 'w-new', ...data, settings: {} }));
    fsMock.mkdir.mockResolvedValue();
    fsMock.writeFile.mockResolvedValue();

    const result = await websiteService.createWebsite({
      domain: 'app.example.com',
      type: 'static',
    }, 'user-1');

    expect(result.domain).toBe('app.example.com');
    expect(Website.create).toHaveBeenCalled();
    expect(eventBus.publish).toHaveBeenCalledWith(EVENTS.WEBSITE_CREATED, expect.any(Object));
  });

  test('createWebsite rejects duplicate domain', async () => {
    Website.findOne.mockResolvedValue({ domain: 'app.example.com' });
    await expect(websiteService.createWebsite({ domain: 'app.example.com' }, 'user-1'))
      .rejects.toThrow(/already configured/);
  });

  test('createWebsite creates document root', async () => {
    Website.findOne.mockResolvedValue(null);
    Website.create.mockImplementation(async (data) => ({ _id: 'w-new', ...data, settings: {} }));
    fsMock.mkdir.mockResolvedValue();
    fsMock.writeFile.mockResolvedValue();

    await websiteService.createWebsite({ domain: 'new.example.com', type: 'static' }, 'user-1');
    expect(fsMock.mkdir).toHaveBeenCalled();
  });

  test('getWebsite returns website by id', async () => {
    Website.findById.mockResolvedValue({ _id: 'w-1', domain: 'test.com' });
    const result = await websiteService.getWebsite('w-1');
    expect(result.domain).toBe('test.com');
  });

  test('getWebsite throws if not found', async () => {
    Website.findById.mockResolvedValue(null);
    await expect(websiteService.getWebsite('nonexistent')).rejects.toThrow(/not found/);
  });

  test('deleteWebsite removes nginx config and publishes event', async () => {
    Website.findById.mockResolvedValue({ _id: 'w-1', domain: 'test.com' });
    Website.findByIdAndDelete.mockResolvedValue(true);
    fsMock.unlink.mockResolvedValue();

    const result = await websiteService.deleteWebsite('w-1');
    expect(result).toBe(true);
    expect(eventBus.publish).toHaveBeenCalledWith(EVENTS.WEBSITE_DELETED, expect.any(Object));
  });

  test('deleteWebsite throws if not found', async () => {
    Website.findById.mockResolvedValue(null);
    await expect(websiteService.deleteWebsite('nonexistent')).rejects.toThrow(/not found/);
  });
});

// ═══════════════════════════════════════════════════════════
//  WEBSITE UPDATE
// ═══════════════════════════════════════════════════════════

describe('WebsiteService — Website Update', () => {
  test('updateWebsite updates website data', async () => {
    Website.findById.mockResolvedValue({
      _id: 'w-1',
      domain: 'old.com',
      gitRepo: '',
      rootDirectory: '/var/www/old.com',
      targetHost: '127.0.0.1',
      settings: {},
    });
    Website.findByIdAndUpdate.mockImplementation(async (id, data) => ({ _id: id, ...data }));

    const result = await websiteService.updateWebsite('w-1', { domain: 'new.com' });
    expect(result).toBeDefined();
  });

  test('updateWebsite validates gitRepo on update', async () => {
    Website.findById.mockResolvedValue({
      _id: 'w-2',
      domain: 'test.com',
      gitRepo: '',
      rootDirectory: '/var/www/test.com',
      targetHost: '127.0.0.1',
      settings: {},
    });

    await expect(websiteService.updateWebsite('w-2', { gitRepo: 'https://x; rm -rf /' }))
      .rejects.toThrow(/invalid characters/i);
  });

  test('updateWebsite validates targetHost on update', async () => {
    Website.findById.mockResolvedValue({
      _id: 'w-3',
      domain: 'test.com',
      gitRepo: '',
      rootDirectory: '/var/www/test.com',
      targetHost: '127.0.0.1',
      settings: {},
    });

    await expect(websiteService.updateWebsite('w-3', { targetHost: '127.0.0.1; injection' }))
      .rejects.toThrow(/invalid characters/i);
  });

  test('updateWebsite throws if not found', async () => {
    Website.findById.mockResolvedValue(null);
    await expect(websiteService.updateWebsite('nonexistent', { domain: 'x.com' }))
      .rejects.toThrow(/not found/);
  });
});

// ═══════════════════════════════════════════════════════════
//  NGINX CONFIGURATION
// ═══════════════════════════════════════════════════════════

describe('WebsiteService — Nginx Configuration', () => {
  test('getNginxConfig throws if website not found', async () => {
    Website.findById.mockResolvedValue(null);
    await expect(websiteService.getNginxConfig('nonexistent')).rejects.toThrow('Website not found');
  });

  test('saveNginxConfig throws if website not found', async () => {
    Website.findById.mockResolvedValue(null);
    await expect(websiteService.saveNginxConfig('nonexistent', 'server {}')).rejects.toThrow('Website not found');
  });

  test('saveNginxConfig throws if content is not string', async () => {
    Website.findById.mockResolvedValue({ _id: 'w-1', domain: 'test.com' });
    await expect(websiteService.saveNginxConfig('w-1', 12345)).rejects.toThrow('Configuration content must be a string');
  });

  test('removeNginxConfig removes config file', async () => {
    fsMock.unlink.mockResolvedValue();
    exec.mockImplementation((cmd, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      if (typeof cb === 'function') cb(null, { stdout: '', stderr: '' });
      return { kill: jest.fn() };
    });

    // Should not throw
    await websiteService.removeNginxConfig('test.com');
    expect(fsMock.unlink).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════
//  WEBSITE LOGS
// ═══════════════════════════════════════════════════════════

describe('WebsiteService — Logs Viewer', () => {
  test('getWebsiteLogs throws if website not found', async () => {
    Website.findById.mockResolvedValue(null);
    await expect(websiteService.getWebsiteLogs('nonexistent')).rejects.toThrow('Website not found');
  });

  test('getWebsiteLogs returns deploy history', async () => {
    Website.findById.mockResolvedValue({
      _id: 'w-1',
      domain: 'example.com',
      settings: {
        lastDeployLogs: ['Cloning repo...', 'npm install', 'Build finished'],
        lastDeployTime: '2026-09-07T00:00:00.000Z',
      },
    });

    const res = await websiteService.getWebsiteLogs('w-1', 'deploy');
    expect(res.type).toBe('deploy');
    expect(res.lines).toEqual(['Cloning repo...', 'npm install', 'Build finished']);
    expect(res.empty).toBe(false);
  });

  test('getWebsiteLogs handles empty deploy history', async () => {
    Website.findById.mockResolvedValue({
      _id: 'w-2',
      domain: 'example.com',
      settings: {},
    });

    const res = await websiteService.getWebsiteLogs('w-2', 'deploy');
    expect(res.type).toBe('deploy');
    expect(res.empty).toBe(true);
  });

  test('getWebsiteLogs returns empty if log file missing', async () => {
    Website.findById.mockResolvedValue({
      _id: 'w-3',
      domain: 'no-log-test.local',
    });

    const res = await websiteService.getWebsiteLogs('w-3', 'access', 50);
    expect(res.empty).toBe(true);
  });

  test('clearWebsiteLogs throws if website not found', async () => {
    Website.findById.mockResolvedValue(null);
    await expect(websiteService.clearWebsiteLogs('nonexistent')).rejects.toThrow('Website not found');
  });

  test('clearWebsiteLogs clears deploy history', async () => {
    Website.findById.mockResolvedValue({
      _id: 'w-4',
      domain: 'deploy-clean.local',
      settings: { lastDeployLogs: ['log 1'] },
    });
    Website.findByIdAndUpdate.mockResolvedValue({});

    const res = await websiteService.clearWebsiteLogs('w-4', 'deploy');
    expect(res.success).toBe(true);
    expect(res.message).toBe('Deployment logs cleared');
  });
});

// ═══════════════════════════════════════════════════════════
//  DEPLOY QUEUE
// ═══════════════════════════════════════════════════════════

describe('WebsiteService — Deploy Queue', () => {
  beforeAll(async () => {
    const { default: queueManager } = await import('../src/core/queue/QueueManager.js');
    queueManager.registerWorker('deploy', async () => ({ success: true, logs: ['Done'] }));
  });

  test('queueDeployGit throws if website not found', async () => {
    Website.findById.mockResolvedValueOnce(null);
    await expect(websiteService.queueDeployGit('nonexistent')).rejects.toThrow('Website not found');
  });

  test('queueDeployGit throws if gitRepo not configured', async () => {
    Website.findById.mockResolvedValueOnce({ id: 'w-no-git', domain: 'nogit.com' });
    await expect(websiteService.queueDeployGit('w-no-git')).rejects.toThrow('Git repository not configured');
  });

  test('queueDeployGit enqueues a deploy job', async () => {
    Website.findById.mockResolvedValueOnce({
      id: 'w-git-1',
      domain: 'gitapp.com',
      gitRepo: 'https://github.com/user/app.git',
      rootDirectory: '/var/www/gitapp.com',
    });

    const job = await websiteService.queueDeployGit('w-git-1');
    expect(job).toBeDefined();
    expect(job.id).toBeDefined();
    expect(job.queueName).toBe('deploy');
  });

  test('getDeployJobStatus returns null for unknown job', async () => {
    const status = await websiteService.getDeployJobStatus('fake-id');
    expect(status).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
//  NGINX CONFIG GENERATION
// ═══════════════════════════════════════════════════════════

describe('WebsiteService — Nginx Config Generation', () => {
  test('generateNginxConfig writes config file for static site', async () => {
    Website.findById.mockResolvedValue(null); // not used directly
    fsMock.mkdir.mockResolvedValue();
    fsMock.writeFile.mockResolvedValue();
    fsMock.access.mockRejectedValue(new Error('ENOENT'));
    exec.mockImplementation((cmd, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      if (typeof cb === 'function') cb(null, { stdout: '', stderr: '' });
      return { kill: jest.fn() };
    });

    await websiteService.generateNginxConfig({
      domain: 'static.example.com',
      type: 'static',
      rootDirectory: '/var/www/static.example.com',
      aliases: ['www.static.example.com'],
      ssl: { enabled: false },
    });

    expect(fsMock.writeFile).toHaveBeenCalled();
    const writeCall = fsMock.writeFile.mock.calls[0];
    expect(writeCall[0]).toContain('static.example.com.conf');
    expect(writeCall[1]).toContain('server_name');
  });

  test('generateNginxConfig writes SSL config for proxy site', async () => {
    fsMock.mkdir.mockResolvedValue();
    fsMock.writeFile.mockResolvedValue();
    fsMock.access.mockRejectedValue(new Error('ENOENT'));
    exec.mockImplementation((cmd, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      if (typeof cb === 'function') cb(null, { stdout: '', stderr: '' });
      return { kill: jest.fn() };
    });

    await websiteService.generateNginxConfig({
      domain: 'api.example.com',
      type: 'proxy',
      port: 3000,
      targetHost: '127.0.0.1',
      ssl: {
        enabled: true,
        certificate: '/etc/letsencrypt/live/api.example.com/fullchain.pem',
        privateKey: '/etc/letsencrypt/live/api.example.com/privkey.pem',
      },
    });

    expect(fsMock.writeFile).toHaveBeenCalled();
    const writeCall = fsMock.writeFile.mock.calls[0];
    expect(writeCall[1]).toContain('listen 443 ssl');
    expect(writeCall[1]).toContain('ssl_certificate');
    expect(writeCall[1]).toContain('proxy_pass http://127.0.0.1:3000');
  });
});
