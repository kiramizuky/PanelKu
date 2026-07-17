import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import logger from '../../config/logger.js';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

/**
 * NVM directory detection.
 */
const NVM_DIR_CANDIDATES = [
  process.env.NVM_DIR,
  '/usr/local/nvm',
  `${process.env.HOME}/.nvm`,
  '/root/.nvm',
  `${process.env.HOME}/.config/nvm`,
].filter(Boolean);

/**
 * Safe shell command runner with validated args.
 * Prevents shell injection by using execFile with args array.
 */
async function runCmd(cmd, args = [], opts = {}) {
  if (process.platform === 'win32') {
    return { stdout: '', stderr: '' };
  }
  try {
    const result = await execFileAsync(cmd, args, {
      timeout: 30000,
      ...opts,
    });
    return result;
  } catch (err) {
    logger.warn(`Command failed: ${cmd} ${args.join(' ')} — ${err.message}`);
    throw err;
  }
}

/**
 * Validate Node.js version string (e.g. 18.17.1, 20.11.0, lts/hydrogen)
 */
function validateVersion(version) {
  if (!version || typeof version !== 'string') {
    throw new Error('Node.js version is required');
  }
  // Allow semver, "lts/*", "lts/<name>", "latest", "node", "system"
  if (!/^[a-zA-Z0-9.*/_\-]+$/.test(version)) {
    throw new Error('Invalid Node.js version format');
  }
  return version;
}

/**
 * Validate an npm package name.
 */
function validatePackageName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Package name is required');
  }
  // npm package names: lowercase, no spaces, no shell special chars
  if (!/^@?[a-z0-9][a-z0-9._\-/@]+$/.test(name)) {
    throw new Error('Invalid package name');
  }
  return name;
}

class NodeJSService {
  constructor() {
    this.nvmDir = null;
    this._nvmInitialized = false;
  }

  /**
   * Find the NVM installation directory.
   */
  async _findNvmDir() {
    if (this.nvmDir) return this.nvmDir;

    for (const dir of NVM_DIR_CANDIDATES) {
      if (!dir) continue;
      try {
        await fs.access(`${dir}/nvm.sh`);
        this.nvmDir = dir;
        return dir;
      } catch {
        // Try next candidate
      }
    }

    // Last resort: try to find via which
    try {
      const { stdout } = await execAsync('command -v nvm 2>/dev/null || dirname $(which nvm-exec 2>/dev/null) 2>/dev/null || echo ""');
      const found = stdout.trim();
      if (found) {
        this.nvmDir = found;
        return found;
      }
    } catch {
      // Not found
    }

    return null;
  }

  /**
   * Run an NVM command by sourcing nvm.sh first.
   */
  async _runNvmCommand(args = []) {
    const nvmDir = await this._findNvmDir();
    if (!nvmDir) {
      throw new Error('NVM is not installed. Please install NVM first via the "Install NVM" button.');
    }

    // We need to source nvm.sh then run nvm with args
    // NVM doesn't have a direct binary, so we run via bash -c
    const sourceCmd = `. ${nvmDir}/nvm.sh && nvm ${args.join(' ')}`;
    const { stdout } = await execAsync(sourceCmd, {
      timeout: 60000,
      env: {
        ...process.env,
        NVM_DIR: nvmDir,
      },
    });
    return stdout.trim();
  }

  // ── NVM Lifecycle ─────────────────────────────────────

  /**
   * Install NVM on the host system.
   */
  async installNvm() {
    if (process.platform === 'win32') {
      throw new Error('NVM installation is only supported on Linux/macOS. On Windows, use nvm-windows manually.');
    }

    // Check if already installed
    const existingDir = await this._findNvmDir();
    if (existingDir) {
      return { message: 'NVM is already installed', nvmDir: existingDir };
    }

    try {
      // Download and run the official install script
      const { stdout, stderr } = await execAsync(
        'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash',
        { timeout: 120000 }
      );

      // Find where NVM was installed
      this.nvmDir = null;
      const installedDir = await this._findNvmDir();
      if (!installedDir) {
        throw new Error('NVM installation completed but NVM directory not found. Try sourcing ~/.bashrc or re-login.');
      }
      this.nvmDir = installedDir;

      // Add NVM_DIR to /etc/profile for persistence
      try {
        await execAsync(`echo 'export NVM_DIR="${installedDir}"' >> /etc/profile.d/nvm.sh`);
        await execAsync(`echo '[ -s "$NVM_DIR/nvm.sh" ] && \\. "$NVM_DIR/nvm.sh"' >> /etc/profile.d/nvm.sh`);
        await execAsync('chmod +x /etc/profile.d/nvm.sh');
      } catch {
        // Non-critical: profile update may fail in some environments
      }

      return {
        message: 'NVM installed successfully',
        nvmDir: installedDir,
        output: stdout + stderr,
      };
    } catch (err) {
      throw new Error(`Failed to install NVM: ${err.message}`);
    }
  }

