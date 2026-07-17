import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import logger from '../../config/logger.js';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

/**
 * Safe shell command runner with validated args.
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
 * Validate a Python version string (e.g. 3.9.18, 3.11.5, 3.12.0).
 */
function validatePythonVersion(version) {
  if (!version || typeof version !== 'string') throw new Error('Python version is required');
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) throw new Error('Invalid Python version format (e.g. 3.11.5)');
  return version;
}

/**
 * Validate a name for virtualenv/project.
 */
function validateName(name) {
  if (!name || typeof name !== 'string') throw new Error('Name is required');
  if (!/^[a-zA-Z0-9_\-]{1,64}$/.test(name)) throw new Error('Name must be 1-64 chars, letters/numbers/underscores/hyphens');
  return name;
}

/**
 * Validate a pip package name.
 */
function validatePipPackage(name) {
  if (!name || typeof name !== 'string') throw new Error('Package name is required');
  if (!/^[a-z0-9][a-z0-9._\-]+$/i.test(name) && !/^[a-z0-9][a-z0-9._\-]+==[0-9]/.test(name)) {
    throw new Error('Invalid package name');
  }
  return name;
}

class PythonService {
  constructor() {
    this.pyenvRoot = null;
    this._initialized = false;
  }

  // ── Pyenv Discovery ──────────────────────────────────

  async _findPyenvDir() {
    if (this.pyenvRoot) return this.pyenvRoot;

    const candidates = [
      process.env.PYENV_ROOT,
      '/usr/local/pyenv',
      `${process.env.HOME}/.pyenv`,
      '/root/.pyenv',
      '/opt/pyenv',
    ].filter(Boolean);

    for (const dir of candidates) {
      if (!dir) continue;
      try {
        await fs.access(`${dir}/bin/pyenv`);
        await fs.access(`${dir}/shims/pyenv`);
        this.pyenvRoot = dir;
        return dir;
      } catch {
        continue;
      }
    }

    // Try to find via which
    try {
      const { stdout } = await execAsync('which pyenv 2>/dev/null || echo ""');
      const pyenvPath = stdout.trim();
      if (pyenvPath) {
        // Resolve pyenv root
        const { stdout: root } = await execAsync('pyenv root 2>/dev/null || echo ""');
        const found = root.trim();
        if (found) {
          this.pyenvRoot = found;
          return found;
        }
      }
    } catch {
      // Not found
    }

    return null;
  }

  async _runPyenvCommand(args = []) {
    const root = await this._findPyenvDir();
    if (!root) throw new Error('Pyenv is not installed. Install it first.');

    const pyenvBin = `${root}/bin/pyenv`;
    const { stdout } = await execFileAsync(pyenvBin, args, {
      timeout: 60000,
      env: {
        ...process.env,
        PYENV_ROOT: root,
        PATH: `${root}/shims:${root}/bin:${process.env.PATH}`,
      },
    });
    return stdout.trim();
  }

  async _ensurePyenv() {
    if (!this._initialized) {
      const dir = await this._findPyenvDir();
      if (!dir) throw new Error('Pyenv is not installed. Install it first.');
      this.pyenvRoot = dir;
      this._initialized = true;
    }
  }

  // ── Pyenv Installation ───────────────────────────────

  async installPyenv() {
    if (process.platform === 'win32') {
      throw new Error('Pyenv is not natively supported on Windows. Use WSL or Docker.');
    }

    const existing = await this._findPyenvDir();
    if (existing) return { message: 'Pyenv is already installed', pyenvRoot: existing };

    try {
      const { stdout, stderr } = await execAsync(
        'curl -fsSL https://pyenv.run | bash',
        { timeout: 120000 }
      );

      // Add to profile
      try {
        const root = await this._findPyenvDir() || `${process.env.HOME}/.pyenv`;
        const profileContent = `
# Pyenv
export PYENV_ROOT="${root}"
export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init --path)"
eval "$(pyenv virtualenv-init -)"
`;
        await fs.writeFile('/etc/profile.d/pyenv.sh', profileContent, 'utf8');
        await execAsync('chmod +x /etc/profile.d/pyenv.sh').catch(() => {});
      } catch {
        // Non-critical
      }

      const newRoot = await this._findPyenvDir();
      if (!newRoot) throw new Error('Pyenv installation completed but directory not found.');

      this.pyenvRoot = newRoot;
      return { message: 'Pyenv installed successfully', pyenvRoot: newRoot, output: stdout + stderr };
    } catch (err) {
      throw new Error(`Failed to install Pyenv: ${err.message}`);
    }
  }

