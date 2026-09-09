/**
 * WebsiteService — R3-H1 command injection regression tests
 *
 * Fix: `deployGit()` interpolated `git clone ${website.gitRepo}` directly into
 * a shell string with no validation → command injection. Now `_validateGitRepo()`
 * rejects shell metacharacters before any exec, and `git clone` runs through
 * execFile with an args array (no shell).
 *
 * All cases throw BEFORE any DB/fs/exec is reached, so no DB is required.
 */

// ── Environment setup (MUST be before app imports) ──
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect } from '@jest/globals';

// ── Mock the Website model (native-ESM style) ──
jest.unstable_mockModule('../src/models/Website.js', () => ({
  default: {
    findById: jest.fn(),
  },
}));

const { default: websiteService } = await import('../src/modules/websites/websites.service.js');
const Website = (await import('../src/models/Website.js')).default;

describe('WebsiteService._validateGitRepo — accepts legitimate URLs', () => {
  test.each([
    ['https://github.com/user/repo.git'],
    ['https://gitlab.com/org/project'],
    ['http://example.com:8080/repo'],
    ['git@github.com:user/repo.git'],
    ['ssh://git@example.com:2222/path/repo.git'],
    ['git://example.com/repo.git'],
    ['file:///var/www/repo'],
    // scp-like SSH URLs with non-`git` usernames (self-hosted deploy keys)
    ['deploy@git.example.com:/srv/app.git'],
    ['git@gitlab.example.com:team/app.git'],
  ])('accepts %s', (url) => {
    expect(websiteService._validateGitRepo(url)).toBe(url);
  });

  test('empty string / undefined means "no repo" and is allowed', () => {
    expect(websiteService._validateGitRepo('')).toBe('');
    expect(websiteService._validateGitRepo(undefined)).toBe('');
    expect(websiteService._validateGitRepo(null)).toBe('');
  });
});

describe('WebsiteService._validateGitRepo — rejects command injection payloads', () => {
  test.each([
    ['semicolon chain', 'https://github.com/x; rm -rf /'],
    ['command substitution', 'https://github.com/x $(whoami)'],
    ['backticks', 'https://github.com/x `id`'],
    ['pipe', 'https://github.com/x | cat /etc/passwd'],
    ['ampersand', 'https://github.com/x && touch /tmp/pwned'],
    ['double quote break', 'https://github.com/x" ; id'],
    // P0 regression payload: single-quote + semicolon + rm + hash comment
    ['quote-hash chain', "https://github.com/x'; rm -rf / #"],
    ['whitespace args', 'https://github.com/x --upload-pack=id'],
    ['newline injection', 'https://github.com/x\nrm -rf /'],
    ['query string', 'https://github.com/x/repo.git?ref=main'],
    ['ampersand in query', 'https://github.com/x/repo.git&x=1'],
    ['protocol-relative URL', '//github.com/user/repo.git'],
    ['IPv6 literal', 'https://[::1]:8443/repo.git'],
  ])('rejects %s payload', (_name, payload) => {
    expect(() => websiteService._validateGitRepo(payload)).toThrow(/invalid characters|valid https\/http\/ssh\/git URL/i);
  });

  test('rejects non-URL strings (no known scheme)', () => {
    expect(() => websiteService._validateGitRepo('github.com/user/repo')).toThrow(/valid https\/http\/ssh\/git URL/i);
    expect(() => websiteService._validateGitRepo('just-a-path')).toThrow(/valid https\/http\/ssh\/git URL/i);
  });

  test('rejects empty-adjacent strings after trim', () => {
    expect(() => websiteService._validateGitRepo('   ; rm -rf /')).toThrow();
  });

  test('rejects non-string values', () => {
    expect(() => websiteService._validateGitRepo(123)).toThrow(/must be a string/);
    expect(() => websiteService._validateGitRepo(['https://github.com/x'])).toThrow(/must be a string/);
  });

  test('rejects over-long URLs (> 512 chars)', () => {
    const long = 'https://github.com/' + 'a'.repeat(600);
    expect(() => websiteService._validateGitRepo(long)).toThrow(/too long/);
  });
});

