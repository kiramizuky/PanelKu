/**
 * Sprint 1 — Updater against real temporary Git repositories.
 *
 * Scenarios:
 *   - untracked file conflicts with the incoming commit (quarantined)
 *   - npm install failure (update fails AND rolls back)
 *   - divergent local commit (git pull conflict → fetch + hard reset)
 *   - explicit rollback to the previous commit
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.PANELKU_UPDATE_SUPERVISOR = 'false';

import { jest, describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'panelku-update-repo-'));
const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'panelku-update-storage-'));
const remoteRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'panelku-update-remote-'));
const remoteDir = path.join(remoteRoot, 'remote.git');

process.env.PANELKU_HOME = repoDir;
process.env.PANELKU_STORAGE = storageDir;

const { default: updaterService } = await import('../src/modules/updater/updater.service.js');

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
};

async function git(args, cwd, allowFailure = false) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      env: GIT_ENV,
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    if (allowFailure) return (err.stdout || err.stderr || err.message || '').toString();
    throw new Error(`git ${args.join(' ')} failed: ${err.stderr || err.message}`);
  }
}

function normalizeGitCommand(cmd) {
  return cmd
    .replace(/\s*2>&1\s*$/, '')
    .replace(/\s*2>\/dev\/null\s*$/, '');
}

async function runGitShell(cmd, opts = {}) {
  const clean = normalizeGitCommand(cmd);
  try {
    const { stdout, stderr } = await execAsync(clean, {
      cwd: opts.cwd || repoDir,
      timeout: opts.timeout || 120000,
      maxBuffer: 10 * 1024 * 1024,
      env: GIT_ENV,
    });
    return stdout || stderr || '';
  } catch (err) {
    return `[ERROR] ${[err.stdout, err.stderr, err.message].filter(Boolean).join('\\n').toString().trim()}`;
  }
}

async function runGitChecked(cmd, opts = {}) {
  const clean = normalizeGitCommand(cmd);
  try {
    const { stdout, stderr } = await execAsync(clean, {
      cwd: opts.cwd || repoDir,
      timeout: opts.timeout || 120000,
      maxBuffer: 10 * 1024 * 1024,
      env: GIT_ENV,
    });
    return (stdout || stderr || '').toString();
  } catch (err) {
    throw new Error([err.stdout, err.stderr, err.message].filter(Boolean).join('\\n').toString().trim());
  }
}

async function addRemoteCommit(files, message) {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'panelku-update-upstream-'));
  try {
    await git(['clone', '--branch', 'main', remoteDir, workDir], os.tmpdir());
    await git(['config', 'user.email', 'upstream@example.com'], workDir);
    await git(['config', 'user.name', 'Upstream'], workDir);
    for (const [relative, content] of Object.entries(files)) {
      const full = path.join(workDir, relative);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, 'utf8');
    }
    await git(['add', '-A'], workDir);
    await git(['commit', '-m', message], workDir);
    await git(['push', 'origin', 'main'], workDir);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

async function resetLocal() {
  await git(['fetch', 'origin'], repoDir);
  await git(['checkout', '-B', 'main', 'origin/main'], repoDir);
  await git(['reset', '--hard', 'origin/main'], repoDir);
  await git(['clean', '-fd'], repoDir);
}

let npmShouldFail = false;
let npmCalls = 0;
let originalRunCommand;
let originalRunChecked;

beforeAll(async () => {
  await git(['init'], repoDir);
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], repoDir);
  await git(['config', 'user.email', 'panel@example.com'], repoDir);
  await git(['config', 'user.name', 'Panel Test'], repoDir);

  await fs.writeFile(
    path.join(repoDir, 'package.json'),
    JSON.stringify({ name: 'panelku-test', version: '1.0.0' }, null, 2),
    'utf8'
  );
  await git(['add', '-A'], repoDir);
  await git(['commit', '-m', 'initial'], repoDir);

  await git(['init', '--bare', remoteDir], os.tmpdir());
  await git(['remote', 'add', 'origin', remoteDir], repoDir);
  await git(['push', '-u', 'origin', 'main'], repoDir);
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], remoteDir);

  originalRunCommand = updaterService._runCommand.bind(updaterService);
  originalRunChecked = updaterService._runChecked.bind(updaterService);

  jest.spyOn(updaterService, '_runCommand').mockImplementation(async (cmd, opts = {}) => {
    if (cmd.includes('safe.directory')) return '';
    if (/^npm /.test(cmd)) return 'mocked npm';
    if (/systemctl|pm2/.test(cmd)) return '';
    if (/^git /.test(cmd)) return runGitShell(cmd, opts);
    return originalRunCommand(cmd, opts);
  });

  jest.spyOn(updaterService, '_runChecked').mockImplementation(async (cmd, opts = {}) => {
    if (/^npm /.test(cmd)) {
      npmCalls += 1;
      if (npmShouldFail && npmCalls === 1) {
        throw new Error('npm registry unreachable');
      }
      return 'mocked npm install';
    }
    if (/^git /.test(cmd)) return runGitChecked(cmd, opts);
    return originalRunChecked(cmd, opts);
  });

  jest.spyOn(updaterService, 'createPreUpdateBackup').mockResolvedValue({
    name: 'pre-update-test',
    file: path.join(storageDir, 'pre-update-test.tar.gz'),
    size: 1024,
  });
  jest.spyOn(updaterService, 'rebuildNativeModules').mockResolvedValue({
    success: true,
    sqliteOk: true,
    ptyOk: true,
    log: 'native mocked',
  });
  jest.spyOn(updaterService, '_verifyBoot').mockResolvedValue(undefined);
  jest.spyOn(updaterService, 'restartPanel').mockResolvedValue(true);
});

beforeEach(async () => {
  npmShouldFail = false;
  npmCalls = 0;
  await resetLocal();
});

afterAll(async () => {
  jest.restoreAllMocks();
  await fs.rm(repoDir, { recursive: true, force: true });
  await fs.rm(storageDir, { recursive: true, force: true });
  await fs.rm(remoteRoot, { recursive: true, force: true });
});

describe('Updater — Git scenarios', () => {
  test('quarantines an untracked file that blocks the incoming commit', async () => {
    await addRemoteCommit({ 'plugins/foo.js': 'module.exports = "remote";\n' }, 'add plugin');

    const localFile = path.join(repoDir, 'plugins', 'foo.js');
    await fs.mkdir(path.dirname(localFile), { recursive: true });
    await fs.writeFile(localFile, 'module.exports = "local";\n', 'utf8');

    const result = await updaterService.performUpdate({
      branch: 'main',
      _internal: true,
      _deferRestart: true,
    });

    expect(result.success).toBe(true);
    expect(await fs.readFile(localFile, 'utf8')).toContain('remote');

    const backupRoot = path.join(storageDir, 'update-backup');
    const dirs = await fs.readdir(backupRoot, { withFileTypes: true });
    const quarantine = dirs.find((d) => d.isDirectory());
    expect(quarantine).toBeTruthy();
    const moved = await fs.readFile(path.join(backupRoot, quarantine.name, 'plugins', 'foo.js'), 'utf8');
    expect(moved).toContain('local');
  });

  test('fails and rolls back when npm install fails', async () => {
    const previous = (await git(['rev-parse', 'HEAD'], repoDir)).trim();
    await addRemoteCommit(
      { 'package.json': JSON.stringify({ name: 'panelku-test', version: '2.0.0' }, null, 2) },
      'bump to 2.0.0'
    );

    npmShouldFail = true;
    const result = await updaterService.performUpdate({
      branch: 'main',
      _internal: true,
      _deferRestart: true,
    });

    expect(result.success).toBe(false);
    expect(result.log).toContain('Dependency installation failed');

    const head = (await git(['rev-parse', 'HEAD'], repoDir)).trim();
    expect(head).toBe(previous);
  });

  test('recovers from a divergent local commit via fetch + hard reset', async () => {
    await fs.writeFile(
      path.join(repoDir, 'package.json'),
      JSON.stringify({ name: 'panelku-test', version: '1.5.0-local' }, null, 2),
      'utf8'
    );
    await git(['add', 'package.json'], repoDir);
    await git(['commit', '-m', 'local customisation'], repoDir);
    const localCommit = (await git(['rev-parse', 'HEAD'], repoDir)).trim();

    await addRemoteCommit(
      { 'package.json': JSON.stringify({ name: 'panelku-test', version: '3.0.0' }, null, 2) },
      'remote bump to 3.0.0'
    );

    const bundleSpy = jest.spyOn(updaterService, '_createRecoveryBundle');
    const result = await updaterService.performUpdate({
      branch: 'main',
      _internal: true,
      _deferRestart: true,
    });
    bundleSpy.mockRestore();

    expect(result.success).toBe(true);
    expect(result.log).toContain('Standard git pull failed');
    expect(result.previousCommit).toBe(localCommit);

    const remoteHead = (await git(['rev-parse', 'origin/main'], repoDir)).trim();
    expect((await git(['rev-parse', 'HEAD'], repoDir)).trim()).toBe(remoteHead);
  });

  test('explicit rollback restores the previous commit', async () => {
    const previous = (await git(['rev-parse', 'HEAD'], repoDir)).trim();
    await addRemoteCommit(
      { 'package.json': JSON.stringify({ name: 'panelku-test', version: '4.0.0' }, null, 2) },
      'bump to 4.0.0'
    );

    const update = await updaterService.performUpdate({
      branch: 'main',
      _internal: true,
      _deferRestart: true,
    });
    expect(update.success).toBe(true);
    expect((await git(['rev-parse', 'HEAD'], repoDir)).trim()).not.toBe(previous);

    const rollback = await updaterService.performRollback({
      commit: previous,
      _deferRestart: true,
    });
    expect(rollback.success).toBe(true);
    expect((await git(['rev-parse', 'HEAD'], repoDir)).trim()).toBe(previous);
  });
});

describe('Updater — Supervisor state', () => {
  const stateFile = path.join(storageDir, 'update_state.json');

  test('boot during a supervised restart leaves final success to the worker', async () => {
    const now = new Date().toISOString();
    await fs.writeFile(stateFile, JSON.stringify({
      id: 'upd_test_restart',
      status: 'restarting',
      phase: 'restarting',
      supervised: true,
      restartPending: true,
      startedAt: now,
      updatedAt: now,
    }), 'utf8');

    await updaterService.markBootVerified();
    const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));

    expect(state.status).toBe('restarting');
    expect(state.phase).toBe('health-check');
    expect(state.bootSeenAt).toBeTruthy();
  });

  test('a fresh supervised running state is not marked interrupted', async () => {
    const now = new Date().toISOString();
    await fs.writeFile(stateFile, JSON.stringify({
      id: 'upd_test_running',
      status: 'running',
      phase: 'updating',
      supervised: true,
      startedAt: now,
      updatedAt: now,
    }), 'utf8');

    await updaterService.markBootVerified();
    const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));

    expect(state.status).toBe('running');
    expect(state.bootSeenAt).toBeTruthy();
  });

  test('a stale supervised running state is marked interrupted', async () => {
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await fs.writeFile(stateFile, JSON.stringify({
      id: 'upd_test_stale',
      status: 'running',
      phase: 'updating',
      supervised: true,
      startedAt: old,
      updatedAt: old,
    }), 'utf8');

    await updaterService.markBootVerified();
    const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));

    expect(state.status).toBe('interrupted');
    expect(state.restartPending).toBe(false);
  });
});
