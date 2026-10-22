/**
 * Updater Service — Auto-Updater Panel & Rollback Engine
 *
 * Fase 16: Automatic Panel Updates with Health Check, Backup Before Update,
 *          One-Click Rollback, Update Channels (stable/beta/dev),
 *          Scheduled Auto-Update, and Full Rollback History.
 *
 * Architecture:
 *   - updateHistory: stored in storage/update_history.json
 *   - rollbackPoints: symlinks or stored git hashes in storage/panel.json
 *   - Backup sebelum update: tar.gz dari seluruh direktori panel (excl node_modules, storage)
 */

import { exec, spawn } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import logger from '../../config/logger.js';
import { getAppRoot, getStorageDir } from '../../config/paths.js';

const execAsync = util.promisify(exec);

// ── Paths (resolved from the module location, NOT process.cwd) ─────
const PANEL_DIR       = getAppRoot();
const STORAGE_DIR     = getStorageDir();
const HISTORY_FILE    = path.join(STORAGE_DIR, 'update_history.json');
const STATE_FILE      = path.join(STORAGE_DIR, 'update_state.json');
const PANEL_CONFIG    = path.join(STORAGE_DIR, 'panel.json');
const SYSTEM_CONFIG   = path.join(STORAGE_DIR, 'system.json');
const BACKUP_DIR      = path.join(STORAGE_DIR, 'panel-backups');
const QUARANTINE_DIR  = path.join(STORAGE_DIR, 'update-backup');
const SUPERVISOR_SCRIPT = path.join(PANEL_DIR, 'scripts', 'panel-update.sh');
const SUPERVISOR_STALE_MS = 30 * 60 * 1000;

class UpdaterService {
  constructor() {
    this._running = false;      // guards performUpdate (single update at a time)
    this._activeJob = null;     // { id, status, startedAt, log, ... }
    this._lastJob = null;
    this._initStorage();
  }

  // ── Initialization ────────────────────────────────────────────────
  async _initStorage() {
    try {
      await fs.mkdir(BACKUP_DIR, { recursive: true });
      await fs.mkdir(QUARANTINE_DIR, { recursive: true });
      await fs.mkdir(STORAGE_DIR, { recursive: true });
    } catch { /* ignore */ }
  }