  // ── Node.js Version Management ────────────────────────

  /**
   * Get the current status: installed NVM, active Node.js version, available versions.
   */
  async getStatus() {
    const nvmDir = await this._findNvmDir();
    const isNvmInstalled = !!nvmDir;

    let currentVersion = 'Not found';
    let defaultVersion = 'Not set';
    let installedVersions = [];
    let remoteVersions = [];

    try {
      const { stdout } = await execAsync('node --version 2>/dev/null || echo "Not found"');
      currentVersion = stdout.trim();
    } catch {
      currentVersion = 'Not found';
    }

    if (isNvmInstalled) {
      try {
        // List installed versions
        const lsOutput = await this._runNvmCommand(['ls', '--no-colors']);
        installedVersions = lsOutput
          .split('\n')
          .map(v => v.trim().replace(/^\s*[*->]*\s*/, ''))
          .filter(v => v && v !== '' && !v.includes('->') && !v.startsWith('default'));

        // Get default alias
        try {
          const defaultOut = await this._runNvmCommand(['alias', 'default', '--no-colors']);
          defaultVersion = defaultOut.trim() || 'Not set';
        } catch {
          defaultVersion = 'Not set';
        }
      } catch (err) {
        logger.warn('Failed to list NVM versions:', err.message);
        installedVersions = [];
      }
    }

    // Also check for node installed directly (not via NVM)
    if (!installedVersions || installedVersions.length === 0) {
      try {
        await fs.access('/usr/local/bin/node');
        installedVersions = ['system'];
      } catch {
        // No system node either
      }
    }

    return {
      nvmInstalled: isNvmInstalled,
      nvmDir: nvmDir || null,
      currentVersion,
      defaultVersion,
      installedVersions: [...new Set(installedVersions)],
    };
  }

  /**
   * List available remote Node.js versions (LTS only for brevity).
   */
  async listRemote(filter = 'lts') {
    await this._ensureNvm();

    const validFilters = ['lts', 'latest', 'all'];
    const safeFilter = validFilters.includes(filter) ? filter : 'lts';

    try {
      const output = await this._runNvmCommand(['ls-remote', '--no-colors']);
      const allVersions = output.split('\n')
        .map(v => v.trim())
        .filter(v => v && v.length > 0);

      // Parse versions with LTS markers
      const versions = allVersions
        .map(v => {
          const match = v.match(/^(v?\d+\.\d+\.\d+)\s*(.*)/);
          if (!match) return null;
          return {
            version: match[1].replace(/^v/, ''),
            lts: match[2] || null,
          };
        })
        .filter(Boolean);

      if (safeFilter === 'lts') {
        return versions.filter(v => v.lts);
      }
      if (safeFilter === 'latest') {
        const last = versions[versions.length - 1];
        return last ? [last] : [];
      }
      return versions;
    } catch (err) {
      logger.error('Failed to list remote Node.js versions:', err.message);
      throw new Error(`Failed to fetch remote versions: ${err.message}`);
    }
  }

  /**
   * Install a specific Node.js version via NVM.
   */
  async installVersion(version) {
    validateVersion(version);
    await this._ensureNvm();

    logger.info(`NodeJS: Installing Node.js ${version}...`);

    try {
      const output = await this._runNvmCommand(['install', version]);
      return {
        message: `Node.js ${version} installed successfully.`,
        output,
      };
    } catch (err) {
      throw new Error(`Failed to install Node.js ${version}: ${err.message}`);
    }
  }

