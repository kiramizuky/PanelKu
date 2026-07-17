import { execFile } from 'child_process';
import util from 'util';
import logger from '../../config/logger.js';

const execFileAsync = util.promisify(execFile);

class FirewallService {
  /**
   * Run a UFW command using execFile (no shell interpreter).
   * Uses sudo if not running as root.
   */
  async sudo(args = []) {
    const bin = process.getuid && process.getuid() === 0 ? 'ufw' : 'sudo';
    const cmdArgs = process.getuid && process.getuid() === 0 ? args : ['ufw', ...args];

    try {
      const { stdout } = await execFileAsync(bin, cmdArgs, { timeout: 15000 });
      return stdout;
    } catch (error) {
      if (process.platform === 'win32' || (error.stderr && error.stderr.includes('not found'))) {
        logger.warn(`UFW not available. Mocking command: ufw ${args.join(' ')}`);
        return this.mockUfw(args.join(' '));
      }
      throw new Error(`Firewall error: ${error.stderr || error.message}`);
    }
  }

  mockUfw(argsStr) {
    if (argsStr.includes('status numbered')) {
      return `Status: active\n\n     To                         Action      From\n     --                         ------      ----\n[ 1] 22/tcp                     ALLOW IN    Anywhere\n[ 2] 80/tcp                     ALLOW IN    Anywhere\n[ 3] 443/tcp                    ALLOW IN    Anywhere\n[ 4] 3000/tcp                   ALLOW IN    Anywhere\n`;
    }
    if (argsStr.includes('status')) return 'Status: active';
    if (argsStr.includes('enable')) return 'Firewall is active and enabled on system startup';
    if (argsStr.includes('disable')) return 'Firewall stopped and disabled on system startup';
    return 'Rule added/deleted (mock)';
  }

  /** Validate port number (1-65535) */
  _validatePort(port) {
    const num = Number(port);
    if (!Number.isInteger(num) || num < 1 || num > 65535) {
      throw new Error(`Invalid port: "${port}". Must be a number between 1-65535.`);
    }
    return num;
  }

  /** Validate protocol — only tcp or udp */
  _validateProtocol(protocol) {
    const p = (protocol || 'tcp').toLowerCase();
    if (p !== 'tcp' && p !== 'udp') {
      throw new Error(`Invalid protocol: "${protocol}". Must be "tcp" or "udp".`);
    }
    return p;
  }

  /** Validate UFW action — only allow/deny/reject/limit */
  _validateAction(action) {
    const a = (action || 'allow').toLowerCase();
    if (!['allow', 'deny', 'reject', 'limit'].includes(a)) {
      throw new Error(`Invalid action: "${action}". Must be "allow", "deny", "reject", or "limit".`);
    }
    return a;
  }

  /** Validate rule ID — must be a positive integer */
  _validateRuleId(id) {
    const num = Number(id);
    if (!Number.isInteger(num) || num < 1) {
      throw new Error(`Invalid rule ID: "${id}". Must be a positive number.`);
    }
    return String(num);
  }

  async getStatus() {
    const stdout = await this.sudo(['status', 'numbered']);
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
    await this.sudo(['--force', 'enable']);
    return true;
  }

  async disable() {
    await this.sudo(['disable']);
    return true;
  }

  async addRule(port, protocol = 'tcp', action = 'allow') {
    const safePort = this._validatePort(port);
    const safeProtocol = this._validateProtocol(protocol);
    const safeAction = this._validateAction(action);
    await this.sudo([safeAction, `${safePort}/${safeProtocol}`]);
    return true;
  }

  async deleteRule(id) {
    const safeId = this._validateRuleId(id);
    await this.sudo(['--force', 'delete', safeId]);
    return true;
  }
}

export default new FirewallService();
