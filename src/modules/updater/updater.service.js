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

import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs/promises';
import logger from '../../config/logger.js';

const execAsync = util.promisify(exec);

// ── Paths ──────────────────────────────────────────────────────────
const PANEL_DIR       = process.cwd();
const STORAGE_DIR     = path.join(PANEL_DIR, 'storage');
const HISTORY_FILE    = path.join(STORAGE_DIR, 'update_history.json');
const PANEL_CONFIG    = path.join(STORAGE_DIR, 'panel.json');
const SYSTEM_CONFIG   = path.join(STORAGE_DIR, 'system.json');
const BACKUP_DIR      = path.join(STORAGE_DIR, 'panel-backups');

class UpdaterService {
  constructor() {
    this._initStorage();
  }

  // ── Initialization ────────────────────────────────────────────────
  async _initStorage() {
    try {
      await fs.mkdir(BACKUP_DIR, { recursive: true });
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

  async _runCommand(cmd, options = {}) {
    try {
      if (process.platform === 'win32') {
        return this._mockCommand(cmd);
      }
      const { stdout, stderr } = await execAsync(cmd, { timeout: 120000, ...options });
      return stdout || stderr || '';
    } catch (error) {
      const output = (error.stdout || error.stderr || error.message || '').trim();
      return `[ERROR] ${output || error.message}`;
    }
  }

  _mockCommand(cmd) {
    if (cmd.includes('git rev-parse HEAD')) return 'abc123def456abc123def456abc123def456abc1\n';
    if (cmd.includes('git rev-parse --abbrev-ref HEAD')) return 'master\n';
    if (cmd.includes('git fetch')) return '';
    if (cmd.includes('git log HEAD..origin')) return '3\n';
    if (cmd.includes('git config --global --add safe.directory')) return '';
    if (cmd.includes('git checkout')) return '';
    if (cmd.includes('git pull')) return 'Already up to date.\n';
    if (cmd.includes('git reset')) return 'HEAD is now at abc123def\n';
    if (cmd.includes('git show origin')) return '{"version":"2.0.0"}\n';
    if (cmd.includes('git diff')) return 'diff --git a/package.json b/package.json\nindex abc..def 100644\n--- a/package.json\n+++ b/package.json\n@@ -1,5 +1,5 @@\n {\n   "name": "panelku",\n-  "version": "1.9.0",\n+  "version": "2.0.0",\n';
    if (cmd.includes('npm install')) return 'added 0 packages, removed 0 packages, changed 0 packages\n';
    if (cmd.includes('node --check')) return '';
    if (cmd.includes('npm rebuild')) return 'rebuilt better-sqlite3 node-pty successfully\n';
    if (cmd.includes('--build-from-source')) return 'built from source successfully\n';
    if (cmd.includes('which make')) return '/usr/bin/make\n';
    if (cmd.includes('which apt-get')) return '/usr/bin/apt-get\n';
    if (cmd.includes('systemctl restart panelku')) return '';
    if (cmd.includes('ls -la')) return 'total 8\ndrwxr-xr-x 2 root root 4096 Jul 17 10:00 .\ndrwxr-xr-x 4 root root 4096 Jul 17 09:00 ..\n';
    if (cmd.includes('tail -n')) return 'Jul 17 10:00:01 server panelku[1234]: Panel started successfully\n';
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
      const branchOut = await this._runCommand('git rev-parse --abbrev-ref HEAD 2>/dev/null');
      activeBranch = branchOut.trim() || 'master';
      activeBranch = this._validateGitRef(activeBranch);
    } catch { /* ignore */ }

    try {
      const commitOut = await this._runCommand('git rev-parse HEAD 2>/dev/null');
      currentCommit = commitOut.trim();
      currentCommit = this._validateCommitHash(currentCommit);
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

    try {
      const safeBranch = this._validateGitRef(info.branch);

      // Fetch remote
      await this._runCommand('git fetch origin 2>&1');

      // Count commits behind
      const behindOut = await this._runCommand(
        `git log HEAD..origin/${safeBranch} --oneline 2>/dev/null | wc -l`
      );
      behindCount = parseInt(behindOut.trim()) || 0;
      hasUpdate = behindCount > 0;

      if (hasUpdate) {
        // Get latest remote version
        const remoteVer = await this._runCommand(
          `git show origin/${safeBranch}:package.json 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.version||'')}catch{console.log('')}})"`
        ).catch(() => '');
        latest = remoteVer.trim() || `${info.current}+${behindCount}`;

        // Get changelog between versions
        const logOut = await this._runCommand(
          `git log HEAD..origin/${safeBranch} --oneline --no-decorate 2>/dev/null | head -20`
        );
        changelogSummary = logOut.trim();

        // Get diff stats
        const diffOut = await this._runCommand(
          `git diff HEAD..origin/${safeBranch} --stat 2>/dev/null | tail -1`
        );
        const statMatch = diffOut.match(/(\d+) files? changed.*?(\d+) insertions?.*?(\d+) deletions?/);
        if (statMatch) {
          diffStats = {
            files: parseInt(statMatch[1]) || 0,
            insertions: parseInt(statMatch[2]) || 0,
            deletions: parseInt(statMatch[3]) || 0,
          };
        }
      }
    } catch (err) {
      logger.warn(`Update check failed: ${err.message}`);
    }

    return {
      ...info,
      latest,
      hasUpdate,
      behindCount,
      changelogSummary,
      diffStats,
    };
  }

  // ── Get Changelog / Git Log ─────────────────────────────────────
  async getChangelog(limit = 50) {
    const raw = await this._runCommand(
      `git log --oneline --no-decorate -${Math.min(Math.max(limit, 10), 200)} 2>/dev/null || echo "No git history"`
    );
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
      `git diff HEAD..origin/${safeBranch} 2>/dev/null || echo "No diff available"`
    );
    return { diff: raw };
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

      const cmd = `cd ${PANEL_DIR} && tar -czf "${backupFile}" ${excludePatterns.join(' ')} . 2>&1`;
      const output = await this._runCommand(cmd, { timeout: 300000 }); // 5 min timeout for large dirs

      // Save backup record
      const history = await this.getUpdateHistory();
      history.backups = history.backups || [];
      history.backups.unshift({
        id: backupName,
        name: backupName,
        file: backupFile,
        size: await this._getFileSize(backupFile),
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

    this._validateGitRef(branch);
    this._validateChannel(channel);

    const log = [];
    const timestamp = new Date().toISOString();
    let success = false;
    let backupInfo = null;

    // Record current state for rollback
    const info = await this.getVersionInfo();
    const previousCommit = info.commit;
    const previousVersion = info.current;

    try {
      // 1. Create backup (unless skipped)
      if (!skipBackup && !dryRun) {
        log.push('📦 Creating pre-update backup...');
        try {
          backupInfo = await this.createPreUpdateBackup();
          log.push(`   ✅ Backup created: ${backupInfo.name} (${this._formatSize(backupInfo.size)})`);
        } catch (err) {
          log.push(`   ⚠️ Backup failed but continuing: ${err.message}`);
        }
      }

      if (dryRun) {
        log.push('🔍 DRY RUN — no changes applied');
        return { success: true, log: log.join('\n'), dryRun: true, backupInfo };
      }

      // 2. Apply update based on method
      if (method === 'git') {
        // Mark directory safe for current user/root
        log.push('🔧 Configuring git safe directory...');
        await this._runCommand(`git config --global --add safe.directory "${PANEL_DIR}" 2>&1`).catch(() => {});
        await this._runCommand('git config --global --add safe.directory "*" 2>&1').catch(() => {});

        // Backup runtime storage/panel.json and temporarily remove it to prevent untracked merge conflicts
        const panelJsonPath = path.join(STORAGE_DIR, 'panel.json');
        let savedPanelConfig = null;
        try {
          savedPanelConfig = await fs.readFile(panelJsonPath, 'utf8');
          await fs.unlink(panelJsonPath).catch(() => {});
        } catch {}

        // Stash local changes to avoid merge conflicts
        log.push('📝 Stashing local changes...');
        await this._runCommand('git -c user.name="Panelku" -c user.email="updater@panelku.local" stash --include-untracked 2>&1').catch(() => {});
        await this._runCommand('git checkout package-lock.json 2>&1').catch(() => {});
        await this._runCommand('git checkout package.json 2>&1').catch(() => {});

        // Pull latest code
        log.push(`⬇️ Pulling from origin/${branch}...`);
        let pullOut = await this._runCommand(`git pull origin ${branch} 2>&1`);

        // If git pull failed or encountered merge/overwrite errors, fallback to git fetch + reset --hard
        if (pullOut.includes('[ERROR]') || pullOut.toLowerCase().includes('error:') || pullOut.toLowerCase().includes('fatal:') || pullOut.includes('Aborting')) {
          log.push(`   ${pullOut.trim().split('\n').join('\n   ')}`);
          log.push('   ⚠️ Standard git pull encountered an issue. Falling back to git fetch and reset...');
          const fetchOut = await this._runCommand(`git fetch origin ${branch} 2>&1`);
          if (fetchOut.includes('[ERROR]') || fetchOut.toLowerCase().includes('fatal:')) {
            throw new Error(`Git update failed during fetch: ${fetchOut.replace('[ERROR]', '').trim()}`);
          }
          const resetOut = await this._runCommand(`git reset --hard origin/${branch} 2>&1`);
          if (resetOut.includes('[ERROR]') || resetOut.toLowerCase().includes('fatal:')) {
            throw new Error(`Git update failed during reset: ${resetOut.replace('[ERROR]', '').trim()}`);
          }
          pullOut = resetOut;
        }
        log.push(`   ${pullOut.trim().split('\n').join('\n   ')}`);

        // Restore runtime panel.json config
        if (savedPanelConfig) {
          try {
            await fs.writeFile(panelJsonPath, savedPanelConfig, 'utf8');
          } catch {}
        }

        // Install dependencies
        log.push('📦 Installing npm dependencies...');
        const npmOut = await this._runCommand('npm install --omit=dev 2>&1');
        log.push(`   ${npmOut.trim().split('\n').slice(0, 3).join('\n   ')}`);
        log.push('🔨 Rebuilding native dependencies (better-sqlite3, node-pty)...');
        await this.rebuildNativeModules(log);
      } else if (method === 'npm') {
        log.push('📦 Running npm install only...');
        const npmOut = await this._runCommand('npm install --omit=dev 2>&1');
        log.push(`   ${npmOut.trim().split('\n').slice(0, 3).join('\n   ')}`);
        log.push('🔨 Rebuilding native dependencies (better-sqlite3, node-pty)...');
        await this.rebuildNativeModules(log);
      }

      // 3. Syntax check (health check before restart)
      log.push('🔍 Running syntax check...');
      let syntaxOK = false;
      try {
        if (process.platform !== 'win32') {
          await execAsync('node --check src/app.js', { timeout: 15000 });
        }
        syntaxOK = true;
        log.push('   ✅ Syntax check passed');
      } catch (err) {
        log.push(`   ❌ Syntax check failed: ${err.message}`);
      }

      // 4. If syntax check failed, trigger auto-rollback
      if (!syntaxOK && previousCommit) {
        log.push('\n⚠️ AUTO-ROLLBACK triggered!');
        const rollbackResult = await this.performRollback({ commit: previousCommit });
        log.push(rollbackResult.log);
        success = false;

        // Save failed update to history
        await this._saveUpdateHistory({
          type: 'update',
          status: 'failed_rolled_back',
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

        return { success: false, log: log.join('\n'), rollback: true };
      }

      // 5. Save last updated timestamp
      const panelCfg = await this._readJSON(PANEL_CONFIG, {});
      panelCfg.lastUpdated = new Date().toISOString();
      panelCfg.updateChannel = channel;
      await this._writeJSON(PANEL_CONFIG, panelCfg);

      success = true;

      // Get new commit
      let newCommit = '';
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
      log.push('⏳ Panel will restart in 5 seconds...');
      setTimeout(() => { this.restartPanel().catch(() => {}); }, 5000);
    } catch (err) {
      log.push(`\n❌ Update failed: ${err.message}`);

      // Auto-rollback on unexpected error
      if (previousCommit) {
        log.push('\n⚠️ Attempting auto-rollback...');
        try {
          const rollbackResult = await this.performRollback({ commit: previousCommit });
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

    return { success, log: log.join('\n'), backupInfo };
  }

  // ── Rollback ─────────────────────────────────────────────────────
  async performRollback(options = {}) {
    const commit = options.commit;
    const restoreBackup = options.restoreBackup || null; // backup id from listBackups
    const timestamp = new Date().toISOString();
    const log = [];

    let targetCommit = commit;

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
        const extractOut = await this._runCommand(
          `cd ${PANEL_DIR} && tar -xzf "${backupFile}" 2>&1`,
          { timeout: 300000 }
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
        const resetOut = await this._runCommand(`git reset --hard ${validatedCommit} 2>&1`);
        log.push(`   ${resetOut.trim()}`);
        targetCommit = validatedCommit;
      }

      // Reinstall dependencies after rollback
      log.push('📦 Re-installing npm dependencies...');
      const npmOut = await this._runCommand('npm install --omit=dev 2>&1');
      log.push(`   ${npmOut.trim().split('\n').slice(0, 3).join('\n   ')}`);
      log.push('🔨 Rebuilding native dependencies after rollback (better-sqlite3, node-pty)...');
      await this.rebuildNativeModules(log);

      // Syntax check
      log.push('🔍 Running syntax check after rollback...');
      let syntaxOK = false;
      try {
        if (process.platform !== 'win32') {
          await execAsync('node --check src/app.js', { timeout: 15000 });
        }
        syntaxOK = true;
        log.push('   ✅ Syntax check passed');
      } catch (err) {
        log.push(`   ⚠️ Syntax check failed after rollback: ${err.message}`);
      }

      // Save rollback to history
      const info = await this.getVersionInfo();
      await this._saveUpdateHistory({
        type: 'rollback',
        status: syntaxOK ? 'success' : 'failed',
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

      log.push(syntaxOK
        ? '\n✅ Rollback completed successfully!'
        : '\n⚠️ Rollback completed but syntax check failed — panel may not start correctly.'
      );
      log.push('⏳ Panel will restart in 5 seconds...');
      setTimeout(() => { this.restartPanel().catch(() => {}); }, 5000);
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

    return { success: true, log: log.join('\n'), commit: targetCommit };
  }

  // ── Restart Panel ────────────────────────────────────────────────
  async restartPanel() {
    logger.info('Updater: Panel restart initiated');

    // Save health-check marker before restart
    const panelCfg = await this._readJSON(PANEL_CONFIG, {});
    panelCfg.lastRestartRequested = new Date().toISOString();
    await this._writeJSON(PANEL_CONFIG, panelCfg);

    // Give 2 seconds for the HTTP response to be fully sent, then restart.
    // (The outer 5s delay from performUpdate/performRollback ensures the browser
    //  receives the full log before the server goes down.)
    setTimeout(async () => {
      logger.info('Updater: Executing restart via systemctl...');
      try {
        await this._runCommand('systemctl restart panelku');
      } catch {
        logger.warn('Updater: systemctl restart failed, falling back to process.exit(0)');
        process.exit(0);
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
    // Keep max 100 entries
    history.updates = history.updates.slice(0, 100);
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
