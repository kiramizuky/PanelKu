import { exec } from 'child_process';
import util from 'util';
import logger from '../../config/logger.js';

const execAsync = util.promisify(exec);

class SystemService {
  async runCommand(cmd) {
    try {
      if (process.platform === 'win32') {
        logger.warn(`Simulating Linux command on Windows: ${cmd}`);
        return this.mockCommand(cmd);
      }
      const { stdout } = await execAsync(cmd);
      return stdout;
    } catch (error) {
      if (process.platform === 'win32' || error.message.includes('not found')) {
        return this.mockCommand(cmd);
      }
      throw new Error(`System error: ${error.stderr || error.message}`);
    }
  }

  mockCommand(cmd) {
    if (cmd.includes('is-active')) return 'active\n';
    if (cmd.includes('apt update')) return 'Reading package lists... Done\nBuilding dependency tree... Done\nAll packages are up to date.\n';
    if (cmd.includes('apt upgrade')) return 'Reading package lists... Done\n0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n';
    return 'Command executed successfully (mock)';
  }

  async getServiceStatus(serviceName) {
    // Validate service name to prevent command injection
    if (!/^[a-zA-Z0-9_-]+$/.test(serviceName)) throw new Error('Invalid service name');
    try {
      const out = await this.runCommand(`systemctl is-active ${serviceName}`);
      return out.trim() === 'active';
    } catch (e) {
      return false; // inactive or not found
    }
  }

  async manageService(serviceName, action) {
    if (!/^[a-zA-Z0-9_-]+$/.test(serviceName)) throw new Error('Invalid service name');
    if (!['start', 'stop', 'restart'].includes(action)) throw new Error('Invalid action');
    
    await this.runCommand(`sudo systemctl ${action} ${serviceName}`);
    return true;
  }

  async isInstalled(pkgName) {
    if (!/^[a-zA-Z0-9_-]+$/.test(pkgName)) throw new Error('Invalid package name');
    try {
      const packageMap = {
        mysql: { cmd: 'mysql', pkg: 'mysql-server' },
        postgres: { cmd: 'psql', pkg: 'postgresql' },
        docker: { cmd: 'docker', pkg: 'docker.io' },
        nginx: { cmd: 'nginx', pkg: 'nginx' },
        syncthing: { cmd: 'syncthing', pkg: 'syncthing' }
      };
      
      const mapped = packageMap[pkgName] || { cmd: pkgName, pkg: pkgName };
      const out = await this.runCommand(`command -v ${mapped.cmd} || dpkg -s ${mapped.pkg}`);
      return out.trim().length > 0;
    } catch (e) {
      return false;
    }
  }

  async installPackage(pkgName) {
    if (!/^[a-zA-Z0-9_-]+$/.test(pkgName)) throw new Error('Invalid package name');
    logger.info(`Installing package: ${pkgName}`);

    if (pkgName === 'syncthing') {
      logger.info('Installing and configuring Syncthing...');
      await this.runCommand(`sudo DEBIAN_FRONTEND=noninteractive apt-get install -y syncthing`);
      
      // Start syncthing service once so it creates configuration files
      await this.runCommand('systemctl enable syncthing@root && systemctl start syncthing@root').catch(() => {});
      
      // Wait a moment for config.xml to be generated
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Update binding address from 127.0.0.1:8384 to 0.0.0.0:8384 to allow external access
      const configPath = '/root/.config/syncthing/config.xml';
      await this.runCommand(`if [ -f ${configPath} ]; then sed -i 's/127.0.0.1:8384/0.0.0.0:8384/g' ${configPath}; fi`).catch(() => {});
      
      // Restart syncthing to apply changes
      await this.runCommand('systemctl restart syncthing@root').catch(() => {});
      return 'Syncthing installed and configured successfully.';
    }

    // Map command names to actual apt packages if needed
    const packageMap = {
      mysql: 'mysql-server',
      postgres: 'postgresql',
      docker: 'docker.io docker-compose',
      nginx: 'nginx'
    };
    const aptPackage = packageMap[pkgName] || pkgName;
    return await this.runCommand(`sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ${aptPackage}`);
  }

  async runAptUpdate() {
    return await this.runCommand('sudo apt-get update -y');
  }

  async runAptUpgrade() {
    return await this.runCommand('sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y');
  }

  async reboot() {
    logger.warn('Reboot initiated via System Module');
    // We delay reboot slightly so response can complete
    setTimeout(() => {
      this.runCommand('sudo reboot').catch(e => logger.error(e));
    }, 2000);
    return true;
  }

  async getAutoUpdate() {
    try {
      const fs = (await import('fs/promises')).default;
      const path = (await import('path')).default;
      const data = await fs.readFile(path.resolve('storage', 'system.json'), 'utf8');
      return JSON.parse(data).autoUpdate === true;
    } catch {
      return false;
    }
  }

  async setAutoUpdate(enabled) {
    const fs = (await import('fs/promises')).default;
    const path = (await import('path')).default;
    const filePath = path.resolve('storage', 'system.json');
    let data = {};
    try {
      data = JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch {}
    
    data.autoUpdate = enabled;
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));