  // ── Helpers ────────────────────────────────────────────────────────
  async _readJSON(filePath, fallback = {}) {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  async _writeJSON(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  // ── Job status / persisted update state ──────────────────────────
  async _writeState(state) {
    try {
      await this._writeJSON(STATE_FILE, {
        ...state,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.warn(`Updater: could not persist update state: ${err.message}`);
    }
  }

  async _readState() {
    return this._readJSON(STATE_FILE, null);
  }

  _stateIsStale(state) {
    const stamp = Date.parse(state?.updatedAt || state?.startedAt || '');
    return !Number.isFinite(stamp) || Date.now() - stamp > SUPERVISOR_STALE_MS;
  }

  isUpdateRunning() {
    return this._running;
  }

  /**
   * Start an update in the background and return immediately.
   *
   * On Linux the real work is handed to a detached supervisor
   * (`scripts/panel-update.sh`) so it survives the panel restart, polls
   * /api/health and can roll back when the new commit does not boot within
   * 120 seconds. On Windows/tests we keep using the in-process job.
   */
  async startUpdateJob(options = {}) {
    if (this._running || this._activeJob) {
      const err = new Error('An update is already in progress');
      err.code = 'UPDATE_IN_PROGRESS';
      err.statusCode = 409;
      throw err;
    }

    const job = {
      id: `upd_${Date.now().toString(36)}`,
      status: 'running',
      phase: 'starting',
      startedAt: new Date().toISOString(),
      log: 'Update started. This can take several minutes (git + npm + native build)...',
      supervised: false,
    };

    this._running = true;
    this._activeJob = job;
    this._lastJob = job;

    if (this._supervisorEnabled()) {
      job.supervised = true;
      await this._writeState(job);
      try {
        await this._spawnSupervisor(job, options);
        void this._monitorSupervisor(job);
        return { jobId: job.id, status: job.status, startedAt: job.startedAt, supervised: true };
      } catch (err) {
        logger.warn(`Updater: supervisor could not start (${err.message}); falling back to in-process update`);
        job.supervised = false;
        job.phase = 'updating';
        job.log = `${job.log}\n⚠️ Supervisor unavailable: ${err.message}\nContinuing in-process.`;
      }
    }

    await this._writeState(job);
    this._runJobInProcess(job, options);
    return { jobId: job.id, status: job.status, startedAt: job.startedAt };
  }

  _supervisorEnabled() {
    if (process.env.PANELKU_UPDATE_SUPERVISOR === 'false') return false;
    if (process.platform === 'win32' || process.env.NODE_ENV === 'test') return false;
    // Containers cannot restart themselves with systemctl/pm2; let the
    // orchestrator do it and use the in-process fallback.
    if (existsSync('/.dockerenv')) return false;
    return existsSync(SUPERVISOR_SCRIPT);
  }

  async _spawnSupervisor(job, options = {}) {
    const info = await this.getVersionInfo();
    const branch = this._validateGitRef(options.branch || info.branch || 'master');
    const channel = this._validateChannel(options.channel || info.channel || 'stable');
    const previousCommit = info.commit || '';
    const healthTimeout = Math.min(
      Math.max(parseInt(process.env.PANELKU_UPDATE_HEALTH_TIMEOUT) || 120000, 30000),
      600000
    );

    const args = [
      '--job-id', job.id,
      '--branch', branch,
      '--channel', channel,
      '--previous-commit', previousCommit,
      '--panel-dir', PANEL_DIR,
      '--storage-dir', STORAGE_DIR,
      '--state-file', STATE_FILE,
      '--service', process.env.PANELKU_SERVICE || 'panelku',
      '--port', String(parseInt(process.env.PORT) || 23456),
      '--health-timeout', String(healthTimeout),
    ];

    const env = {
      ...process.env,
      PANELKU_HOME: PANEL_DIR,
      PANELKU_STORAGE: STORAGE_DIR,
      PANELKU_NODE_BIN: process.execPath || 'node',
    };

    // systemd kills the whole service cgroup on restart. Run the supervisor in
    // its own transient unit so it survives `systemctl restart panelku`.
    const systemdRun = (await this._runCommand('which systemd-run 2>/dev/null').catch(() => '')).trim();
    if (systemdRun && !systemdRun.includes('[ERROR]')) {
      const unit = `panelku-update-${job.id}`.replace(/[^a-zA-Z0-9_.-]/g, '-');
      const child = spawn(systemdRun, [
        '--unit', unit,
        '--collect',
        '--quiet',
        '--property=Type=oneshot',
        `--property=WorkingDirectory=${PANEL_DIR}`,
        // systemd-run does not inherit the caller's environment.
        `--setenv=PANELKU_HOME=${PANEL_DIR}`,
        `--setenv=PANELKU_STORAGE=${STORAGE_DIR}`,
        `--setenv=PANELKU_NODE_BIN=${process.execPath || 'node'}`,
        `--setenv=NODE_ENV=${process.env.NODE_ENV || 'production'}`,
        'bash', SUPERVISOR_SCRIPT, ...args,
      ], {
        cwd: PANEL_DIR,
        env,
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      logger.info(`Updater: detached supervisor started in systemd unit ${unit}`);
      return;
    }

    const child = spawn('bash', [SUPERVISOR_SCRIPT, ...args], {
      cwd: PANEL_DIR,
      env,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    logger.info('Updater: detached supervisor started (no systemd-run available)');
  }

  /**
   * Mirror the supervisor's persisted state into the in-memory job so
   * /api/updater/status stays useful while the panel is still up.
   */
  async _monitorSupervisor(job) {
    const deadline = Date.now() + 45 * 60 * 1000;
    try {
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const state = await this._readState();
        if (!state || state.id !== job.id) continue;

        Object.assign(job, state);
        if (['success', 'failed', 'rolled_back', 'interrupted'].includes(state.status)) {
          this._running = false;
          this._activeJob = null;
          return;
        }
      }
      logger.warn('Updater: supervisor status did not reach a terminal state within 45 minutes');
    } catch (err) {
      logger.warn(`Updater: supervisor monitor stopped: ${err.message}`);
    }
  }

  _runJobInProcess(job, options) {
    // Fire-and-forget: errors are captured into the job state.
    void (async () => {
      try {
        const result = await this.performUpdate({ ...options, _internal: true });
        Object.assign(job, {
          status: result.success ? 'success' : 'failed',
          phase: result.success ? 'done' : 'failed',
          finishedAt: new Date().toISOString(),
          log: result.log || job.log,
          result,
        });
      } catch (err) {
        Object.assign(job, {
          status: 'failed',
          phase: 'failed',
          finishedAt: new Date().toISOString(),
          error: err.message,
          log: `${job.log || ''}\n❌ ${err.message}`.trim(),
        });
      } finally {
        this._running = false;
        this._activeJob = null;
        await this._writeState({
          ...job,
          restartPending: job.status === 'success',
          expectedCommit: job.result?.commit || null,
          previousCommit: job.result?.previousCommit || null,
        });
      }
    })();
  }

  async getUpdateStatus() {
    const persisted = await this._readState();

    if (this._activeJob?.supervised) {
      if (persisted && persisted.id === this._activeJob.id) {
        return { ...this._activeJob, ...persisted };
      }
      return this._activeJob;
    }

    if (this._activeJob) return this._activeJob;
    if (this._lastJob) return this._lastJob;
    return persisted || { status: 'idle' };
  }

  /**
   * Called on startup: if the previous run ended with a successful update and a
   * pending restart, confirm that the new commit is actually running.
   */
  async markBootVerified() {
    try {
      const state = await this._readState();
      if (!state) return;

      // The process died mid-update (crash, OOM, manual restart). There is no
      // worker anymore; mark it so the UI does not poll a "running" job forever.
      if (state.status === 'running') {
        // A detached supervisor is still doing the work. Only declare it
        // interrupted when the state file has not been touched for 30 minutes.
        if (state.supervised && !this._stateIsStale(state)) {
          await this._writeState({ ...state, bootSeenAt: new Date().toISOString() });
          return;
        }
        await this._writeState({
          ...state,
          status: 'interrupted',
          phase: 'interrupted',
          finishedAt: new Date().toISOString(),
          restartPending: false,
          error: 'Panel restarted while the update job was running',
        });
        return;
      }

      // Supervisor restarted the panel and is polling /api/health. Let it
      // decide success/rollback; bootstrap only records that the new process
      // came up.
      if (state.status === 'restarting' && state.supervised) {
        await this._writeState({
          ...state,
          phase: 'health-check',
          bootSeenAt: new Date().toISOString(),
        });
        return;
      }

      if (state.status !== 'success' || !state.restartPending) return;

      const current = (await this._runCommand('git rev-parse HEAD 2>/dev/null')).trim();
      if (state.expectedCommit && current && !current.startsWith(state.expectedCommit)) {
        logger.warn(`Updater: boot commit mismatch (expected ${state.expectedCommit.slice(0, 8)}, got ${current.slice(0, 8)})`);
        await this._writeState({ ...state, restartPending: false, bootMismatch: true, bootCheckedAt: new Date().toISOString() });
        return;
      }

      await this._writeState({
        ...state,
        restartPending: false,
        bootVerifiedAt: new Date().toISOString(),
        runningCommit: current || null,
      });
      logger.info('Updater: post-restart boot verification succeeded');
    } catch (err) {
      logger.warn(`Updater: boot verification skipped: ${err.message}`);
    }
  }

  // ── Git safety helpers ───────────────────────────────────────────
  _pullFailed(output = '') {
    const s = String(output).toLowerCase();
    return (
      output.includes('[ERROR]') ||
      s.includes('error:') ||
      s.includes('fatal:') ||
      s.includes('aborting') ||
      s.includes('would be overwritten') ||
      s.includes('untracked working tree') ||
      s.includes('divergent branches') ||
      s.includes('not possible to fast-forward')
    );
  }

  /**
   * Parse the file list from git messages such as:
   *   error: The following untracked working tree files would be overwritten by merge:
   *       plugins/foo/index.js
   */
  _extractUntrackedConflicts(output = '') {
    const files = [];
    const lines = String(output).split(/\r?\n/);
    let collecting = false;

    for (const line of lines) {
      if (/would be (overwritten|removed) by (merge|checkout)/i.test(line)) {
        collecting = true;
        continue;
      }
      if (!collecting) continue;

      if (!line.trim()) {
        if (files.length) break;
        continue;
      }
      if (/^\s+/.test(line)) {
        files.push(line.trim());
      } else if (files.length) {
        break;
      }
    }

    return [...new Set(files)];
  }

  /** Move untracked files that block a merge into storage/update-backup/<timestamp>/. */
  async _quarantineFiles(files, timestamp) {
    if (!files.length) return [];

    const destRoot = path.join(QUARANTINE_DIR, String(timestamp).replace(/[:.]/g, '-'));
    const moved = [];

    for (const rel of files) {
      const normalized = path.normalize(rel).replace(/^[/\\]+/, '');
      const src = path.resolve(PANEL_DIR, normalized);
      if (!src.startsWith(PANEL_DIR + path.sep)) continue; // path traversal guard

      try {
        const dest = path.join(destRoot, normalized);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.rename(src, dest);
        moved.push(normalized);
      } catch (err) {
        logger.warn(`Updater: could not quarantine ${normalized}: ${err.message}`);
      }
    }

    if (moved.length) {
      await fs.writeFile(
        path.join(destRoot, 'MANIFEST.txt'),
        `Quarantined before update at ${timestamp}\n\n${moved.join('\n')}\n`,
        'utf8'
      );
    }

    return moved;
  }

  /** Keep local commits + uncommitted changes recoverable before a hard reset. */
  async _createRecoveryBundle(timestamp) {
    const safeTs = String(timestamp).replace(/[:.]/g, '-');
    const file = path.join(BACKUP_DIR, `pre-update-${safeTs}.bundle`);
    try {
      await this._runChecked(`git bundle create "${file}" --all`, { cwd: PANEL_DIR });
      return file;
    } catch (err) {
      logger.warn(`Updater: recovery bundle skipped: ${err.message}`);
      return null;
    }
  }

  async _saveWorkingTreePatch(timestamp) {
    const dir = path.join(QUARANTINE_DIR, String(timestamp).replace(/[:.]/g, '-'));
    const file = path.join(dir, 'working-tree.patch');
    try {
      await fs.mkdir(dir, { recursive: true });
      await this._runCommand(`git diff --binary > "${file}"`, { cwd: PANEL_DIR });
      return file;
    } catch {
      return null;
    }
  }

  /**
   * Verify the new build before declaring success. Catches broken imports,
   * missing dependencies and native addon ABI mismatches — not just syntax.
   */
  async _verifyBoot(log = []) {
    const node = process.execPath || 'node';

    await this._runChecked(`"${node}" --check src/app.js`, { cwd: PANEL_DIR, timeout: 30000 });

    // Importing the whole app module graph catches missing modules/files.
    await this._runChecked(
      `"${node}" --input-type=module -e "await import('./src/app.js');"`,
      { cwd: PANEL_DIR, timeout: 120000 }
    );

    const native = await this._checkNativeModules();
    if (!native.sqliteOk) {
      throw new Error(`better-sqlite3 failed to load after update: ${native.sqliteError || 'unknown error'}`);
    }
    if (!native.ptyOk) {
      log.push(`   ⚠️ node-pty unavailable (Web Terminal disabled): ${native.ptyError || 'unknown error'}`);
    }
  }

  async _runCommand(cmd, options = {}) {
    try {
      if (process.platform === 'win32') {
        if (
          cmd.includes('systemctl') ||
          cmd.includes('apt-get') ||
          cmd.includes('dnf') ||
          cmd.includes('yum') ||
          cmd.includes('apk') ||
          cmd.includes('which make') ||
          cmd.includes('which apt-get') ||
          cmd.includes('which dnf') ||
          cmd.includes('which yum') ||
          cmd.includes('which apk') ||
          cmd.includes('ss -tlnp') ||
          cmd.includes('df -h')
        ) {
          return this._mockCommand(cmd);
        }
      }
      const { stdout, stderr } = await execAsync(cmd, { cwd: PANEL_DIR, timeout: 120000, maxBuffer: 10 * 1024 * 1024, ...options });
      return stdout || stderr || '';
    } catch (error) {
      if (process.platform === 'win32' || process.env.NODE_ENV === 'test') {
        const mocked = this._mockCommand(cmd);
        if (mocked) return mocked;
      }
      const output = [error.stdout, error.stderr, error.message]
        .filter(Boolean)
        .join('\n')
        .trim();
      return `[ERROR] ${output || error.message}`;
    }
  }

  /**
   * Like _runCommand, but THROWS on failure.
   *
   * Critical update steps (git/npm/rebuild) must never be reported as success
   * when the underlying command failed.
   */
  async _runChecked(cmd, options = {}) {
    try {
      const { stdout, stderr } = await execAsync(cmd, { cwd: PANEL_DIR, timeout: 300000, maxBuffer: 10 * 1024 * 1024, ...options });
      return (stdout || stderr || '').toString();
    } catch (error) {
      const output = [error.stdout, error.stderr, error.message]
        .filter(Boolean)
        .join('\n')
        .trim();
      throw new Error(output || error.message || `Command failed: ${cmd}`);
    }
  }

  _mockCommand(cmd) {
    if (cmd.includes('git rev-parse HEAD')) return 'abc123def456abc123def456abc123def456abc1\n';
    if (cmd.includes('git rev-parse --abbrev-ref HEAD') || cmd.includes('git branch --show-current')) return 'master\n';
    if (cmd.includes('git fetch')) return '';
    if (cmd.includes('git rev-list --count') || cmd.includes('git log HEAD..origin')) return '0\n';
    if (cmd.includes('git config --global --add safe.directory')) return '';
    if (cmd.includes('git checkout')) return '';
    if (cmd.includes('git pull')) return 'Already up to date.\n';
    if (cmd.includes('git reset')) return 'HEAD is now at abc123def\n';
    if (cmd.includes('git show origin')) return '3.6.0\n';
    if (cmd.includes('git diff')) return '';
    if (cmd.includes('npm install')) return 'added 0 packages, removed 0 packages, changed 0 packages\n';
    if (cmd.includes('node --check')) return '';
    if (cmd.includes('npm rebuild')) return 'rebuilt better-sqlite3 node-pty successfully\n';
    if (cmd.includes('--build-from-source')) return 'built from source successfully\n';
    if (cmd.includes('which make')) return '/usr/bin/make\n';
    if (cmd.includes('which apt-get')) return '/usr/bin/apt-get\n';
    if (cmd.includes('systemctl restart panelku')) return '';
    if (cmd.includes('ls -la')) return 'total 8\ndrwxr-xr-x 2 root root 4096 Jul 17 10:00 .\ndrwxr-xr-x 4 root root 4096 Jul 17 09:00 ..\n';
    if (cmd.includes('tail -n')) return 'Jul 17 10:00:01 server panelku[1234]: Panel started successfully\n';
    if (cmd.includes('tar -czf') || cmd.includes('tar -xzf')) return 'Archive processed successfully\n';
    if (cmd.includes('df -h')) return '/dev/sda1 50G 15G 35G 30% /\n';
    if (cmd.includes('ss -tlnp') || cmd.includes('netstat')) return 'LISTEN 0 511 0.0.0.0:23456 node\n';
    if (cmd.includes('ping')) return 'pong';
    return '';
  }

  /**
   * Validate a git branch/tag reference — alphanumeric, hyphens, dots, slashes.
   */
  _validateGitRef(ref) {
    if (!ref || typeof ref !== 'string') throw new Error('Invalid git reference');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._\-\/]*$/.test(ref)) {
      throw new Error('Invalid git reference: contains unsafe characters');
    }
    if (ref.length > 256) throw new Error('Git reference too long');
    return ref;
  }

  _validateCommitHash(hash) {
    if (!hash) return '';
    if (!/^[a-f0-9]{40}$/.test(hash) && !/^[a-f0-9]{64}$/.test(hash)) {
      throw new Error('Invalid commit hash format');
    }
    return hash;
  }

  _validateChannel(channel) {
    const valid = ['stable', 'beta', 'dev'];
    if (!valid.includes(channel)) throw new Error('Invalid update channel. Use: stable, beta, dev');
    return channel;
  }

  /**
   * Validate a backup filename — only alphanumeric, hyphens, underscores, dots.
   */
  _validateBackupName(name) {
    if (!name || typeof name !== 'string') throw new Error('Backup name required');
    if (!/^[a-zA-Z0-9._\-\s]+$/.test(name)) throw new Error('Invalid backup name');
    if (name.length > 200) throw new Error('Backup name too long');
    return name.trim();
  }

  // ── Native Modules (node-pty & better-sqlite3) ───────────────────
  /**
   * Verify native C++ addons (better-sqlite3 & node-pty).
   */
  async _checkNativeModules() {
    let sqliteOk = false;
    let sqliteError = null;
    let ptyOk = false;
    let ptyError = null;

    try {
      const bs = (await import('better-sqlite3')).default;
      const testDb = new bs(':memory:');
      testDb.prepare('SELECT 1').get();
      testDb.close();
      sqliteOk = true;
    } catch (err) {
      sqliteError = err.message;
    }

    try {
      const ptyMod = (await import('node-pty')).default || (await import('node-pty'));
      if (ptyMod && typeof ptyMod.spawn === 'function') {
        ptyOk = true;
      } else {
        ptyError = 'spawn function not available';
      }
    } catch (err) {
      ptyError = err.message;
    }

    return { sqliteOk, sqliteError, ptyOk, ptyError };
  }

  /**
   * Ensure build tools (make, gcc/g++, python3) exist on Linux servers.
   */
  async _ensureBuildTools(log = []) {
    if (process.platform === 'win32') return true;

    try {
      const checkTools = await this._runCommand('which make && (which g++ || which gcc) && (which python3 || which python)');
      if (!checkTools.includes('[ERROR]') && checkTools.trim()) {
        return true;
      }

      log.push('   ⚠️ Compiler or Python missing on server. Attempting automatic installation...');
      const checkApt = await this._runCommand('which apt-get');
      if (!checkApt.includes('[ERROR]') && checkApt.trim()) {
        log.push('   📦 Installing build-essential, python3, make, g++ via apt-get...');
        await this._runCommand('DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential python3 make g++ 2>&1');
      } else {
        const checkDnf = await this._runCommand('which dnf || which yum');
        if (!checkDnf.includes('[ERROR]') && checkDnf.trim()) {
          log.push('   📦 Installing make, gcc-c++, python3 via dnf/yum...');
          await this._runCommand('dnf install -y make gcc-c++ python3 2>&1 || yum install -y make gcc-c++ python3 2>&1');
        } else {
          const checkApk = await this._runCommand('which apk');
          if (!checkApk.includes('[ERROR]') && checkApk.trim()) {
            log.push('   📦 Installing build-base, python3, make, g++ via apk...');
            await this._runCommand('apk add --no-cache build-base python3 make g++ 2>&1');
          }
        }
      }
    } catch (err) {
      log.push(`   ⚠️ Build tools verification: ${err.message}`);
    }
    return true;
  }

  /**
   * Rebuild native dependencies (better-sqlite3 and node-pty) with fallback to --build-from-source.
   */
  async rebuildNativeModules(customLog = null) {
    const log = Array.isArray(customLog) ? customLog : [];
    log.push('🔨 [Native Modules] Verifying and rebuilding C++ addons...');

    await this._ensureBuildTools(log);

    // 1. Run npm rebuild
    log.push('   ⚙️ Executing npm rebuild better-sqlite3 node-pty...');
    const rebuildOut = await this._runCommand('npm rebuild better-sqlite3 node-pty 2>&1');
    if (rebuildOut && !rebuildOut.includes('[ERROR]')) {
      const summary = rebuildOut.trim().split('\n').slice(0, 3).join('\n   ');
      if (summary) log.push(`   ${summary}`);
    } else if (rebuildOut.includes('[ERROR]')) {
      log.push(`   ⚠️ npm rebuild warning: ${rebuildOut.replace('[ERROR]', '').trim().split('\n')[0]}`);
    }

    // 2. Check status
    let check = await this._checkNativeModules();

    // 3. Fallback for node-pty if not working
    if (!check.ptyOk) {
      log.push('   ⚠️ node-pty still unverified. Attempting fallback: npm install node-pty --build-from-source...');
      const ptySourceOut = await this._runCommand('npm install node-pty --build-from-source 2>&1');
      if (ptySourceOut && !ptySourceOut.includes('[ERROR]')) {
        const ptySummary = ptySourceOut.trim().split('\n').slice(0, 2).join('\n   ');
        if (ptySummary) log.push(`   ${ptySummary}`);
      }
    }

    // 4. Fallback for better-sqlite3 if not working
    if (!check.sqliteOk) {
      log.push('   ⚠️ better-sqlite3 unverified. Attempting fallback: npm install better-sqlite3 --build-from-source...');
      const bsSourceOut = await this._runCommand('npm install better-sqlite3 --build-from-source 2>&1');
      if (bsSourceOut && !bsSourceOut.includes('[ERROR]')) {
        const bsSummary = bsSourceOut.trim().split('\n').slice(0, 2).join('\n   ');
        if (bsSummary) log.push(`   ${bsSummary}`);
      }
    }

    // 5. Final re-verification
    check = await this._checkNativeModules();
    if (check.ptyOk) {
      log.push('   ✅ node-pty loaded successfully (Web Terminal available)');
    } else {
      log.push(`   ❌ node-pty failed to load: ${check.ptyError || 'unknown error'}`);
    }

    if (check.sqliteOk) {
      log.push('   ✅ better-sqlite3 verified successfully');
    } else {
      log.push(`   ❌ better-sqlite3 failed to load: ${check.sqliteError || 'unknown error'}`);
    }

    const success = check.sqliteOk && check.ptyOk;
    return {
      success,
      sqliteOk: check.sqliteOk,
      ptyOk: check.ptyOk,
      log: log.join('\n'),
    };
  }

  // ── Version Info ─────────────────────────────────────────────────
  async getVersionInfo() {
    const pkg = await this._readJSON(path.join(PANEL_DIR, 'package.json'), { version: '1.0.0' });
    const panelCfg = await this._readJSON(PANEL_CONFIG, {});
    const _systemCfg = await this._readJSON(SYSTEM_CONFIG, {});

    let activeBranch = 'master';
    let currentCommit = '';
    try {
      const branchOut = await this._runCommand('git rev-parse --abbrev-ref HEAD');
      if (!branchOut.includes('[ERROR]')) {
        activeBranch = branchOut.trim() || 'master';
        activeBranch = this._validateGitRef(activeBranch);
      }
    } catch { /* ignore */ }

    try {
      const commitOut = await this._runCommand('git rev-parse HEAD');
      if (!commitOut.includes('[ERROR]')) {
        currentCommit = commitOut.trim();
        currentCommit = this._validateCommitHash(currentCommit);
      }
    } catch { /* ignore */ }

    return {
      current: pkg.version || '1.0.0',
      lastUpdated: panelCfg.lastUpdated || null,
      branch: activeBranch,
      commit: currentCommit,
      channel: panelCfg.updateChannel || 'stable',
      autoUpdate: panelCfg.autoUpdate || { enabled: false, frequency: 'daily' },
      nodeVersion: process.version,
      os: process.platform,
    };
  }

  // ── Check for Updates ────────────────────────────────────────────
  async checkForUpdates() {
    const info = await this.getVersionInfo();
    let latest = info.current;
    let hasUpdate = false;
    let behindCount = 0;
    let changelogSummary = '';
    let diffStats = { files: 0, insertions: 0, deletions: 0 };
    let checkFailed = false;
    let checkError = null;

    try {
      const safeBranch = this._validateGitRef(info.branch);

      // Ensure safe directory is configured (scoped to the panel dir only)
      await this._runCommand(`git config --global --add safe.directory "${PANEL_DIR}"`).catch(() => {});

      // Fetch remote — a failure here MUST be surfaced, not reported as "up to date"
      const fetchOut = await this._runCommand('git fetch origin 2>&1');
      if (this._pullFailed(fetchOut)) {
        checkFailed = true;
        checkError = `git fetch failed: ${fetchOut.replace('[ERROR]', '').trim()}`;
        logger.warn(`Update check: ${checkError}`);
        return {
          ...info,
          latest,
          hasUpdate: false,
          behindCount: 0,
          changelogSummary,
          diffStats,
          checkFailed,
          checkError,
        };
      }

      // Count commits behind using cross-platform git rev-list
      let behindOut = await this._runCommand(
        `git rev-list --count HEAD..origin/${safeBranch}`
      );
      if (behindOut.includes('[ERROR]') || isNaN(parseInt(behindOut.trim()))) {
        // Fallback to git log
        behindOut = await this._runCommand(
          `git log HEAD..origin/${safeBranch} --oneline`
        );
        if (behindOut.includes('[ERROR]')) {
          checkFailed = true;
          checkError = `Cannot compare with origin/${safeBranch}: ${behindOut.replace('[ERROR]', '').trim()}`;
          behindCount = 0;
        } else {
          behindCount = behindOut.trim().split('\n').filter(Boolean).length;
        }
      } else {
        behindCount = parseInt(behindOut.trim()) || 0;
      }
      hasUpdate = behindCount > 0;

      if (hasUpdate) {
        // Get latest remote version directly from package.json and parse in Node
        const remoteVer = await this._runCommand(
          `git show origin/${safeBranch}:package.json`
        ).catch(() => '');

        let parsedVersion = '';
        if (remoteVer && !remoteVer.includes('[ERROR]')) {
          try {
            const parsed = JSON.parse(remoteVer.trim());
            parsedVersion = parsed.version;
          } catch {
            const match = remoteVer.match(/"version"\s*:\s*"([^"]+)"/);
            if (match) parsedVersion = match[1];
            else if (/^\d+\.\d+\.\d+/.test(remoteVer.trim())) parsedVersion = remoteVer.trim();
          }
        }
        latest = parsedVersion || `${info.current}+${behindCount}`;

        // Get changelog between versions
        const logOut = await this._runCommand(
          `git log HEAD..origin/${safeBranch} --oneline --no-decorate -n 20`
        );
        changelogSummary = logOut.includes('[ERROR]') ? '' : logOut.trim();

        // Get diff stats using built-in --shortstat
        const diffOut = await this._runCommand(
          `git diff HEAD..origin/${safeBranch} --shortstat`
        );
        const statMatch = diffOut.match(/(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/);
        if (statMatch) {
          diffStats = {
            files: parseInt(statMatch[1]) || 0,
            insertions: parseInt(statMatch[2]) || 0,
            deletions: parseInt(statMatch[3]) || 0,
          };
        }
      }
    } catch (err) {
      checkFailed = true;
      checkError = err.message;
      logger.warn(`Update check failed: ${err.message}`);
    }

    return {
      ...info,
      latest,
      hasUpdate,
      behindCount,
      changelogSummary,
      diffStats,
      checkFailed,
      checkError,
    };
  }

  // ── Get Changelog / Git Log ─────────────────────────────────────
  async getChangelog(limit = 50) {
    const safeLimit = Math.min(Math.max(parseInt(limit) || 50, 10), 200);
    const raw = await this._runCommand(
      `git log --oneline --no-decorate -n ${safeLimit}`
    );
    if (!raw || raw.includes('[ERROR]')) return [];
    const lines = raw.trim().split('\n').filter(Boolean);
    return lines.map(line => {
      const match = line.match(/^([a-f0-9]+)\s(.+)$/);
      return match ? { hash: match[1], message: match[2] } : { hash: '', message: line };
    });
  }

  // ── Get Diff Preview ─────────────────────────────────────────────
  async getDiffPreview() {
    const info = await this.getVersionInfo();
    const safeBranch = this._validateGitRef(info.branch);
    const raw = await this._runCommand(
      `git diff HEAD..origin/${safeBranch}`
    );
    return { diff: raw.includes('[ERROR]') ? 'No diff available' : raw };
  }

  // ── Backup Before Update ─────────────────────────────────────────
  async createPreUpdateBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `pre-update-${timestamp}`;
    const backupFile = path.join(BACKUP_DIR, `${backupName}.tar.gz`);

    logger.info(`Updater: Creating pre-update backup: ${backupName}`);

    try {
      // Create tar.gz of panel directory excluding node_modules, storage/panel-backups, .git
      const excludePatterns = [
        '--exclude=node_modules',
        '--exclude=storage/panel-backups',
        '--exclude=.git',
        '--exclude=storage/uploads',
        '--exclude=storage/logs',
      ];

      const cmd = `tar -czf "${backupFile}" ${excludePatterns.join(' ')} .`;
      const output = await this._runChecked(cmd, { cwd: PANEL_DIR, timeout: 300000 });

      const size = await this._getFileSize(backupFile);
      if (!size) {
        throw new Error('backup archive is empty or missing');
      }

      // Save backup record
      const history = await this.getUpdateHistory();
      history.backups = history.backups || [];
      history.backups.unshift({
        id: backupName,
        name: backupName,
        file: backupFile,
        size,
        createdAt: new Date().toISOString(),
        type: 'pre-update',
      });
      // Keep max 10 backups
      history.backups = history.backups.slice(0, 10);
      await this._writeJSON(HISTORY_FILE, history);

      return { name: backupName, file: backupFile, output };
    } catch (err) {
      logger.error(`Updater: Pre-update backup failed: ${err.message}`);
      throw new Error(`Pre-update backup failed: ${err.message}`);
    }
  }

  async _getFileSize(filePath) {
    try {
      const stat = await fs.stat(filePath);
      return stat.size;
    } catch {
      return 0;
    }
  }

  // ── List Backups ─────────────────────────────────────────────────
  async listBackups() {
    const history = await this.getUpdateHistory();
    return history.backups || [];
  }

  // ── Perform Update ──────────────────────────────────────────────
  async performUpdate(options = {}) {
    const method = options.method || 'git';
    const branch = options.branch || 'master';
    const channel = options.channel || 'stable';
    const skipBackup = options.skipBackup || false;
    const dryRun = options.dryRun || false;
    const internal = options._internal === true;
    const deferRestart = options._deferRestart === true;

    this._validateGitRef(branch);
    this._validateChannel(channel);

    // Single-flight guard: two concurrent updates corrupt node_modules and .git.
    if (!dryRun) {
      if (this._running && !internal) {
        const err = new Error('An update is already in progress');
        err.code = 'UPDATE_IN_PROGRESS';
        err.statusCode = 409;
        throw err;
      }
      if (!internal) this._running = true;
    }

    const log = [];
    const timestamp = new Date().toISOString();
    let success = false;
    let backupInfo = null;
    let newCommit = '';

    // Record current state for rollback
    const info = await this.getVersionInfo();
    const previousCommit = info.commit;
    const previousVersion = info.current;

    try {
      // 1. Create backup (unless skipped). A failed backup aborts the update:
      //    without a recovery point, a destructive git reset is not safe.
      if (!skipBackup && !dryRun) {
        log.push('📦 Creating pre-update backup...');
        backupInfo = await this.createPreUpdateBackup();
        log.push(`   ✅ Backup created: ${backupInfo.name} (${this._formatSize(backupInfo.size)})`);
      }

      if (dryRun) {
        log.push('🔍 DRY RUN — no changes applied');
        return { success: true, log: log.join('\n'), dryRun: true, backupInfo };
      }

      // 2. Apply update based on method
      if (method === 'git') {
        // Scoped safe.directory only — never "*" (that disables git's ownership check globally)
        log.push('🔧 Verifying git repository...');
        const insideTree = await this._runCommand('git rev-parse --is-inside-work-tree 2>&1');
        if (insideTree.trim() !== 'true') {
          throw new Error(
            `Not a git repository: ${PANEL_DIR}. ` +
            'This installation cannot self-update. Reinstall with scripts/install.sh (git clone).'
          );
        }
        await this._runCommand(`git config --global --add safe.directory "${PANEL_DIR}" 2>&1`).catch(() => {});

        // Recovery point: keep local commits and uncommitted changes recoverable
        const bundle = await this._createRecoveryBundle(timestamp);
        if (bundle) log.push(`   ✅ Recovery bundle: ${path.basename(bundle)}`);
        const patch = await this._saveWorkingTreePatch(timestamp);
        if (patch) log.push('   ✅ Working tree patch saved');

        // Backup runtime configs in storage to prevent untracked / overwrite merge conflicts
        const panelJsonPath = path.join(STORAGE_DIR, 'panel.json');
        const systemJsonPath = path.join(STORAGE_DIR, 'system.json');
        let savedPanelConfig = null;
        let savedSystemConfig = null;
        try { savedPanelConfig = await fs.readFile(panelJsonPath, 'utf8'); } catch {}
        try { savedSystemConfig = await fs.readFile(systemJsonPath, 'utf8'); } catch {}

        // Abort any lingering merge or rebase state
        await this._runCommand('git merge --abort 2>&1').catch(() => {});
        await this._runCommand('git rebase --abort 2>&1').catch(() => {});

        // Discard accidental local modifications to tracked source files.
        // They are already preserved in the patch/bundle created above.
        log.push('🧹 Preparing clean working directory for git pull...');
        await this._runCommand('git checkout HEAD -- . 2>&1').catch(() => {});

        // Pull latest code
        log.push(`⬇️ Pulling from origin/${branch}...`);
        let pullOut = await this._runCommand(`git pull --no-edit origin ${branch} 2>&1`);

        // Untracked files blocking the merge are quarantined, then pull is retried once.
        if (this._pullFailed(pullOut)) {
          const conflicts = this._extractUntrackedConflicts(pullOut);
          if (conflicts.length) {
            log.push(`   📦 Moving ${conflicts.length} untracked conflicting file(s) aside...`);
            const moved = await this._quarantineFiles(conflicts, timestamp);
            log.push(`   ✅ Moved ${moved.length} file(s) to storage/update-backup/`);
            pullOut = await this._runCommand(`git pull --no-edit origin ${branch} 2>&1`);
          }
        }

        // Last resort: fetch + hard reset (bundle/patch already created)
        if (this._pullFailed(pullOut)) {
          log.push(`   ${String(pullOut).trim().split('\n').join('\n   ')}`);
          log.push('   ⚠️ Standard git pull failed. Falling back to fetch + reset --hard...');
          // A conflicted merge leaves the index unresolved. Clear MERGE_HEAD
          // before switching branches, otherwise `checkout -B` itself fails.
          await this._runCommand('git merge --abort 2>&1').catch(() => {});
          await this._runCommand('git rebase --abort 2>&1').catch(() => {});
          await this._runChecked('git reset --hard HEAD 2>&1');
          const fetchOut = await this._runChecked(`git fetch origin ${branch} 2>&1`);
          const conflicts = this._extractUntrackedConflicts(fetchOut);
          if (conflicts.length) {
            await this._quarantineFiles(conflicts, timestamp);
          }
          await this._runChecked(`git checkout -B ${branch} origin/${branch} 2>&1`);
          pullOut = await this._runChecked(`git reset --hard origin/${branch} 2>&1`);
        }
        log.push(`   ${String(pullOut).trim().split('\n').join('\n   ')}`);

        // Restore runtime configs
        if (savedPanelConfig) {
          try { await fs.writeFile(panelJsonPath, savedPanelConfig, 'utf8'); } catch {}
        }
        if (savedSystemConfig) {
          try { await fs.writeFile(systemJsonPath, savedSystemConfig, 'utf8'); } catch {}
        }
      }

      // 3. Install dependencies. npm ci is reproducible and MUST fail loudly.
      if (method === 'git' || method === 'npm') {
        log.push('📦 Installing npm dependencies...');
        const hasLock = await fs.access(path.join(PANEL_DIR, 'package-lock.json'))
          .then(() => true)
          .catch(() => false);
        const installCmd = hasLock ? 'npm ci --omit=dev' : 'npm install --omit=dev';

        try {
          const npmOut = await this._runChecked(installCmd, { timeout: 900000 });
          const tail = npmOut.trim().split('\n').slice(-5).join('\n   ');
          if (tail) log.push(`   ${tail}`);
        } catch (err) {
          throw new Error(`Dependency installation failed (${installCmd}): ${err.message}`);
        }

        log.push('🔨 Rebuilding native dependencies (better-sqlite3, node-pty)...');
        const native = await this.rebuildNativeModules(log);
        if (!native.sqliteOk) {
          throw new Error(`better-sqlite3 unusable after update: ${native.sqliteError || 'unknown error'}`);
        }
        if (!native.ptyOk) {
          log.push('   ⚠️ node-pty unavailable — Web Terminal will not work until it is rebuilt');
        }
      }

      // 4. Verify the new build can actually boot (imports + native modules),
      //    not merely parse: `node --check` cannot detect missing files/deps.
      log.push('🔍 Verifying new build...');
      await this._verifyBoot(log);
      log.push('   ✅ Boot verification passed');

      // 5. Save last updated timestamp
      const panelCfg = await this._readJSON(PANEL_CONFIG, {});
      panelCfg.lastUpdated = new Date().toISOString();
      panelCfg.updateChannel = channel;
      await this._writeJSON(PANEL_CONFIG, panelCfg);

      success = true;

      // Get new commit
      try {
        const commitOut = await this._runCommand('git rev-parse HEAD 2>/dev/null');
        newCommit = commitOut.trim();
      } catch { /* ignore */ }

      // Save successful update to history
      await this._saveUpdateHistory({
        type: 'update',
        status: 'success',
        fromVersion: previousVersion,
        toVersion: options.targetVersion || null,
        previousCommit,
        newCommit,
        method,
        branch,
        channel,
        backup: backupInfo?.name || null,
        log: log.join('\n'),
        timestamp,
      });

      log.push('\n✅ Update completed successfully!');
      if (deferRestart) {
        log.push('⏳ Update supervisor will restart the panel and verify /api/health.');
      } else {
        log.push('⏳ Panel will restart in 5 seconds...');
        setTimeout(() => { this.restartPanel().catch(() => {}); }, 5000);
      }
    } catch (err) {
      log.push(`\n❌ Update failed: ${err.message}`);

      // Auto-rollback on unexpected error
      if (previousCommit) {
        log.push('\n⚠️ Attempting auto-rollback...');
        try {
          const rollbackResult = await this.performRollback({ commit: previousCommit, _deferRestart: deferRestart });
          log.push(rollbackResult.log);
        } catch (rbErr) {
          log.push(`❌ Rollback failed: ${rbErr.message}`);
        }
      }

      await this._saveUpdateHistory({
        type: 'update',
        status: 'failed',
        fromVersion: previousVersion,
        toVersion: null,
        previousCommit,
        newCommit: '',
        method,
        branch,
        channel,
        backup: backupInfo?.name || null,
        log: log.join('\n'),
        timestamp,
      });
    }

    if (!internal && !dryRun) this._running = false;
    return { success, log: log.join('\n'), backupInfo, commit: newCommit, previousCommit };
  }

  // ── Rollback ─────────────────────────────────────────────────────
  async performRollback(options = {}) {
    const commit = options.commit;
    const restoreBackup = options.restoreBackup || null; // backup id from listBackups
    const deferRestart = options._deferRestart === true;
    const timestamp = new Date().toISOString();
    const log = [];

    let targetCommit = commit;
    let verified = false;

    try {
      if (restoreBackup) {
        // Restore from file backup
        log.push(`📦 Restoring from backup: ${restoreBackup}...`);
        const backupName = this._validateBackupName(restoreBackup);
        const backupFile = path.join(BACKUP_DIR, `${backupName}.tar.gz`);

        try {
          await fs.access(backupFile);
        } catch {
          throw new Error(`Backup file not found: ${backupFile}`);
        }

        // Extract backup
        const extractOut = await this._runChecked(
          `tar -xzf "${backupFile}"`,
          { cwd: PANEL_DIR, timeout: 300000 }
        );
        log.push(`   ✅ Backup restored`);
        log.push(`   ${extractOut.trim().split('\n').slice(0, 2).join('\n   ')}`);

        // Get commit from backup header
        try {
          const commitOut = await this._runCommand('git rev-parse HEAD 2>/dev/null');
          targetCommit = commitOut.trim();
        } catch { /* ignore */ }
      } else if (commit) {
        // Git reset to specific commit
        const validatedCommit = this._validateCommitHash(commit);
        log.push(`🔙 Rolling back to commit ${validatedCommit.substring(0, 8)}...`);
        const resetOut = await this._runChecked(`git reset --hard ${validatedCommit} 2>&1`);
        log.push(`   ${resetOut.trim()}`);
        targetCommit = validatedCommit;
      }

      // Reinstall dependencies after rollback
      log.push('📦 Re-installing npm dependencies...');
      const hasLock = await fs.access(path.join(PANEL_DIR, 'package-lock.json'))
        .then(() => true)
        .catch(() => false);
      const installCmd = hasLock ? 'npm ci --omit=dev' : 'npm install --omit=dev';
      const npmOut = await this._runChecked(installCmd, { timeout: 900000 });
      log.push(`   ${npmOut.trim().split('\n').slice(-5).join('\n   ')}`);

      log.push('🔨 Rebuilding native dependencies after rollback (better-sqlite3, node-pty)...');
      const native = await this.rebuildNativeModules(log);
      if (!native.sqliteOk) {
        throw new Error(`better-sqlite3 unusable after rollback: ${native.sqliteError || 'unknown error'}`);
      }

      // Boot verification
      log.push('🔍 Verifying rollback build...');
      try {
        await this._verifyBoot(log);
        verified = true;
        log.push('   ✅ Boot verification passed');
      } catch (err) {
        log.push(`   ⚠️ Boot verification failed after rollback: ${err.message}`);
      }

      // Save rollback to history
      const info = await this.getVersionInfo();
      await this._saveUpdateHistory({
        type: 'rollback',
        status: verified ? 'success' : 'failed',
        fromVersion: '',
        toVersion: info.current,
        previousCommit: '',
        newCommit: targetCommit,
        method: restoreBackup ? 'backup' : 'git',
        branch: info.branch,
        channel: info.channel,
        backup: restoreBackup || null,
        log: log.join('\n'),
        timestamp,
      });

      log.push(verified
        ? '\n✅ Rollback completed successfully!'
        : '\n⚠️ Rollback completed but boot verification failed — panel may not start correctly.'
      );
      if (deferRestart) {
        log.push('⏳ Update supervisor will restart the panel and verify /api/health.');
      } else {
        log.push('⏳ Panel will restart in 5 seconds...');
        setTimeout(() => { this.restartPanel().catch(() => {}); }, 5000);
      }
    } catch (err) {
      log.push(`\n❌ Rollback failed: ${err.message}`);
      await this._saveUpdateHistory({
        type: 'rollback',
        status: 'failed',
        fromVersion: '',
        toVersion: '',
        previousCommit: '',
        newCommit: '',
        method: restoreBackup ? 'backup' : 'git',
        branch: '',
        channel: '',
        backup: restoreBackup || null,
        log: log.join('\n'),
        timestamp,
      });
      return { success: false, log: log.join('\n') };
    }

    return { success: verified, log: log.join('\n'), commit: targetCommit };
  }

  // ── Restart Panel ────────────────────────────────────────────────
  async restartPanel() {
    logger.info('Updater: Panel restart initiated');

    // Save health-check marker before restart
    const panelCfg = await this._readJSON(PANEL_CONFIG, {});
    panelCfg.lastRestartRequested = new Date().toISOString();
    await this._writeJSON(PANEL_CONFIG, panelCfg);

    // Give 2 seconds for the HTTP response to be fully sent, then restart.
    setTimeout(async () => {
      logger.info('Updater: Executing restart...');
      if (process.platform === 'win32') {
        logger.info('Updater: Restart requested on Windows dev environment. Skipping process.exit(0) to prevent process crash.');
        return;
      }
      try {
        const sysOut = await this._runCommand('systemctl restart panelku');
        if (sysOut.includes('[ERROR]')) {
          throw new Error(sysOut);
        }
      } catch {
        logger.warn('Updater: systemctl restart failed, checking PM2...');
        try {
          const pm2Out = await this._runCommand('pm2 restart panelku || pm2 reload panelku');
          if (pm2Out.includes('[ERROR]')) {
            throw new Error(pm2Out);
          }
        } catch {
          logger.warn('Updater: PM2 restart failed, falling back to process.exit(1)');
          if (process.env.NODE_ENV === 'production' || process.env.pm_id !== undefined) {
            // Exit non-zero so supervisors with Restart=on-failure (systemd) restart us.
            process.exit(1);
          }
        }
      }
    }, 2000);

    return true;
  }

  // ── Schedule / Auto-Update ──────────────────────────────────────
  async getScheduleConfig() {
    const cfg = await this._readJSON(PANEL_CONFIG, {});
    return {
      enabled: cfg.autoUpdate?.enabled || false,
      frequency: cfg.autoUpdate?.frequency || 'daily',
      time: cfg.autoUpdate?.time || '03:00',
      branch: cfg.autoUpdate?.branch || 'master',
      channel: cfg.autoUpdate?.channel || 'stable',
      maxBackups: cfg.autoUpdate?.maxBackups || 5,
      healthCheckTimeout: cfg.autoUpdate?.healthCheckTimeout || 60,
    };
  }

  async setScheduleConfig(config) {
    const cfg = await this._readJSON(PANEL_CONFIG, {});
    cfg.autoUpdate = {
      enabled: !!config.enabled,
      frequency: config.frequency || 'daily',
      time: config.time || '03:00',
      branch: config.branch || 'master',
      channel: config.channel || 'stable',
      maxBackups: Math.min(Math.max(parseInt(config.maxBackups) || 5, 1), 20),
      healthCheckTimeout: Math.min(Math.max(parseInt(config.healthCheckTimeout) || 60, 10), 300),
    };
    await this._writeJSON(PANEL_CONFIG, cfg);
    logger.info(`Updater: Schedule config updated: ${JSON.stringify(cfg.autoUpdate)}`);
    return cfg.autoUpdate;
  }

  // ── Health Check ─────────────────────────────────────────────────
  async runHealthCheck() {
    const results = [];

    // 1. Check process is running
    try {
      const isRunning = process.connected !== false; // simple check
      results.push({ name: 'Process Status', status: isRunning ? 'ok' : 'fail', detail: isRunning ? 'Running' : 'Not connected' });
    } catch {
      results.push({ name: 'Process Status', status: 'fail', detail: 'Could not determine' });
    }

    // 2. Check SQLite database
    try {
      const { getDb } = await import('../../core/db/sqlite.js');
      const db = getDb();
      db.prepare('SELECT 1').get();
      results.push({ name: 'Database', status: 'ok', detail: 'SQLite responsive' });
    } catch {
      results.push({ name: 'Database', status: 'fail', detail: 'SQLite not responsive' });
    }

    // 2b. Check Native Modules (node-pty, better-sqlite3)
    try {
      const native = await this._checkNativeModules();
      if (native.sqliteOk && native.ptyOk) {
        results.push({ name: 'Native Modules', status: 'ok', detail: 'better-sqlite3 & node-pty loaded' });
      } else if (!native.sqliteOk) {
        results.push({ name: 'Native Modules', status: 'fail', detail: `better-sqlite3: ${native.sqliteError || 'error'}` });
      } else {
        results.push({ name: 'Native Modules', status: 'warn', detail: 'node-pty native binary missing — Web Terminal unavailable' });
      }
    } catch (err) {
      results.push({ name: 'Native Modules', status: 'warn', detail: `Native check: ${err.message}` });
    }

    // 3. Check port listening
    try {
      const portOut = await this._runCommand('ss -tlnp 2>/dev/null | grep node || netstat -tlnp 2>/dev/null | grep node || echo ""');
      const listening = portOut.trim().length > 0;
      results.push({ name: 'Port Listener', status: listening ? 'ok' : 'warn', detail: listening ? 'Node process listening' : 'Could not verify port' });
    } catch {
      results.push({ name: 'Port Listener', status: 'warn', detail: 'Could not check' });
    }

    // 4. Check response time (fetch self)
    try {
      const start = Date.now();
      await fetch(`http://localhost:${process.env.PORT || 23456}/api/health`, { signal: AbortSignal.timeout(5000) });
      const ms = Date.now() - start;
      results.push({ name: 'HTTP Response', status: ms < 2000 ? 'ok' : 'warn', detail: `${ms}ms` });
    } catch {
      results.push({ name: 'HTTP Response', status: 'fail', detail: 'Unreachable' });
    }

    // 5. Check disk space
    try {
      const dfOut = await this._runCommand('df -h / | tail -1');
      const parts = dfOut.trim().split(/\s+/);
      const usage = parts[4] || '0%';
      const usageNum = parseInt(usage.replace('%', ''));
      results.push({
        name: 'Disk Space',
        status: usageNum < 90 ? 'ok' : (usageNum < 95 ? 'warn' : 'fail'),
        detail: `${parts[2] || '?'} used of ${parts[1] || '?'} (${usage})`,
      });
    } catch {
      results.push({ name: 'Disk Space', status: 'warn', detail: 'Could not check' });
    }

    // 6. Check memory
    try {
      const mem = process.memoryUsage();
      const heapUsed = Math.round(mem.heapUsed / 1024 / 1024);
      const heapTotal = Math.round(mem.heapTotal / 1024 / 1024);
      const rss = Math.round(mem.rss / 1024 / 1024);
      results.push({
        name: 'Memory Usage',
        status: heapUsed < heapTotal * 0.9 ? 'ok' : 'warn',
        detail: `RSS: ${rss}MB, Heap: ${heapUsed}/${heapTotal}MB`,
      });
    } catch {
      results.push({ name: 'Memory Usage', status: 'warn', detail: 'Could not check' });
    }

    // 7. Check uptime since last restart
    const cfg = await this._readJSON(PANEL_CONFIG, {});
    const lastRestart = cfg.lastRestartRequested;
    const uptime = process.uptime();
    const uptimeStr = this._formatDuration(uptime);

    const overall = results.every(r => r.status === 'ok') ? 'healthy'
      : results.some(r => r.status === 'fail') ? 'unhealthy'
      : 'degraded';

    return {
      overall,
      results,
      uptime: uptimeStr,
      uptimeSeconds: Math.floor(uptime),
      lastRestart,
      timestamp: new Date().toISOString(),
    };
  }

  // ── Update History ──────────────────────────────────────────────
  async getUpdateHistory() {
    return this._readJSON(HISTORY_FILE, { updates: [], backups: [] });
  }

  async _saveUpdateHistory(entry) {
    const history = await this.getUpdateHistory();
    history.updates = history.updates || [];
    history.updates.unshift(entry);
    // Keep max 50 entries (Sprint 1 retention policy)
    history.updates = history.updates.slice(0, 50);
    await this._writeJSON(HISTORY_FILE, history);
  }

  async clearUpdateHistory() {
    await this._writeJSON(HISTORY_FILE, { updates: [], backups: [] });
    return true;
  }

  // ── Helpers: Format ──────────────────────────────────────────────
  _formatSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return `${size.toFixed(1)} ${units[i]}`;
  }

  _formatDuration(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
  }
}

export default new UpdaterService();