  /**
   * Uninstall a specific Node.js version.
   */
  async uninstallVersion(version) {
    validateVersion(version);
    await this._ensureNvm();

    try {
      const output = await this._runNvmCommand(['uninstall', version]);
      return {
        message: `Node.js ${version} uninstalled.`,
        output,
      };
    } catch (err) {
      throw new Error(`Failed to uninstall Node.js ${version}: ${err.message}`);
    }
  }

  /**
   * Set a Node.js version as the default.
   */
  async setDefault(version) {
    validateVersion(version);
    await this._ensureNvm();

    try {
      const output = await this._runNvmCommand(['alias', 'default', version]);
      return {
        message: `Node.js ${version} set as default.`,
        output,
      };
    } catch (err) {
      throw new Error(`Failed to set default Node.js version: ${err.message}`);
    }
  }

  /**
   * Use a specific Node.js version (active for current session).
   */
  async useVersion(version) {
    validateVersion(version);
    await this._ensureNvm();

    try {
      const output = await this._runNvmCommand(['use', version]);
      return {
        message: `Now using Node.js ${version}.`,
        output,
      };
    } catch (err) {
      throw new Error(`Failed to switch to Node.js ${version}: ${err.message}`);
    }
  }

  // ── NPM Global Packages ──────────────────────────────

  /**
   * List globally installed npm packages.
   */
  async listGlobalPackages() {
    try {
      const { stdout } = await execAsync('npm list -g --depth=0 --json 2>/dev/null || echo "{}"');
      const parsed = JSON.parse(stdout);
      const dependencies = parsed.dependencies || {};
      return Object.entries(dependencies).map(([name, info]) => ({
        name,
        version: info.version || 'unknown',
      }));
    } catch (err) {
      logger.warn('Failed to list global npm packages:', err.message);
      return [];
    }
  }

  /**
   * Install a global npm package.
   */
  async installGlobalPackage(pkg) {
    validatePackageName(pkg);
    try {
      const { stdout } = await execAsync(`npm install -g ${pkg} 2>&1`, { timeout: 120000 });
      return { message: `Package "${pkg}" installed globally.`, output: stdout };
    } catch (err) {
      throw new Error(`Failed to install package "${pkg}": ${err.message}`);
    }
  }

  /**
   * Uninstall a global npm package.
   */
  async uninstallGlobalPackage(pkg) {
    validatePackageName(pkg);
    try {
      const { stdout } = await execAsync(`npm uninstall -g ${pkg} 2>&1`, { timeout: 60000 });
      return { message: `Package "${pkg}" uninstalled.`, output: stdout };
    } catch (err) {
      throw new Error(`Failed to uninstall package "${pkg}": ${err.message}`);
    }
  }

  // ── PM2 Integration ───────────────────────────────────

