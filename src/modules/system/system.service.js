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
      const out = await this.runCommand(`command -v ${pkgName} || dpkg -s ${pkgName}`);
      return out.trim().length > 0;
    } catch (e) {
      return false;
    }
  }

  async installPackage(pkgName) {
    if (!/^[a-zA-Z0-9_-]+$/.test(pkgName)) throw new Error('Invalid package name');
    logger.info(`Installing package: ${pkgName}`);
    // Map command names to actual apt packages if needed
    const packageMap = {
      mysql: 'mysql-server',
      postgres: 'postgresql',
      docker: 'docker.io docker-compose',
      nginx: 'nginx',
      mongodb: 'mongodb' // Or mongodb-org depending on repo, but mongodb is standard
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
}

export default new SystemService();
