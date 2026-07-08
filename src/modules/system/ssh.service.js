import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import logger from '../../config/logger.js';

const execAsync = promisify(exec);

class SSHService {
  constructor() {
    this.authorizedKeysPath = '/root/.ssh/authorized_keys';
    this.sshdConfigPath = '/etc/ssh/sshd_config';
    this.isWindows = process.platform === 'win32';

    if (this.isWindows) {
      this.authorizedKeysPath = path.resolve('storage', 'mock_authorized_keys');
      this.sshdConfigPath = path.resolve('storage', 'mock_sshd_config');
    }
  }

  async runCommand(cmd) {
    if (this.isWindows) return 'Mock command output';
    const { stdout } = await execAsync(cmd);
    return stdout.trim();
  }

  async getKeys() {
    try {
      if (this.isWindows) {
        // Ensure mock file exists
        await fs.mkdir(path.dirname(this.authorizedKeysPath), { recursive: true });
        try { await fs.access(this.authorizedKeysPath); } catch { await fs.writeFile(this.authorizedKeysPath, '', 'utf8'); }
      }
      
      const content = await fs.readFile(this.authorizedKeysPath, 'utf8');
      return content.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'))
        .map((line, idx) => {
          const parts = line.split(' ');
          const type = parts[0] || 'ssh-rsa';
          const key = parts[1] || '';
          const comment = parts.slice(2).join(' ') || `Key #${idx + 1}`;
          return { id: idx, type, key, comment, raw: line };
        });
    } catch (err) {
      logger.error(`Failed to read SSH keys: ${err.message}`);
      return [];
    }
  }

  async addKey(keyString) {
    const trimmedKey = keyString.trim();
    if (!trimmedKey) throw new Error('Key cannot be empty');
    
    // Simple verification
    if (!trimmedKey.startsWith('ssh-') && !trimmedKey.startsWith('ecdsa-')) {
      throw new Error('Invalid SSH public key format');
    }

    try {
      const keys = await this.getKeys();
      // Check if key already exists
      const keyOnly = trimmedKey.split(' ')[1] || trimmedKey;
      const exists = keys.some(k => k.raw.includes(keyOnly));
      if (exists) throw new Error('Key already exists in authorized_keys');

      if (!this.isWindows) {
        // Ensure .ssh dir exists with right perms
        await this.runCommand('sudo mkdir -p /root/.ssh && sudo chmod 700 /root/.ssh');
        // Append key
        await this.runCommand(`echo "${trimmedKey}" | sudo tee -a ${this.authorizedKeysPath} > /dev/null`);
        await this.runCommand(`sudo chmod 600 ${this.authorizedKeysPath}`);
      } else {
        await fs.appendFile(this.authorizedKeysPath, `${trimmedKey}\n`, 'utf8');
      }

      logger.info('SSH public key added successfully');
      return true;
    } catch (err) {
      logger.error(`Failed to add SSH key: ${err.message}`);
      throw err;
    }
  }

  async deleteKey(keyIndex) {
    try {
      const keys = await this.getKeys();
      const idx = parseInt(keyIndex);
      if (isNaN(idx) || idx < 0 || idx >= keys.length) {
        throw new Error('Invalid key index');
      }

      const updatedKeys = keys.filter((_, i) => i !== idx).map(k => k.raw).join('\n') + '\n';
      
      if (!this.isWindows) {
        const tmpPath = '/tmp/authorized_keys_temp';
        await fs.writeFile(tmpPath, updatedKeys, 'utf8');
        await this.runCommand(`sudo mv ${tmpPath} ${this.authorizedKeysPath}`);
        await this.runCommand(`sudo chmod 600 ${this.authorizedKeysPath}`);
      } else {
        await fs.writeFile(this.authorizedKeysPath, updatedKeys, 'utf8');
      }

      logger.info('SSH public key deleted successfully');
      return true;
    } catch (err) {
      logger.error(`Failed to delete SSH key: ${err.message}`);
      throw err;
    }
  }

  async getSSHConfig() {
    try {
      if (this.isWindows) {
        await fs.mkdir(path.dirname(this.sshdConfigPath), { recursive: true });
        try { await fs.access(this.sshdConfigPath); } catch { await fs.writeFile(this.sshdConfigPath, 'Port 22\nPasswordAuthentication yes\n', 'utf8'); }
      }

      const content = await fs.readFile(this.sshdConfigPath, 'utf8');
      const portMatch = content.match(/^Port\s+(\d+)/m);
      const passAuthMatch = content.match(/^PasswordAuthentication\s+(yes|no)/im);

      return {
        port: portMatch ? parseInt(portMatch[1]) : 22,
        passwordAuth: passAuthMatch ? passAuthMatch[1].toLowerCase() === 'yes' : true
      };
    } catch (err) {
      logger.error(`Failed to read sshd_config: ${err.message}`);
      return { port: 22, passwordAuth: true };
    }
  }

  async updateSSHConfig({ port, passwordAuth }) {
    try {
      const current = await this.getSSHConfig();
      const newPort = port !== undefined ? parseInt(port) : current.port;
      const newPassAuth = passwordAuth !== undefined ? (passwordAuth ? 'yes' : 'no') : (current.passwordAuth ? 'yes' : 'no');

      if (isNaN(newPort) || newPort < 1 || newPort > 65535) {
        throw new Error('Invalid SSH port number');
      }

      let content = await fs.readFile(this.sshdConfigPath, 'utf8');

      // Update port
      if (content.match(/^Port\s+/m)) {
        content = content.replace(/^Port\s+.*$/m, `Port ${newPort}`);
      } else {
        content += `\nPort ${newPort}`;
      }

      // Update PasswordAuthentication
      if (content.match(/^PasswordAuthentication\s+/im)) {
        content = content.replace(/^PasswordAuthentication\s+.*$/im, `PasswordAuthentication ${newPassAuth}`);
      } else {
        content += `\nPasswordAuthentication ${newPassAuth}`;
      }

      if (!this.isWindows) {
        const tmpPath = '/tmp/sshd_config_temp';
        await fs.writeFile(tmpPath, content, 'utf8');
        await this.runCommand(`sudo mv ${tmpPath} ${this.sshdConfigPath}`);
        await this.runCommand(`sudo chmod 644 ${this.sshdConfigPath}`);
        // Restart ssh daemon
        await this.runCommand('sudo systemctl restart ssh || sudo systemctl restart sshd');
      } else {
        await fs.writeFile(this.sshdConfigPath, content, 'utf8');
      }

      logger.info('sshd_config updated and SSH service restarted');
      return true;
    } catch (err) {
      logger.error(`Failed to update sshd_config: ${err.message}`);
      throw err;
    }
  }
}

export default new SSHService();
