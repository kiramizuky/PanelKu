/**
 * Security Health & Vulnerability Scanner Service
 * Scans OS packages, SSH hardening, open ports, firewall, and file permissions.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { getDb, generateId, now, toJson, fromJson } from '../../core/db/sqlite.js';
import logger from '../../config/logger.js';

const execAsync = promisify(exec);

class SecurityScannerService {
  /**
   * Run full security audit scan
   */
  async runScan() {
    const findings = [];
    let score = 100;

    // 1. Check Firewall (UFW) Status
    try {
      const { stdout } = await execAsync('ufw status 2>/dev/null || echo "inactive"');
      const isUfwActive = stdout.toLowerCase().includes('status: active');
      if (!isUfwActive) {
        score -= 20;
        findings.push({
          id: 'fw-disabled',
          category: 'Firewall',
          title: 'Uncomplicated Firewall (UFW) is Inactive',
          description: 'The server firewall is disabled, exposing all listening ports directly to the internet.',
          severity: 'critical',
          scoreImpact: 20,
          canAutoFix: true,
          fixAction: 'enable_firewall',
        });
      }
    } catch {
      // Non-Linux or simulation fallback
    }

    // 2. Check SSH Configuration Hardening
    try {
      let sshConfig = '';
      if (fs.existsSync('/etc/ssh/sshd_config')) {
        sshConfig = fs.readFileSync('/etc/ssh/sshd_config', 'utf8');
      }

      if (sshConfig) {
        // Root login check
        const rootMatch = sshConfig.match(/^PermitRootLogin\s+(\w+)/m);
        const rootVal = rootMatch ? rootMatch[1].toLowerCase() : 'yes'; // Default in older distros is yes
        if (rootVal === 'yes') {
          score -= 15;
          findings.push({
            id: 'ssh-root-enabled',
            category: 'SSH',
            title: 'Direct SSH Root Login is Enabled',
            description: 'Direct root login increases the risk of automated brute-force attacks compromising the superuser account.',
            severity: 'high',
            scoreImpact: 15,
            canAutoFix: true,
            fixAction: 'disable_ssh_root',
          });
        }

        // Password Authentication check
        const pwdMatch = sshConfig.match(/^PasswordAuthentication\s+(\w+)/m);
        const pwdVal = pwdMatch ? pwdMatch[1].toLowerCase() : 'yes';
        if (pwdVal === 'yes') {
          score -= 10;
          findings.push({
            id: 'ssh-password-auth',
            category: 'SSH',
            title: 'SSH Password Authentication is Enabled',
            description: 'SSH allows password-based authentication. Using SSH public keys only is significantly more secure.',
            severity: 'medium',
            scoreImpact: 10,
            canAutoFix: true,
            fixAction: 'enforce_ssh_keys',
          });
        }
      }
    } catch (err) {
      logger.debug(`[SecurityScanner] SSH config check skipped: ${err.message}`);
    }

    // 3. Check OS Package Security Updates & CVEs
    try {
      const { stdout } = await execAsync('apt-get -s upgrade 2>/dev/null | grep -i security || apt list --upgradable 2>/dev/null | grep -i security || true');
      const securityLines = stdout.trim().split('\n').filter(Boolean);
      const secCount = securityLines.length;

      if (secCount > 0) {
        const penalty = Math.min(25, secCount * 5);
        score -= penalty;
        findings.push({
          id: 'unpatched-cve',
          category: 'Packages',
          title: `${secCount} Unpatched Security Package(s) Found`,
          description: `Identified ${secCount} system package updates marked with security patches and CVE fixes.`,
          severity: secCount >= 5 ? 'critical' : 'high',
          scoreImpact: penalty,
          canAutoFix: true,
          fixAction: 'install_security_updates',
          packages: securityLines.slice(0, 10),
        });
      }
    } catch {
      // apt check fallback
    }

    // 4. Check Exposed Database Ports
    try {
      const { stdout } = await execAsync('ss -tuln 2>/dev/null || netstat -tuln 2>/dev/null || true');
      const sensitivePorts = [
        { port: ':3306', name: 'MySQL/MariaDB', id: 'port-mysql' },
        { port: ':5432', name: 'PostgreSQL', id: 'port-postgres' },
        { port: ':6379', name: 'Redis', id: 'port-redis' },
        { port: ':27017', name: 'MongoDB', id: 'port-mongo' },
      ];

      for (const sp of sensitivePorts) {
        if (stdout.includes(`0.0.0.0${sp.port}`) || stdout.includes(`[::]${sp.port}`)) {
          score -= 10;
          findings.push({
            id: sp.id,
            category: 'Network',
            title: `${sp.name} Exposed to All Interfaces (0.0.0.0)`,
            description: `${sp.name} is bound to all network interfaces and may be accessible from the public internet if not firewalled.`,
            severity: 'high',
            scoreImpact: 10,
            canAutoFix: false,
            recommendation: `Bind ${sp.name} to 127.0.0.1 (localhost) or restrict access via UFW firewall rules.`,
          });
        }
      }
    } catch {}

    // 5. Check Default/Weak Panel User Password
    try {
      const db = getDb();
      const users = db.prepare('SELECT id, username, must_change_password FROM users WHERE must_change_password = 1').all();
      if (users.length > 0) {
        score -= 20;
        findings.push({
          id: 'default-panel-password',
          category: 'Authentication',
          title: 'Default/Unchanged Admin Password Detected',
          description: `${users.length} user account(s) are still flagged to change their initial default password.`,
          severity: 'critical',
          scoreImpact: 20,
          canAutoFix: false,
          recommendation: 'Change default passwords in Settings > Users / Profile immediately.',
        });
      }
    } catch {}

    // Normalize final score between 0 and 100
    score = Math.max(0, Math.min(100, score));

    let grade = 'A';
    let statusText = 'Excellent';
    let statusColor = 'var(--accent-success)';

    if (score >= 90) {
      grade = 'A';
      statusText = 'Excellent';
      statusColor = '#10b981';
    } else if (score >= 75) {
      grade = 'B';
      statusText = 'Good';
      statusColor = '#3b82f6';
    } else if (score >= 50) {
      grade = 'C';
      statusText = 'Needs Improvement';
      statusColor = '#f59e0b';
    } else {
      grade = 'F';
      statusText = 'High Risk';
      statusColor = '#ef4444';
    }

    const summary = {
      score,
      grade,
      statusText,
      statusColor,
      totalFindings: findings.length,
      criticalCount: findings.filter(f => f.severity === 'critical').length,
      highCount: findings.filter(f => f.severity === 'high').length,
      mediumCount: findings.filter(f => f.severity === 'medium').length,
      lowCount: findings.filter(f => f.severity === 'low').length,
      scannedAt: now(),
    };

    // Save scan to DB
    const scanId = generateId();
    const db = getDb();
    db.prepare('INSERT INTO security_scans (id, score, summary, findings, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(scanId, score, toJson(summary), toJson(findings), now());

    return {
      scanId,
      summary,
      findings,
    };
  }

  /**
   * Get latest scan result
   */
  async getLatestScan() {
    const db = getDb();
    const row = db.prepare('SELECT id, score, summary, findings, created_at FROM security_scans ORDER BY created_at DESC LIMIT 1').get();

    if (!row) {
      // Run initial scan
      return this.runScan();
    }

    return {
      scanId: row.id,
      summary: fromJson(row.summary, {}),
      findings: fromJson(row.findings, []),
      createdAt: row.created_at,
    };
  }

  /**
   * One-click automated fix for known findings
   */
  async applyFix(fixAction) {
    logger.info(`[SecurityScanner] Applying automated security fix: ${fixAction}`);

    switch (fixAction) {
      case 'enable_firewall': {
        await execAsync('ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 3000/tcp && ufw --force enable');
        return { success: true, message: 'Firewall enabled with standard ports (22, 80, 443, 3000) allowed' };
      }

      case 'disable_ssh_root': {
        if (fs.existsSync('/etc/ssh/sshd_config')) {
          let conf = fs.readFileSync('/etc/ssh/sshd_config', 'utf8');
          if (conf.match(/^PermitRootLogin/m)) {
            conf = conf.replace(/^PermitRootLogin\s+.*/m, 'PermitRootLogin prohibit-password');
          } else {
            conf += '\nPermitRootLogin prohibit-password\n';
          }
          fs.writeFileSync('/etc/ssh/sshd_config', conf);
          await execAsync('systemctl restart sshd || systemctl restart ssh || service ssh restart');
          return { success: true, message: 'SSH root login disabled (prohibit-password configured and sshd reloaded)' };
        }
        throw new Error('/etc/ssh/sshd_config not found');
      }

      case 'enforce_ssh_keys': {
        if (fs.existsSync('/etc/ssh/sshd_config')) {
          let conf = fs.readFileSync('/etc/ssh/sshd_config', 'utf8');
          if (conf.match(/^PasswordAuthentication/m)) {
            conf = conf.replace(/^PasswordAuthentication\s+.*/m, 'PasswordAuthentication no');
          } else {
            conf += '\nPasswordAuthentication no\n';
          }
          fs.writeFileSync('/etc/ssh/sshd_config', conf);
          await execAsync('systemctl restart sshd || systemctl restart ssh || service ssh restart');
          return { success: true, message: 'SSH password authentication disabled (Key-only enforced and sshd reloaded)' };
        }
        throw new Error('/etc/ssh/sshd_config not found');
      }

      case 'install_security_updates': {
        await execAsync('DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get -y --only-upgrade install $(apt-get -s upgrade | grep -i security | awk \'{print $2}\') || DEBIAN_FRONTEND=noninteractive apt-get -y upgrade');
        return { success: true, message: 'Security packages updated successfully' };
      }

      default:
        throw new Error(`Unknown fix action: ${fixAction}`);
    }
  }
}

export default new SecurityScannerService();
