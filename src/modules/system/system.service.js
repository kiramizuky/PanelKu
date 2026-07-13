import { exec } from 'child_process';
import util from 'util';
import logger from '../../config/logger.js';
import packageManager from './package-manager.js';

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
    if (cmd.includes('apt update') || cmd.includes('pacman -Sy') || cmd.includes('dnf check-update') || cmd.includes('emerge --sync') || cmd.includes('mock update')) {
      return 'Reading package lists... Done\nBuilding dependency tree... Done\nAll packages are up to date.\n';
    }
    if (cmd.includes('apt upgrade') || cmd.includes('pacman -Syu') || cmd.includes('dnf upgrade') || cmd.includes('emerge -uDN') || cmd.includes('mock upgrade')) {
      return 'Reading package lists... Done\n0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n';
    }
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
      await packageManager.init();
      const cmd = packageManager.getCheckInstalledCommand(pkgName);
      const out = await this.runCommand(cmd);
      return out.trim().length > 0;
    } catch (e) {
      return false;
    }
  }

  async updateEnvVariable(key, value) {
    try {
      const fs = (await import('fs/promises')).default;
      const path = (await import('path')).default;
      const envPath = path.resolve('.env');
      let content = await fs.readFile(envPath, 'utf8');
      
      const regex = new RegExp(`^${key}=.*`, 'm');
      if (content.match(regex)) {
        content = content.replace(regex, `${key}=${value}`);
      } else {
        content += `\n${key}=${value}`;
      }
      await fs.writeFile(envPath, content, 'utf8');
      return true;
    } catch (e) {
      logger.error(`Failed to update .env variable ${key}: ${e.message}`);
      return false;
    }
  }

  async installPackage(pkgName, password = '') {
    if (!/^[a-zA-Z0-9_-]+$/.test(pkgName)) throw new Error('Invalid package name');
    logger.info(`Installing package: ${pkgName}`);

    await packageManager.init();

    if (pkgName === 'syncthing') {
      logger.info('Installing and configuring Syncthing...');
      const installCmd = packageManager.getInstallCommand('syncthing');
      await this.runCommand(installCmd);
      
      // Start syncthing service once so it creates configuration files
      await this.runCommand('systemctl enable syncthing@root && systemctl start syncthing@root').catch(() => {});
      
      // Wait a moment for config.xml to be generated
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Update binding address from 127.0.0.1:8384 to 0.0.0.0:8384 to allow external access
      const configPaths = [
        '/root/.config/syncthing/config.xml',
        '/root/.local/state/syncthing/config.xml'
      ];
      for (const configPath of configPaths) {
        await this.runCommand(`if [ -f ${configPath} ]; then sed -i 's/127.0.0.1:8384/0.0.0.0:8384/g' ${configPath}; fi`).catch(() => {});
      }
      
      // Restart syncthing to apply changes
      await this.runCommand('systemctl restart syncthing@root').catch(() => {});
      return 'Syncthing installed and configured successfully.';
    }

    const installCmd = packageManager.getInstallCommand(pkgName);
    const out = await this.runCommand(installCmd);

    if (password) {
      if (pkgName === 'mysql') {
        logger.info('Configuring MySQL root password...');
        const sqlCmds = [
          `sudo mysql -e "ALTER USER 'root'@'localhost' IDENTIFIED BY '${password}'; FLUSH PRIVILEGES;"`,
          `sudo mysql -e "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '${password}'; FLUSH PRIVILEGES;"`
        ];
        for (const sql of sqlCmds) {
          try {
            await this.runCommand(sql);
            break;
          } catch (_) {}
        }
        await this.updateEnvVariable('DB_MYSQL_PASSWORD', password);
      } else if (pkgName === 'postgres') {
        logger.info('Configuring PostgreSQL postgres password...');
        try {
          await this.runCommand('sudo postgresql-setup --initdb || sudo postgresql-setup initdb || true').catch(() => {});
          await this.runCommand('sudo systemctl enable postgresql && sudo systemctl start postgresql').catch(() => {});
          await this.runCommand(`sudo -u postgres psql -c "ALTER USER postgres PASSWORD '${password}';"`);
        } catch (_) {}
        await this.updateEnvVariable('DB_PG_PASSWORD', password);
      }
    }

    return out;
  }

  async getPackageManagerInfo() {
    await packageManager.init();
    return packageManager.getPMInfo();
  }

  async runUpdate() {
    await packageManager.init();
    const cmd = packageManager.getUpdateCommand();
    return await this.runCommand(cmd);
  }

  async runUpgrade() {
    await packageManager.init();
    const cmd = packageManager.getUpgradeCommand();
    return await this.runCommand(cmd);
  }

  async runAptUpdate() {
    return await this.runUpdate();
  }

  async runAptUpgrade() {
    return await this.runUpgrade();
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
      if (process.platform !== 'win32') {
        try {
          await packageManager.init();
          const updateCmd = packageManager.getUpdateCommand();
          const upgradeCmd = packageManager.getUpgradeCommand();
          // Use DEBIAN_FRONTEND=noninteractive for apt automatically inside getUpgradeCommand
          const cronContent = `#!/bin/bash\n# Auto-generated by Panelku\n${updateCmd} && ${upgradeCmd}\n`;
          const tmpCronPath = '/tmp/panelku-sysupdate';
          await fs.writeFile(tmpCronPath, cronContent, 'utf8');
          await this.runCommand(`sudo mv ${tmpCronPath} /etc/cron.daily/panelku-sysupdate`);
          await this.runCommand('sudo chmod +x /etc/cron.daily/panelku-sysupdate');
          logger.info('System auto-update enabled via cron.daily');
        } catch (e) {
          logger.error(`Failed to configure auto-update: ${e.message}`);
        }
      } else {
        logger.info('System auto-update enabled (mock Windows)');
      }
    } else {
      if (process.platform !== 'win32') {
        try {
          await this.runCommand('sudo rm -f /etc/cron.daily/panelku-sysupdate');
          logger.info('System auto-update disabled');
        } catch (e) {
          logger.error(`Failed to disable auto-update: ${e.message}`);
        }
      } else {
        logger.info('System auto-update disabled (mock Windows)');
      }
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
      const activeBranch = (await this.runCommand('git rev-parse --abbrev-ref HEAD 2>/dev/null')).trim() || 'master';
      const result = await this.runCommand(`git fetch origin && git log HEAD..origin/${activeBranch} --oneline 2>/dev/null | wc -l`);
      const behindCount = parseInt(result.trim()) || 0;
      hasUpdate = behindCount > 0;

      if (hasUpdate) {
        // Try to read version from remote package.json
        const remoteVer = await this.runCommand(`git show origin/${activeBranch}:package.json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('version',''))" 2>/dev/null`).catch(() => '');
        latest = remoteVer.trim() || `${current}+${behindCount}`;
      }
    } catch {
      // If git not available, just return current
    }

    return { current, latest, hasUpdate };
  }

  async runPanelUpdate(method = 'git', branch = 'main') {
    let log = '';
    const currentCommit = (await this.runCommand('git rev-parse HEAD 2>/dev/null').catch(() => '')).trim();

    if (method === 'git') {
      const localBranch = (await this.runCommand('git rev-parse --abbrev-ref HEAD 2>/dev/null')).trim() || 'master';
      const targetBranch = branch === 'main' && localBranch !== 'main' ? localBranch : branch;

      // Mark directory safe for root
      log += await this.runCommand('git config --global --add safe.directory /opt/panelku 2>&1').catch(() => '');
      log += await this.runCommand('cd /opt/panelku && git checkout package-lock.json 2>&1').catch(() => '');
      log += await this.runCommand(`cd /opt/panelku && git pull origin ${targetBranch} 2>&1`).catch(e => `[git pull error] ${e.message}`);
      log += '\n';
      log += await this.runCommand('cd /opt/panelku && npm install --production 2>&1').catch(e => `[npm install error] ${e.message}`);
    } else if (method === 'npm') {
      log += await this.runCommand('cd /opt/panelku && npm install --production 2>&1').catch(e => `[npm install error] ${e.message}`);
    }

    // Verify syntax and boot of the new code (dry run check)
    let syntaxCheckSuccess = false;
    try {
      if (process.platform !== 'win32') {
        await execAsync('node --check src/app.js');
      }
      syntaxCheckSuccess = true;
    } catch (err) {
      log += `\n[Syntax verification failed] ${err.message}\nTriggering auto-rollback...\n`;
    }

    if (!syntaxCheckSuccess && currentCommit) {
      log += await this.runCommand(`git reset --hard ${currentCommit} && npm install --production 2>&1`);
      log += `\n[Rollback Complete] System restored to commit ${currentCommit}.\n`;
      return log;
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
    }, 5000);

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

  async getAuditStats() {
    const db = getDb();
    
    const logins = db.prepare(`
      SELECT date(created_at) as date, COUNT(*) as count 
      FROM audit_logs 
      WHERE action = 'login' 
      GROUP BY date(created_at) 
      ORDER BY date(created_at) DESC 
      LIMIT 7
    `).all();

    const cmdCountByDate = {};
    const cmdFreq = {};
    const logPath = path.resolve(process.cwd(), 'storage', 'logs', 'terminal_audit.log');
    
    try {
      const fs = (await import('fs/promises')).default;
      const content = await fs.readFile(logPath, 'utf8').catch(() => '');
      const lines = content.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        const match = line.match(/^\[([^\]]+)\]\s+User:\s+([^\s|]+)\s+\|\s+Command:\s+(.+)$/);
        if (match) {
          const dateStr = match[1].split('T')[0];
          cmdCountByDate[dateStr] = (cmdCountByDate[dateStr] || 0) + 1;
          
          const fullCmd = match[3].trim();
          const baseCmd = fullCmd.split(' ')[0];
          cmdFreq[baseCmd] = (cmdFreq[baseCmd] || 0) + 1;
        }
      }
    } catch (e) {
      logger.warn('Failed to parse terminal audit log: ' + e.message);
    }

    const sortedDates = Object.keys(cmdCountByDate).sort().reverse().slice(0, 7);
    const terminalCmds = sortedDates.map(d => ({ date: d, count: cmdCountByDate[d] }));

    const topCommands = Object.entries(cmdFreq)
      .map(([cmd, count]) => ({ cmd, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      logins,
      terminalCmds,
      topCommands
    };
  }

  async getAuditLogs(limit = 100) {
    const db = getDb();
    
    const sysLogs = db.prepare(`
      SELECT * FROM audit_logs 
      ORDER BY created_at DESC 
      LIMIT ?
    `).all(limit).map(r => ({
      type: 'system',
      timestamp: r.created_at,
      username: r.username,
      action: r.action,
      details: r.details || `${r.action} on ${r.resource || 'system'}`
    }));

    const termLogs = [];
    const logPath = path.resolve(process.cwd(), 'storage', 'logs', 'terminal_audit.log');
    try {
      const fs = (await import('fs/promises')).default;
      const content = await fs.readFile(logPath, 'utf8').catch(() => '');
      const lines = content.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        const match = line.match(/^\[([^\]]+)\]\s+User:\s+([^\s|]+)\s+\|\s+Command:\s+(.+)$/);
        if (match) {
          termLogs.push({
            type: 'terminal',
            timestamp: match[1],
            username: match[2],
            action: 'terminal_input',
            details: match[3]
          });
        }
      }
    } catch {}

    const merged = [...sysLogs, ...termLogs]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);

    return { logs: merged };
  }
}

export default new SystemService();