  /**
   * Get PM2 process list.
   */
  async getPm2List() {
    try {
      const { stdout } = await execAsync('pm2 jlist 2>/dev/null || echo "[]"');
      const processes = JSON.parse(stdout);
      const formatUptime = (ts) => {
        if (!ts || ts === 0) return 'N/A';
        const diff = Date.now() - ts;
        const secs = Math.floor(diff / 1000);
        if (secs < 60) return `${secs}s`;
        const mins = Math.floor(secs / 60);
        if (mins < 60) return `${mins}m`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h`;
        const days = Math.floor(hours / 24);
        return `${days}d`;
      };
      const formatMemory = (bytes) => {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
      };

      return {
        isInstalled: true,
        processes: processes.map(p => ({
          name: p.name,
          pid: p.pid,
          status: p.pm2_env?.status || 'stopped',
          cpu: p.monit?.cpu || 0,
          memory: formatMemory(p.monit?.memory || 0),
          memoryBytes: p.monit?.memory || 0,
          restarts: p.pm2_env?.restart_time || 0,
          uptime: formatUptime(p.pm2_env?.pm_uptime || 0),
          pmUptime: p.pm2_env?.pm_uptime || 0,
          execMode: p.pm2_env?.exec_mode || 'fork',
          instances: p.pm2_env?.instances || 1,
          pmId: p.pm_id,
        })),
      };
    } catch {
      // PM2 not installed
      return {
        isInstalled: false,
        processes: [],
      };
    }
  }

  /**
   * Execute PM2 action (start, stop, restart, delete).
   */
  async pm2Action(name, action) {
    if (!name || typeof name !== 'string') throw new Error('Process name is required');
    if (!['start', 'stop', 'restart', 'delete', 'reload'].includes(action)) {
      throw new Error(`Invalid action: ${action}`);
    }

    try {
      const { stdout } = await execAsync(`pm2 ${action} ${name} 2>&1`, { timeout: 30000 });
      return { message: `Process "${name}" ${action}ed successfully.`, output: stdout };
    } catch (err) {
      throw new Error(`Failed to ${action} process "${name}": ${err.message}`);
    }
  }

  /**
   * Get PM2 logs for a process.
   */
  async getPm2Logs(name, lines = 100) {
    if (!name) throw new Error('Process name is required');
    const safeLines = Math.min(Math.max(parseInt(lines) || 100, 10), 500);

    try {
      const { stdout } = await execAsync(
        `pm2 logs ${name} --raw --lines ${safeLines} --nostream 2>&1 || pm2 show ${name} 2>&1`,
        { timeout: 15000 }
      );
      return stdout;
    } catch (err) {
      // Fallback: try pm2 show
      try {
        const { stdout } = await execAsync(`pm2 show ${name} 2>&1`, { timeout: 10000 });
        return stdout;
      } catch {
        return `No logs available for "${name}". PM2 may not have recorded any output.`;
      }
    }
  }

  /**
   * Start a new PM2 process from a given path/script.
   */
  async pm2Start(script, name, args = '', cwd = '') {
    if (!script) throw new Error('Script path is required');
    // Validate script path
    if (!/^[a-zA-Z0-9_./\-]+$/.test(script)) {
      throw new Error('Invalid script path');
    }

    let cmd = `pm2 start ${script} --name "${name || path.basename(script, '.js')}"`;
    if (args) cmd += ` -- ${args}`;

    try {
      const opts = {};
      if (cwd) {
        opts.cwd = cwd;
      }
      const { stdout } = await execAsync(cmd, { timeout: 30000, ...opts });
      return { message: `Process started from "${script}".`, output: stdout };
    } catch (err) {
      throw new Error(`Failed to start process: ${err.message}`);
    }
  }

  // ── Node.js Info ──────────────────────────────────────

  /**
   * Get detailed Node.js environment info.
   */
  async getNodeInfo() {
    const info = {};
    try {
      const { stdout: ver } = await execAsync('node --version 2>/dev/null || echo "N/A"');
      info.version = ver.trim();
    } catch { info.version = 'N/A'; }

    try {
      const { stdout: npmVer } = await execAsync('npm --version 2>/dev/null || echo "N/A"');
      info.npmVersion = npmVer.trim();
    } catch { info.npmVersion = 'N/A'; }

    try {
      const { stdout: nodePath } = await execAsync('which node 2>/dev/null || echo "N/A"');
      info.nodePath = nodePath.trim();
    } catch { info.nodePath = 'N/A'; }

    try {
      const { stdout: arch } = await execAsync('node -p "process.arch" 2>/dev/null || echo "N/A"');
      info.arch = arch.trim();
    } catch { info.arch = 'N/A'; }

    try {
      const { stdout: platform } = await execAsync('node -p "process.platform" 2>/dev/null || echo "N/A"');
      info.platform = platform.trim();
    } catch { info.platform = 'N/A'; }

    try {
      const pm2Check = await execAsync('which pm2 2>/dev/null || echo ""');
      info.pm2Installed = !!pm2Check.stdout.trim();
    } catch { info.pm2Installed = false; }

    try {
      const { stdout: pm2Ver } = await execAsync('pm2 --version 2>/dev/null || echo ""');
      info.pm2Version = pm2Ver.trim() || null;
    } catch { info.pm2Version = null; }

    // NVM info
    const nvmDir = await this._findNvmDir();
    info.nvmDir = nvmDir || null;
    info.nvmInstalled = !!nvmDir;

    return info;
  }

  // ── Helpers ───────────────────────────────────────────

  async _ensureNvm() {
    if (!this._nvmInitialized) {
      const dir = await this._findNvmDir();
      if (!dir) {
        throw new Error('NVM is not installed. Please install NVM first.');
      }
      this.nvmDir = dir;
      this._nvmInitialized = true;
    }
  }
}

export default new NodeJSService();