  // ── Python Version Management ─────────────────────────

  async getStatus() {
    const pyenvDir = await this._findPyenvDir();
    const isPyenvInstalled = !!pyenvDir;

    let currentVersion = 'Not found';
    let installedVersions = [];

    try {
      const { stdout } = await execAsync('python3 --version 2>/dev/null || python --version 2>/dev/null || echo "Not found"');
      currentVersion = stdout.trim().replace(/^Python\s+/i, '');
    } catch {
      currentVersion = 'Not found';
    }

    if (isPyenvInstalled) {
      try {
        const out = await this._runPyenvCommand(['versions', '--bare', '--skip-aliases']);
        installedVersions = out.split('\n').map(v => v.trim()).filter(Boolean);
      } catch {
        installedVersions = [];
      }
    }

    // Fallback: check system Python
    if (!installedVersions || installedVersions.length === 0) {
      try {
        await fs.access('/usr/bin/python3');
        installedVersions = ['system'];
      } catch {
        try {
          await fs.access('/usr/bin/python');
          installedVersions = ['system'];
        } catch {}
      }
    }

    return {
      pyenvInstalled: isPyenvInstalled,
      pyenvRoot: pyenvDir || null,
      currentVersion,
      installedVersions: [...new Set(installedVersions)],
    };
  }

  async listRemote(filter = 'all') {
    await this._ensurePyenv();
    try {
      const out = await this._runPyenvCommand(['install', '--list']);
      const versions = out.split('\n')
        .map(v => v.trim())
        .filter(v => v && /^\d+\.\d+\.\d+$/.test(v))
        .filter(v => {
          if (filter === 'stable') return !v.includes('dev') && !v.includes('a') && !v.includes('b') && !v.includes('rc');
          return true;
        });

      return versions;
    } catch (err) {
      throw new Error(`Failed to list remote versions: ${err.message}`);
    }
  }

  async installVersion(version) {
    validatePythonVersion(version);
    await this._ensurePyenv();
    logger.info(`Python: Installing ${version} via pyenv...`);
    try {
      const out = await this._runPyenvCommand(['install', version]);
      return { message: `Python ${version} installed successfully.`, output: out };
    } catch (err) {
      throw new Error(`Failed to install Python ${version}: ${err.message}`);
    }
  }

  async uninstallVersion(version) {
    validatePythonVersion(version);
    await this._ensurePyenv();
    try {
      const out = await this._runPyenvCommand(['uninstall', '-f', version]);
      return { message: `Python ${version} uninstalled.`, output: out };
    } catch (err) {
      throw new Error(`Failed to uninstall Python ${version}: ${err.message}`);
    }
  }

