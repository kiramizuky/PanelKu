import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import logger from '../../config/logger.js';

const execFileAsync = promisify(execFile);

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

  /**
   * [SECURITY FIX] Run a command using execFile with args array — no shell interpreter.
   * Prevents command injection entirely.
   *
   * Usage: sudo('mv', ['/tmp/src', '/etc/dest'])
   */
  async sudo(cmd, args) {
    if (this.isWindows) return 'Mock command output';
    // If we're root, skip sudo
    if (process.getuid && process.getuid() === 0) {
      const { stdout } = await execFileAsync(cmd, args, { timeout: 10000 });
      return stdout.trim();
    }
    // Otherwise, use sudo with the command and args
    const { stdout } = await execFileAsync('sudo', [cmd, ...args], { timeout: 10000 });
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
    
    // [SECURITY FIX] Validate SSH key format to prevent command injection
    // Authorized_keys lines can have options before type, but we accept:
    // - Starts with a known key type prefix: ssh-rsa, ssh-ed25519, ecdsa-sha2-*, sk-*, etc.
    // - Contains base64-encoded key material
    // - Shell metacharacters are explicitly blocked
    if (!/^(ssh-|ecdsa-|sk-)/.test(trimmedKey)) {
      throw new Error('Invalid SSH public key format');
    }
    // Block shell metacharacters — no semicolons, pipes, backticks, $(), etc.
    if (/[;|&$`(){}<>]/.test(trimmedKey)) {
      throw new Error('SSH key contains invalid characters');
    }

    try {
      const keys = await this.getKeys();
      // Check if key already exists
      const keyOnly = trimmedKey.split(' ')[1] || trimmedKey;
      const exists = keys.some(k => k.raw.includes(keyOnly));
      if (exists) throw new Error('Key already exists in authorized_keys');

      if (!this.isWindows) {
        // [SECURITY FIX] Use fs + execFile instead of shell commands.
        // [BUG FIX] Read existing authorized_keys, append new key, write all back
        const tmpPath = '/tmp/authorized_keys_add';
        const existingContent = await fs.readFile(this.authorizedKeysPath, 'utf8').catch(() => '');
        await fs.writeFile(tmpPath, existingContent + trimmedKey + '\n', 'utf8');
        await this.sudo('mkdir', ['-p', '/root/.ssh']);
        await this.sudo('chmod', ['700', '/root/.ssh']);
        await this.sudo('cp', [tmpPath, this.authorizedKeysPath]);
        await this.sudo('chmod', ['600', this.authorizedKeysPath]);
        await fs.unlink(tmpPath).catch(() => {});
      } else {
        await fs.appendFile(this.authorizedKeysPath, trimmedKey + '\n', 'utf8');
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
        // [SECURITY FIX] Use execFile with args — no shell string interpolation
        const tmpPath = '/tmp/authorized_keys_temp';
        await fs.writeFile(tmpPath, updatedKeys, 'utf8');
        await this.sudo('mv', [tmpPath, this.authorizedKeysPath]);
        await this.sudo('chmod', ['600', this.authorizedKeysPath]);
        await fs.unlink(tmpPath).catch(() => {});
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
        // [SECURITY FIX] Use execFile with args — no shell string interpolation
        const tmpPath = '/tmp/sshd_config_temp_' + Date.now();
        await fs.writeFile(tmpPath, content, 'utf8');
        await this.sudo('cp', [tmpPath, this.sshdConfigPath]);
        await this.sudo('chmod', ['644', this.sshdConfigPath]);
        await fs.unlink(tmpPath).catch(() => {});
        // Restart ssh daemon — try ssh then sshd
        try {
          await this.sudo('systemctl', ['restart', 'ssh']);
        } catch {
          try {
            await this.sudo('systemctl', ['restart', 'sshd']);
          } catch (e) {
            logger.warn('Failed to restart SSH service: ' + e.message);
          }
        }
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