describe('WebsiteService.deployGit — blocks injection before any exec', () => {
  test('throws validation error when stored gitRepo is malicious', async () => {
    Website.findById.mockResolvedValue({
      id: 'w-1',
      gitRepo: 'https://github.com/x; rm -rf /',
      rootDirectory: '/var/www/x',
    });

    await expect(websiteService.deployGit('w-1')).rejects.toThrow(/invalid characters/i);
    // The malicious repo must be rejected before reaching fs/exec — no git command runs.
  });

  test('throws "Website or Git Repo not found" when gitRepo missing', async () => {
    Website.findById.mockResolvedValue({ id: 'w-2', gitRepo: '', rootDirectory: '/var/www/x' });
    await expect(websiteService.deployGit('w-2')).rejects.toThrow(/Website or Git Repo not found/);
  });
});

describe('WebsiteService.updateWebsite — rejects malicious gitRepo at write point', () => {
  test('throws validation error when update payload contains injection payload', async () => {
    Website.findById.mockResolvedValue({
      id: 'w-3',
      domain: 'example.com',
      gitRepo: '',
      rootDirectory: '/var/www/example.com',
    });

    await expect(websiteService.updateWebsite('w-3', { gitRepo: 'https://x; touch /tmp/pwn' }))
      .rejects.toThrow(/invalid characters/i);
  });

  test('accepts a legitimate gitRepo in update payload', async () => {
    Website.findById.mockResolvedValue({
      id: 'w-4',
      domain: 'example.com',
      gitRepo: '',
      rootDirectory: '/var/www/example.com',
    });
    Website.findById.mockImplementation(async () => ({
      id: 'w-4',
      domain: 'example.com',
      gitRepo: '',
      rootDirectory: '/var/www/example.com',
    }));

    // findByIdAndUpdate is not mocked → we only assert validation passes by
    // catching the *next* failure (missing findByIdAndUpdate is not defined);
    // use a valid repo that passes validation and stops before DB write.
    Website.findByIdAndUpdate = jest.fn().mockResolvedValue({ id: 'w-4', gitRepo: 'https://github.com/user/repo.git' });

    const result = await websiteService.updateWebsite('w-4', { gitRepo: 'https://github.com/user/repo.git' });
    expect(result.gitRepo).toBe('https://github.com/user/repo.git');
  });
});

describe('WebsiteService Nginx Configuration Editor', () => {
  test('getNginxConfig throws error if website not found', async () => {
    Website.findById.mockResolvedValue(null);
    await expect(websiteService.getNginxConfig('nonexistent')).rejects.toThrow('Website not found');
  });

  test('saveNginxConfig throws error if website not found', async () => {
    Website.findById.mockResolvedValue(null);
    await expect(websiteService.saveNginxConfig('nonexistent', 'server {}')).rejects.toThrow('Website not found');
  });

  test('saveNginxConfig throws error if content is not string', async () => {
    Website.findById.mockResolvedValue({ id: 'w-1', domain: 'test.com' });
    await expect(websiteService.saveNginxConfig('w-1', 12345)).rejects.toThrow('Configuration content must be a string');
  });
});

