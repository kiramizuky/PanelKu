/**
 * AutoHeal Security & Firewall Provider
 * Handles UFW Firewall (with SSH anti-lockout), Fail2ban socket healing, and SSL certificate expiry.
 */

import { execCmd } from '../../../helpers/exec.js';
import logger from '../../../config/logger.js';
import fs from 'fs/promises';

class SecurityProvider {
  constructor() {
    this.name = 'security';
    this.displayName = 'Security, Firewall & SSL';
  }

  /**
   * Run security diagnostics
   */
  async check() {
    const isWindows = process.platform === 'win32';
    const items = [];

    if (isWindows) {
      return [{
        name: 'Security Engine (Simulated)',
        serviceName: 'security:simulated',
        type: 'security',
        status: 'healthy',
        message: 'Security monitoring simulated in Windows environment',
      }];
    }

    // 1. UFW Firewall Status
    try {
      const ufwInstalled = await this._isInstalled('ufw');
      if (ufwInstalled) {
        const ufwOut = await execCmd('ufw', ['status'], { timeout: 5000 }).catch(() => '');
        const isActive = ufwOut.includes('Status: active');
        items.push({
          name: 'UFW Firewall',
          serviceName: 'ufw',
          type: 'security',
          status: isActive ? 'healthy' : 'warning',
          message: isActive ? 'Firewall rules active' : 'Firewall is inactive',
          healable: true,
        });
      }
    } catch (_) {}

    // 2. Fail2ban Intrusion Prevention
    try {
      const f2bInstalled = await this._isInstalled('fail2ban');
      if (f2bInstalled) {
        let f2bRunning = false;
        try {
          const ping = await execCmd('fail2ban-client', ['ping'], { timeout: 4000 });
          f2bRunning = ping.includes('pong');
        } catch (_) {}

        items.push({
          name: 'Fail2ban Intrusion Guard',
          serviceName: 'fail2ban',
          type: 'security',
          status: f2bRunning ? 'healthy' : 'critical',
          message: f2bRunning ? 'Jails active and monitoring logs' : 'Daemon unresponsive or socket dead',
          healable: true,
        });
      }
    } catch (_) {}

    // 3. SSL Expiry Check
    try {
      const expiringCerts = await this._checkExpiringSsl();
      if (expiringCerts.length > 0) {
        items.push({
          name: 'SSL Certificates',
          serviceName: 'ssl:expiry',
          type: 'security',
          status: 'warning',
          message: `${expiringCerts.length} domain(s) have SSL expiring within 14 days`,
          healable: true,
        });
      } else {
        items.push({
          name: 'SSL Certificates',
          serviceName: 'ssl:expiry',
          type: 'security',
          status: 'healthy',
          message: 'All monitored domain certificates valid',
          healable: false,
        });
      }
    } catch (_) {}

    return items;
  }

  /**
   * Execute auto-healing for security services
   */
  async heal(target = 'all') {
    const isWindows = process.platform === 'win32';
    const actionsTaken = [];

    if (isWindows) {
      return { success: true, actionsTaken: ['Security audit simulated'] };
    }

    // 1. UFW Firewall Healing (with strict anti-lockout)
    if (target === 'all' || target === 'ufw') {
      try {
        if (await this._isInstalled('ufw')) {
          const ufwStatus = await execCmd('ufw', ['status'], { timeout: 5000 }).catch(() => '');
          if (!ufwStatus.includes('Status: active')) {
            // Anti-lockout guard: Always ensure SSH port is allowed first
            const sshPort = await this._detectSshPort();
            await execCmd('ufw', ['allow', `${sshPort}/tcp`], { timeout: 5000 });
            await execCmd('ufw', ['allow', '23456/tcp'], { timeout: 5000 }); // Panel port
            await execCmd('ufw', ['--force', 'enable'], { timeout: 10000 });
            actionsTaken.push(`Re-enabled UFW firewall with SSH (${sshPort}) and Panelku (23456) anti-lockout rules`);
          }
        }
      } catch (err) {
        logger.warn(`[AutoHeal:Security] UFW heal error: ${err.message}`);
      }
    }

    // 2. Fail2ban Socket Healing
    if (target === 'all' || target === 'fail2ban') {
      try {
        if (await this._isInstalled('fail2ban')) {
          let running = false;
          try {
            const p = await execCmd('fail2ban-client', ['ping'], { timeout: 4000 });
            running = p.includes('pong');
          } catch (_) {}

          if (!running) {
            // Stale socket cleanup
            const sock = '/var/run/fail2ban/fail2ban.sock';
            try {
              await fs.access(sock);
              await fs.unlink(sock);
              actionsTaken.push('Removed stale fail2ban.sock');
            } catch (_) {}

            await execCmd('systemctl', ['restart', 'fail2ban'], { timeout: 20000 });
            actionsTaken.push('Restarted Fail2ban service');
          }
        }
      } catch (err) {
        logger.warn(`[AutoHeal:Security] Fail2ban heal error: ${err.message}`);
      }
    }

    // 3. SSL Renewal Check
    if (target === 'all' || target === 'ssl:expiry') {
      try {
        if (await this._isInstalled('certbot')) {
          await execCmd('certbot', ['renew', '--quiet'], { timeout: 60000 });
          actionsTaken.push('Triggered automated Certbot SSL renewal run');
        }
      } catch (_) {}
    }

    return {
      success: actionsTaken.length > 0,
      actionsTaken,
      message: actionsTaken.length > 0 ? actionsTaken.join(', ') : 'Security layers are functioning properly',
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  async _isInstalled(bin) {
    try {
      const out = await execCmd('which', [bin], { timeout: 3000 });
      return !!out.trim();
    } catch {
      return false;
    }
  }

  async _detectSshPort() {
    try {
      const sshdConf = await fs.readFile('/etc/ssh/sshd_config', 'utf8').catch(() => '');
      const match = sshdConf.match(/^Port\s+(\d+)/m);
      if (match && match[1]) return parseInt(match[1]);
    } catch (_) {}
    return 22;
  }

  async _checkExpiringSsl() {
    try {
      const { getDb, fromJson } = await import('../../../core/db/sqlite.js');
      const db = getDb();
      const websites = db.prepare("SELECT domain, ssl FROM websites WHERE status = 'active'").all();
      const expiring = [];
      const now = Date.now();
      const fourteenDays = 14 * 24 * 60 * 60 * 1000;

      for (const site of websites) {
        const ssl = fromJson(site.ssl, {});
        if (ssl && ssl.enabled && ssl.expiresAt) {
          const expTime = new Date(ssl.expiresAt).getTime();
          if (expTime - now < fourteenDays) {
            expiring.push(site.domain);
          }
        }
      }
      return expiring;
    } catch {
      return [];
    }
  }
}

export default new SecurityProvider();
