import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import sshService from '../modules/system/ssh.service.js';
import { getDb } from '../core/db/sqlite.js';
import bcrypt from 'bcryptjs';

const execAsync = promisify(exec);
const isWindows = process.platform === 'win32';

export async function runSecurityScan() {
  const issues = [];
  let score = 100;

  // 1. Check default credentials
  try {
    const db = getDb();
    const admin = db.prepare('SELECT password FROM users WHERE username = ?').get('admin');
    if (admin && await bcrypt.compare('Admin@123456', admin.password)) {
      score -= 25;
      issues.push({
        id: 'default_password',
        title: 'Default Admin Password',
        description: 'The default username "admin" is still using the default password "Admin@123456". This is a severe security risk.',
        severity: 'danger',
        fixable: false,
        recommendation: 'Change the admin password in the Profile/Settings page immediately.'
      });
    }
  } catch (e) {}

  // 2. Check SSH config (Port 22 and Password Authentication)
  try {
    const sshConfig = await sshService.getSSHConfig();
    if (sshConfig.port === 22) {
      score -= 15;
      issues.push({
        id: 'ssh_default_port',
        title: 'Default SSH Port (22)',
        description: 'SSH service is running on the default port 22. Attackers regularly scan this port for brute-force entry.',
        severity: 'warning',
        fixable: true,
        recommendation: 'Change the SSH port to a non-standard value (e.g., 2222) in the Settings page.'
      });
    }
    if (sshConfig.passwordAuth) {
      score -= 15;
      issues.push({
        id: 'ssh_password_auth',
        title: 'SSH Password Authentication Enabled',
        description: 'Password authentication is enabled for SSH. Key-based authentication is significantly more secure.',
        severity: 'warning',
        fixable: true,
        recommendation: 'Disable Password Authentication in SSH configuration after setting up SSH Keys.'
      });
    }
  } catch (e) {}

  // 3. Check Firewall (UFW)
  try {
    if (!isWindows) {
      const { stdout } = await execAsync('sudo ufw status').catch(() => ({ stdout: 'Status: inactive' }));
      if (stdout.includes('inactive')) {
        score -= 20;
        issues.push({
          id: 'ufw_inactive',
          title: 'Firewall (UFW) Inactive',
          description: 'The Uncomplicated Firewall (UFW) is not active. Your server might be exposed to unauthorized traffic.',
          severity: 'warning',
          fixable: true,
          recommendation: 'Enable UFW to block unneeded public ports.'
        });
      }
    }
  } catch (e) {}

  // 4. Check Nginx directory permissions
  try {
    const targetDir = isWindows ? path.resolve('storage') : '/var/www';
    const stat = await fs.stat(targetDir).catch(() => null);
    if (stat) {
      const mode = (stat.mode & 0o777).toString(8);
      if (mode === '777') {
        score -= 25;
        issues.push({
          id: 'directory_writable_by_all',
          title: 'Public Web Directory Writable By All (777)',
          description: `The directory ${targetDir} is configured with permission mode 777. Any local user can execute or delete files.`,
          severity: 'danger',
          fixable: true,
          recommendation: `Change directory permissions to 755 (rwxr-xr-x).`
        });
      }
    }
  } catch (e) {}

  return {
    score: Math.max(0, score),
    issues
  };
}

export async function fixSecurityIssue(issueId) {
  if (isWindows) return { success: true, message: 'Simulated fix completed successfully on Windows.' };

  if (issueId === 'ssh_default_port') {
    // Change SSH port to a secure random default (e.g. 2345)
    await sshService.updateSSHConfig({ port: 2345 });
    return { success: true, message: 'SSH port changed to 2345. SSH service restarted.' };
  }

  if (issueId === 'ssh_password_auth') {
    await sshService.updateSSHConfig({ passwordAuth: false });
    return { success: true, message: 'Password Authentication disabled in sshd_config. SSH service restarted.' };
  }

  if (issueId === 'ufw_inactive') {
    await execAsync('sudo ufw --force enable && sudo ufw allow 23456/tcp && sudo ufw allow ssh');
    return { success: true, message: 'UFW Firewall enabled. Allowed Panelku port (23456) and SSH.' };
  }

  if (issueId === 'directory_writable_by_all') {
    await execAsync('sudo chmod 755 /var/www');
    return { success: true, message: 'Directory permissions for /var/www updated to 755.' };
  }

  throw new Error('Unknown or unfixable issue ID: ' + issueId);
}
