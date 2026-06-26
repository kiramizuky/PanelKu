import { exec } from 'child_process';
import util from 'util';
import logger from '../../config/logger.js';

const execAsync = util.promisify(exec);

class FirewallService {
  /**
   * Run a UFW command. Needs sudo privileges in real usage.
   * Since this is a test environment on Windows, we mock it if ufw is not found.
   */
  async runCommand(args) {
    try {
      // In a real Linux environment, you would run 'sudo ufw ...'
      // If we are on Windows or ufw is not installed, we fallback to mock data
      const { stdout } = await execAsync(`ufw ${args}`);
      return stdout;
    } catch (error) {
      if (process.platform === 'win32' || error.message.includes('not found')) {
        logger.warn(`UFW not available. Mocking command: ufw ${args}`);
        return this.mockUfw(args);
      }
      throw new Error(`Firewall error: ${error.stderr || error.message}`);
    }
  }

  mockUfw(args) {
    if (args.includes('status numbered')) {
      return `Status: active\n\n     To                         Action      From\n     --                         ------      ----\n[ 1] 22/tcp                     ALLOW IN    Anywhere\n[ 2] 80/tcp                     ALLOW IN    Anywhere\n[ 3] 443/tcp                    ALLOW IN    Anywhere\n[ 4] 3000/tcp                   ALLOW IN    Anywhere\n`;
    }
    if (args.includes('status')) return 'Status: active';
    if (args.includes('enable')) return 'Firewall is active and enabled on system startup';
    if (args.includes('disable')) return 'Firewall stopped and disabled on system startup';
    return 'Rule added/deleted (mock)';
  }

  async getStatus() {
    const stdout = await this.runCommand('status numbered');
    const isActive = stdout.includes('Status: active');
    const rules = [];

    if (isActive) {
      const lines = stdout.split('\n');
      let parsing = false;
      for (const line of lines) {
        if (line.includes('--')) {
          parsing = true;
          continue;
        }
        if (parsing && line.trim()) {
          // Parse lines like: "[ 1] 80/tcp ALLOW IN Anywhere"
          const match = line.match(/\[\s*(\d+)\]\s+(\S+)\s+(ALLOW|DENY)\s+(IN|OUT)\s+(.*)/);
          if (match) {
            rules.push({
              id: match[1],
              to: match[2],
              action: match[3],
              direction: match[4],
              from: match[5],
            });
          }
        }
      }
    }

    return { isActive, rules };
  }

  async enable() {
    await this.runCommand('--force enable');
    return true;
  }

  async disable() {
    await this.runCommand('disable');
    return true;
  }

  async addRule(port, protocol = 'tcp', action = 'allow') {
    const cmd = `${action} ${port}/${protocol}`;
    await this.runCommand(cmd);
    return true;
  }

  async deleteRule(id) {
    await this.runCommand(`--force delete ${id}`);
    return true;
  }
}

export default new FirewallService();