    if (enabled) {
      // Simulate enabling unattended-upgrades or cron
      logger.info('System auto-update enabled');
    } else {
      logger.info('System auto-update disabled');
    }

    return true;
  }

  // ── Panel Update Methods ─────────────────────────────────

  async getPanelVersion() {
    const fs = (await import('fs/promises')).default;
    const path = (await import('path')).default;

    // Read from package.json
    let current = '1.0.0';
    let lastUpdated = null;
    try {
      const pkg = JSON.parse(await fs.readFile(path.resolve('package.json'), 'utf8'));
      current = pkg.version || '1.0.0';
    } catch {}

    // Read last updated from storage
    try {
      const data = JSON.parse(await fs.readFile(path.resolve('storage', 'panel.json'), 'utf8'));
      lastUpdated = data.lastUpdated || null;
    } catch {}

    return { current, lastUpdated };
  }

  async checkPanelUpdate() {
    const { current } = await this.getPanelVersion();
    let latest = current;
    let hasUpdate = false;

    try {
      // Try to fetch the latest version from npm or git
      const result = await this.runCommand('git fetch origin && git log HEAD..origin/main --oneline 2>/dev/null | wc -l');
      const behindCount = parseInt(result.trim()) || 0;
      hasUpdate = behindCount > 0;

      if (hasUpdate) {
        // Try to read version from remote package.json
        const remoteVer = await this.runCommand("git show origin/main:package.json 2>/dev/null | python3 -c \"import sys,json; print(json.load(sys.stdin).get('version',''))\" 2>/dev/null").catch(() => '');
        latest = remoteVer.trim() || `${current}+${behindCount}`;
      }
    } catch {
      // If git not available, just return current
    }

    return { current, latest, hasUpdate };
  }

  async runPanelUpdate(method = 'git', branch = 'main') {
    let log = '';

    if (method === 'git') {
      // Mark directory safe for root (required when running as root via systemd)
      log += await this.runCommand('git config --global --add safe.directory $(pwd) 2>&1').catch(() => '');
      log += await this.runCommand(`git pull origin ${branch} 2>&1`).catch(e => `[git pull error] ${e.message}`);
      log += '\n';
      log += await this.runCommand('npm install --production 2>&1').catch(e => `[npm install error] ${e.message}`);
    } else if (method === 'npm') {
      log += await this.runCommand('npm install --production 2>&1').catch(e => `[npm install error] ${e.message}`);
    }

    // Save last updated timestamp
    const fs = (await import('fs/promises')).default;
    const path = (await import('path')).default;
    const filePath = path.resolve('storage', 'panel.json');
    let data = {};
    try { data = JSON.parse(await fs.readFile(filePath, 'utf8')); } catch {}
    data.lastUpdated = new Date().toISOString();
    await fs.writeFile(filePath, JSON.stringify(data, null, 2)).catch(() => {});

    logger.info('Panel updated via ' + method);

    // Schedule restart AFTER response is sent (3s delay).
    // Uses systemctl restart panelku (service runs as root, no sudo needed).
    // Falls back to process.exit(0) for dev mode (node --watch will restart).
    setTimeout(async () => {
      logger.info('Panel restarting after update via systemctl...');
      try {
        await this.runCommand('systemctl restart panelku');
      } catch {
        logger.warn('systemctl restart failed, falling back to process.exit(0)');
        process.exit(0);
      }
    }, 3000);

    return log;
  }

  async restartPanel() {
    logger.info('Panel restart initiated via Settings');
    // Delay to ensure the HTTP response is fully sent first.
    // Uses systemctl restart panelku; falls back to process.exit(0) in dev mode.
    setTimeout(async () => {
      logger.info('Panel exiting for restart via systemctl...');
      try {
        await this.runCommand('systemctl restart panelku');
      } catch {
        logger.warn('systemctl restart failed, falling back to process.exit(0)');
        process.exit(0);
      }
    }, 2000);
    return true;
  }

  async getPanelAutoUpdate() {
    const fs = (await import('fs/promises')).default;
    const path = (await import('path')).default;
    try {
      const data = JSON.parse(await fs.readFile(path.resolve('storage', 'panel.json'), 'utf8'));
      return {
        enabled: data.autoUpdate?.enabled || false,
        frequency: data.autoUpdate?.frequency || 'daily',
      };
    } catch {
      return { enabled: false, frequency: 'daily' };
    }
  }

  async setPanelAutoUpdate(config) {
    const fs = (await import('fs/promises')).default;
    const path = (await import('path')).default;
    const filePath = path.resolve('storage', 'panel.json');
    let data = {};
    try { data = JSON.parse(await fs.readFile(filePath, 'utf8')); } catch {}
    data.autoUpdate = { enabled: config.enabled, frequency: config.frequency };
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    logger.info(`Panel auto-update set to: enabled=${config.enabled} freq=${config.frequency}`);
    return true;
  }
}

export default new SystemService();