  async setGlobal(version) {
    if (!version || typeof version !== 'string') throw new Error('Version is required');
    if (version !== 'system' && !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version) && !/^[0-9]+\.[0-9]+$/.test(version)) {
      throw new Error('Invalid version format');
    }
    await this._ensurePyenv();
    try {
      const out = await this._runPyenvCommand(['global', version]);
      return { message: `Python ${version} set as global default.`, output: out };
    } catch (err) {
      throw new Error(`Failed to set global Python version: ${err.message}`);
    }
  }

  // ── Virtual Environments ──────────────────────────────

  async listVirtualEnvs() {
    try {
      // Check common venv locations
      const searchDirs = ['/opt', '/srv', '/var/www', `${process.env.HOME}`];
      const venvs = [];

      for (const dir of searchDirs) {
        if (!dir) continue;
        try {
          const entries = await fs.readdir(dir);
          for (const entry of entries) {
            const pyvenvCfg = path.join(dir, entry, 'pyvenv.cfg');
            try {
              await fs.access(pyvenvCfg);
              const content = await fs.readFile(pyvenvCfg, 'utf8');
              const versionMatch = content.match(/version\s*=\s*(.+)/i);
              venvs.push({
                name: entry,
                path: path.join(dir, entry),
                pythonVersion: versionMatch ? versionMatch[1].trim() : 'unknown',
                type: 'virtualenv',
              });
            } catch {
              continue;
            }
          }
        } catch {
          continue;
        }
      }

      return venvs;
    } catch (err) {
      logger.warn('Failed to list virtual envs:', err.message);
      return [];
    }
  }

  async createVirtualEnv(name, pythonVersion = '') {
    validateName(name);
    const targetDir = `/opt/${name}`;

    try {
      await fs.access(targetDir);
      throw new Error(`Directory ${targetDir} already exists`);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    let cmd;
    if (pythonVersion && pythonVersion !== 'system') {
      validatePythonVersion(pythonVersion);
      const pyenvRoot = await this._findPyenvDir();
      if (pyenvRoot) {
        // Use pyenv version
        cmd = `${pyenvRoot}/versions/${pythonVersion}/bin/python3 -m venv ${targetDir}`;
      } else {
        cmd = `python3 -m venv ${targetDir}`;
      }
    } else {
      cmd = `python3 -m venv ${targetDir}`;
    }

    try {
      await fs.mkdir(path.dirname(targetDir), { recursive: true });
      const { stdout } = await execAsync(cmd, { timeout: 60000 });
      return {
        message: `Virtual environment "${name}" created at ${targetDir}`,
        path: targetDir,
        output: stdout,
      };
    } catch (err) {
      throw new Error(`Failed to create virtual environment: ${err.message}`);
    }
  }

  async deleteVirtualEnv(name) {
    validateName(name);
    const targetDir = `/opt/${name}`;

    try {
      await fs.access(targetDir);
    } catch {
      throw new Error(`Virtual environment "${name}" not found at ${targetDir}`);
    }

    try {
      await fs.rm(targetDir, { recursive: true, force: true });
      return { message: `Virtual environment "${name}" deleted.` };
    } catch (err) {
      throw new Error(`Failed to delete virtual environment: ${err.message}`);
    }
  }

  // ── Pip Package Management ────────────────────────────

  async listPipPackages(venvPath = '') {
    try {
      const pipCmd = venvPath ? `${venvPath}/bin/pip` : 'pip3';
      const { stdout } = await execAsync(`${pipCmd} list --format=json 2>/dev/null || echo "[]"`);
      const packages = JSON.parse(stdout);
      return packages.map(p => ({
        name: p.name,
        version: p.version,
      }));
    } catch (err) {
      logger.warn('Failed to list pip packages:', err.message);
      return [];
    }
  }

  async installPipPackage(name, venvPath = '') {
    validatePipPackage(name);
    const pipCmd = venvPath ? `${venvPath}/bin/pip` : 'pip3';
    try {
      const { stdout } = await execAsync(`${pipCmd} install ${name} 2>&1`, { timeout: 120000 });
      return { message: `Package "${name}" installed.`, output: stdout };
    } catch (err) {
      throw new Error(`Failed to install package "${name}": ${err.message}`);
    }
  }

  async uninstallPipPackage(name, venvPath = '') {
    validatePipPackage(name);
    const pipCmd = venvPath ? `${venvPath}/bin/pip` : 'pip3';
    try {
      const { stdout } = await execAsync(`${pipCmd} uninstall -y ${name} 2>&1`, { timeout: 60000 });
      return { message: `Package "${name}" uninstalled.`, output: stdout };
    } catch (err) {
      throw new Error(`Failed to uninstall package "${name}": ${err.message}`);
    }
  }

  // ── Gunicorn/Uvicorn Management ───────────────────────

  async getWsgiServers() {
    // Check running gunicorn/uvicorn processes
    try {
      const { stdout } = await execAsync(
        `ps aux | grep -E '(gunicorn|uvicorn)' | grep -v grep || true`
      );
      const lines = stdout.trim().split('\n').filter(Boolean);
      return lines.map(line => {
        const parts = line.trim().split(/\s+/);
        const pid = parts[1];
        const cmd = parts.slice(10).join(' ') || 'unknown';
        const user = parts[0];
        const cpu = parts[2];
        const mem = parts[3];
        const name = cmd.match(/['"]?([a-zA-Z0-9_.-]+\.py|app:[a-z]+)['"]?/i);
        return {
          pid,
          user,
          cpu: cpu || '0',
          mem: mem || '0',
          command: cmd,
          name: name ? name[1] : 'python-app',
          type: cmd.includes('gunicorn') ? 'gunicorn' : 'uvicorn',
        };
      });
    } catch {
      return [];
    }
  }

  async startWsgi(config) {
    const { type, appModule, venvPath, port, workers, host } = config;

    if (!appModule) throw new Error('App module is required (e.g. myapp:app)');
    if (!/^[a-zA-Z0-9_.:]+$/.test(appModule)) throw new Error('Invalid app module format');

    const safeHost = host || '127.0.0.1';
    const safePort = parseInt(port) || 8000;
    const safeWorkers = parseInt(workers) || 4;
    const pythonBin = venvPath ? `${venvPath}/bin/python3` : 'python3';
    const pipBin = venvPath ? `${venvPath}/bin/pip` : 'pip3';

    // Determine server
    let serverType;
    let cmd;
    if (type === 'uvicorn') {
      serverType = 'uvicorn';
      cmd = `${pythonBin} -m uvicorn ${appModule} --host ${safeHost} --port ${safePort} --workers ${safeWorkers}`;
    } else {
      serverType = 'gunicorn';
      const wsgiModule = appModule.includes(':') ? appModule : `${appModule}:app`;
      cmd = `${pythonBin} -m gunicorn ${wsgiModule} --bind ${safeHost}:${safePort} --workers ${safeWorkers}`;
    }

    // Ensure the server is installed
    try {
      await execAsync(`${pipBin} install ${serverType} 2>&1`, { timeout: 60000 });
    } catch {}

    try {
      const workDir = venvPath ? path.dirname(venvPath) : process.cwd();
      const { stdout } = await execAsync(`cd ${workDir} && nohup ${cmd} > /tmp/${serverType}-${appModule.replace(/[^a-zA-Z0-9]/g, '_')}.log 2>&1 &`, {
        timeout: 10000,
      });
      return {
        message: `${serverType} started: ${appModule} on ${safeHost}:${safePort}`,
        output: stdout,
        pid: 'started',
      };
    } catch (err) {
      throw new Error(`Failed to start ${serverType}: ${err.message}`);
    }
  }

  async stopWsgi(pid) {
    if (!pid || !/^\d+$/.test(pid)) throw new Error('Valid PID is required');
    try {
      const { stdout } = await execAsync(`kill ${pid} 2>&1`, { timeout: 10000 });
      return { message: `Process ${pid} stopped.`, output: stdout };
    } catch (err) {
      throw new Error(`Failed to stop process ${pid}: ${err.message}`);
    }
  }

  // ── Supervisor Management ─────────────────────────────

  async getSupervisorStatus() {
    try {
      const { stdout } = await execAsync('supervisorctl status 2>/dev/null || echo ""');
      const lines = stdout.trim().split('\n').filter(Boolean);
      if (lines.length === 0) return { isInstalled: false, processes: [] };

      return {
        isInstalled: true,
        processes: lines.map(line => {
          const parts = line.trim().split(/\s+/);
          return {
            name: parts[0],
            status: parts[1],
            pid: parts[2] === 'PID' ? null : (parts[2] || null),
            uptime: parts.slice(3).join(' ') || '',
          };
        }),
      };
    } catch {
      return { isInstalled: false, processes: [] };
    }
  }

  async createSupervisorConfig(config) {
    const { name, command, user, directory, environment, numprocs } = config;
    if (!name) throw new Error('Program name is required');
    if (!command) throw new Error('Command is required');

    validateName(name);

    const safeUser = user || 'www-data';
    const safeDir = directory || '/opt';
    const safeNumprocs = parseInt(numprocs) || 1;
    const envStr = environment
      ? environment.split(',').map(e => e.trim()).filter(Boolean).join(',')
      : '';

    const confContent = `[program:${name}]
command=${command}
directory=${safeDir}
user=${safeUser}
numprocs=${safeNumprocs}
autostart=true
autorestart=true
startretries=3
stderr_logfile=/var/log/supervisor/${name}.err.log
stdout_logfile=/var/log/supervisor/${name}.out.log
${envStr ? `environment=${envStr}` : ''}
`;

    const confPath = `/etc/supervisor/conf.d/${name}.conf`;
    try {
      await fs.writeFile(confPath, confContent, 'utf8');
      try {
        await execAsync('supervisorctl reread && supervisorctl update', { timeout: 15000 });
      } catch {
        // supervisord may not be running
      }
      return {
        message: `Supervisor config created for "${name}"`,
        path: confPath,
      };
    } catch (err) {
      throw new Error(`Failed to create supervisor config: ${err.message}`);
    }
  }

  async supervisorAction(name, action) {
    validateName(name);
    if (!['start', 'stop', 'restart', 'status'].includes(action)) {
      throw new Error('Invalid action. Use: start, stop, restart, status');
    }
    try {
      const { stdout } = await execAsync(`supervisorctl ${action} ${name} 2>&1`, { timeout: 15000 });
      return { message: `Supervisor ${action} for "${name}"`, output: stdout };
    } catch (err) {
      throw new Error(`Failed to ${action} "${name}": ${err.message}`);
    }
  }

  // ── Python Info ───────────────────────────────────────

  async getPythonInfo() {
    const info = {};
    try {
      const { stdout } = await execAsync('python3 --version 2>/dev/null || python --version 2>/dev/null || echo "N/A"');
      info.version = stdout.trim().replace(/^Python\s+/i, '');
    } catch { info.version = 'N/A'; }

    try {
      const { stdout } = await execAsync('pip3 --version 2>/dev/null || pip --version 2>/dev/null || echo "N/A"');
      info.pipVersion = stdout.trim().split(' ')[1] || stdout.trim();
    } catch { info.pipVersion = 'N/A'; }

    try {
      const { stdout } = await execAsync('which python3 2>/dev/null || which python 2>/dev/null || echo "N/A"');
      info.pythonPath = stdout.trim();
    } catch { info.pythonPath = 'N/A'; }

    try {
      const { stdout } = await execAsync('python3 -c "import platform; print(platform.platform())" 2>/dev/null || echo "N/A"');
      info.platform = stdout.trim();
    } catch { info.platform = 'N/A'; }

    try {
      const { stdout } = await execAsync('which gunicorn 2>/dev/null || echo ""');
      info.gunicornInstalled = !!stdout.trim();
    } catch { info.gunicornInstalled = false; }

    try {
      const { stdout } = await execAsync('which uvicorn 2>/dev/null || echo ""');
      info.uvicornInstalled = !!stdout.trim();
    } catch { info.uvicornInstalled = false; }

    try {
      const { stdout } = await execAsync('which supervisorctl 2>/dev/null || echo ""');
      info.supervisorInstalled = !!stdout.trim();
    } catch { info.supervisorInstalled = false; }

    const pyenvDir = await this._findPyenvDir();
    info.pyenvDir = pyenvDir || null;
    info.pyenvInstalled = !!pyenvDir;

    return info;
  }
}

export default new PythonService();