describe('WebsiteService Logs Viewer', () => {
  test('getWebsiteLogs throws error if website not found', async () => {
    Website.findById.mockResolvedValue(null);
    await expect(websiteService.getWebsiteLogs('nonexistent')).rejects.toThrow('Website not found');
  });

  test('getWebsiteLogs returns deploy history when type is deploy', async () => {
    Website.findById.mockResolvedValue({
      id: 'w-1',
      domain: 'example.com',
      settings: {
        lastDeployLogs: ['Cloning repo...', 'npm install', 'Build finished'],
        lastDeployTime: '2026-09-07T00:00:00.000Z',
      },
    });

    const res = await websiteService.getWebsiteLogs('w-1', 'deploy');
    expect(res.type).toBe('deploy');
    expect(res.lines).toEqual(['Cloning repo...', 'npm install', 'Build finished']);
    expect(res.timestamp).toBe('2026-09-07T00:00:00.000Z');
    expect(res.empty).toBe(false);
  });

  test('getWebsiteLogs handles empty deploy history gracefully', async () => {
    Website.findById.mockResolvedValue({
      id: 'w-2',
      domain: 'example.com',
      settings: {},
    });

    const res = await websiteService.getWebsiteLogs('w-2', 'deploy');
    expect(res.type).toBe('deploy');
    expect(res.empty).toBe(true);
    expect(res.lines[0]).toMatch(/no deployment history/i);
  });

  test('getWebsiteLogs returns empty message if log file does not exist', async () => {
    Website.findById.mockResolvedValue({
      id: 'w-3',
      domain: 'no-log-domain-test.local',
    });

    const res = await websiteService.getWebsiteLogs('w-3', 'access', 50);
    expect(res.type).toBe('access');
    expect(res.empty).toBe(true);
    expect(res.lines[0]).toMatch(/does not exist/i);
  });

  test('clearWebsiteLogs throws error if website not found', async () => {
    Website.findById.mockResolvedValue(null);
    await expect(websiteService.clearWebsiteLogs('nonexistent')).rejects.toThrow('Website not found');
  });

  test('clearWebsiteLogs clears deploy history', async () => {
    Website.findById.mockResolvedValue({
      id: 'w-4',
      domain: 'deploy-clean.local',
      settings: { lastDeployLogs: ['log 1'] },
    });
    Website.findByIdAndUpdate = jest.fn().mockResolvedValue({});

    const res = await websiteService.clearWebsiteLogs('w-4', 'deploy');
    expect(res.success).toBe(true);
    expect(res.message).toBe('Deployment logs cleared');
  });

  test('clearWebsiteLogs handles non-existent log file gracefully', async () => {
    Website.findById.mockResolvedValue({
      id: 'w-5',
      domain: 'no-file-clear.local',
    });

    const res = await websiteService.clearWebsiteLogs('w-5', 'error');
    expect(res.success).toBe(true);
    expect(res.message).toMatch(/does not exist or is already empty/i);
  });
});

describe('WebsiteService._validateTargetHost & Proxy Configuration', () => {
  test.each([
    ['127.0.0.1', '127.0.0.1'],
    ['192.168.1.100', '192.168.1.100'],
    ['10.0.0.5', '10.0.0.5'],
    ['172.16.0.2', '172.16.0.2'],
    ['[::1]', '[::1]'],
    ['backend.local', 'backend.local'],
    ['api-service.internal', 'api-service.internal'],
    ['', '127.0.0.1'],
    [null, '127.0.0.1'],
    [undefined, '127.0.0.1'],
  ])('accepts valid targetHost: %s -> %s', (input, expected) => {
    expect(websiteService._validateTargetHost(input)).toBe(expected);
  });

  test.each([
    ['semicolon injection', '127.0.0.1; rm -rf /'],
    ['newline injection', '127.0.0.1\nproxy_set_header X-Pwned 1'],
    ['space injection', '127.0.0.1 8080'],
    ['quotes injection', '127.0.0.1"'],
    ['curly braces injection', '127.0.0.1}'],
  ])('rejects malicious targetHost: %s', (_, input) => {
    expect(() => websiteService._validateTargetHost(input)).toThrow('Target host contains invalid characters');
  });

  test('updateWebsite persists targetHost and validates it', async () => {
    Website.findById.mockResolvedValue({
      id: 'w-proxy-1',
      domain: 'proxy.local',
      type: 'proxy',
      port: 3000,
      targetHost: '127.0.0.1',
      settings: { customNginx: true },
    });
    Website.findByIdAndUpdate = jest.fn().mockImplementation((id, data) => ({
      id,
      ...data,
    }));

    const updated = await websiteService.updateWebsite('w-proxy-1', { targetHost: '192.168.1.50' });
    expect(updated.targetHost).toBe('192.168.1.50');

    await expect(websiteService.updateWebsite('w-proxy-1', { targetHost: '192.168.1.50; injection' }))
      .rejects.toThrow('Target host contains invalid characters');
  });
});

