/**
 * AutoHeal Web Provider
 * Handles Nginx, Apache2, Caddy, PHP-FPM pools, and Reverse Proxy health.
 */

import { execCmd } from '../../../helpers/exec.js';
import logger from '../../../config/logger.js';
import fs from 'fs/promises';

class WebProvider {
  constructor() {
    this.name = 'web';
    this.displayName = 'Web Servers & Reverse Proxy';
  }

  /**
   * Run diagnostics on web servers & runtimes
   */
  async check() {
    const isWindows = process.platform === 'win32';
    const items = [];

    if (isWindows) {
      return [{
        name: 'Web Servers (Simulated)',
        type: 'web',
        status: 'healthy',
        message: 'Web server monitoring simulated in Windows environment',
      }];
    }

    // 1. Nginx
    try {
      const active = await this._isServiceActive('nginx');
      if (active) {
        // Test syntax
        const syntaxOk = await this._testNginxSyntax();
        items.push({
          name: 'Nginx Web Server',
          serviceName: 'nginx',
          type: 'web',
          status: syntaxOk ? 'healthy' : 'warning',
          message: syntaxOk ? 'Active & configuration valid' : 'Active but configuration test failed',
          healable: true,
        });
      } else {
        const installed = await this._isInstalled('nginx');
        if (installed) {
          items.push({
            name: 'Nginx Web Server',
            serviceName: 'nginx',
            type: 'web',
            status: 'critical',
            message: 'Service is inactive or failed',
            healable: true,
          });
        }
      }
    } catch (_) {}

    // 2. Apache2 / httpd
    try {
      const apacheSvc = await this._findFirstActive(['apache2', 'httpd']);
      if (apacheSvc) {
        items.push({
          name: 'Apache HTTP Server',
          serviceName: apacheSvc,
          type: 'web',
          status: 'healthy',
          message: `${apacheSvc} is running`,
          healable: true,
        });
      } else if (await this._isInstalled('apache2') || await this._isInstalled('httpd')) {
        items.push({
          name: 'Apache HTTP Server',
          serviceName: 'apache2',
          type: 'web',
          status: 'critical',
          message: 'Apache is installed but inactive',
          healable: true,
        });
      }
    } catch (_) {}

    // 3. Caddy Server
    try {
      const caddyActive = await this._isServiceActive('caddy');
      if (caddyActive) {
        items.push({
          name: 'Caddy Web Server',
          serviceName: 'caddy',
          type: 'web',
          status: 'healthy',
          message: 'Caddy daemon is active',
          healable: true,
        });
      } else if (await this._isInstalled('caddy')) {
        items.push({
          name: 'Caddy Web Server',
          serviceName: 'caddy',
          type: 'web',
          status: 'critical',
          message: 'Caddy service is inactive',
          healable: true,
        });
      }
    } catch (_) {}

    // 4. PHP-FPM Pools
    try {
      const phpPools = await this._detectPhpFpmPools();
      for (const pool of phpPools) {
        items.push({
          name: `PHP-FPM (${pool.version})`,
          serviceName: pool.service,
          type: 'web',
          status: pool.active ? 'healthy' : 'critical',
          message: pool.active ? `Pool is active (socket: ${pool.socket})` : 'PHP-FPM pool is stopped',
          healable: true,
        });
      }
    } catch (_) {}

    return items;
  }

  /**
   * Execute auto-healing for web components
   */
  async heal(target = 'all') {
    const isWindows = process.platform === 'win32';
    const actionsTaken = [];

    if (isWindows) {
      return { success: true, actionsTaken: ['Web healing simulated for Windows'] };
    }

    // Nginx healing
    if (target === 'all' || target === 'nginx') {
      try {
        const isInstalled = await this._isInstalled('nginx');
        if (isInstalled) {
          const syntaxOk = await this._testNginxSyntax();
          if (!syntaxOk) {
            // Attempt rollback to backup if available
            const restored = await this._tryRestoreNginxBackup();
            if (restored) actionsTaken.push('Restored /etc/nginx/nginx.conf from backup');
          }
          await execCmd('systemctl', ['restart', 'nginx'], { timeout: 15000 });
          actionsTaken.push('Restarted Nginx web server');
        }
      } catch (err) {
        logger.warn(`[AutoHeal:Web] Nginx heal error: ${err.message}`);
      }
    }

    // Apache healing
    if (target === 'all' || target === 'apache2' || target === 'httpd') {
      try {
        const svc = (await this._isInstalled('apache2')) ? 'apache2' : ((await this._isInstalled('httpd')) ? 'httpd' : null);
        if (svc) {
          await execCmd('systemctl', ['restart', svc], { timeout: 15000 });
          actionsTaken.push(`Restarted ${svc} server`);
        }
      } catch (err) {
        logger.warn(`[AutoHeal:Web] Apache heal error: ${err.message}`);
      }
    }

    // Caddy healing
    if (target === 'all' || target === 'caddy') {
      try {
        if (await this._isInstalled('caddy')) {
          await execCmd('systemctl', ['restart', 'caddy'], { timeout: 15000 });
          actionsTaken.push('Restarted Caddy server');
        }
      } catch (err) {
        logger.warn(`[AutoHeal:Web] Caddy heal error: ${err.message}`);
      }
    }

    // PHP-FPM healing
    if (target === 'all' || target.startsWith('php')) {
      try {
        const pools = await this._detectPhpFpmPools();
        for (const p of pools) {
          if (!p.active || target === p.service) {
            await execCmd('systemctl', ['restart', p.service], { timeout: 15000 });
            actionsTaken.push(`Restarted PHP-FPM pool: ${p.service}`);
          }
        }
      } catch (err) {
        logger.warn(`[AutoHeal:Web] PHP-FPM heal error: ${err.message}`);
      }
    }

    return {
      success: actionsTaken.length > 0,
      actionsTaken,
      message: actionsTaken.length > 0 ? actionsTaken.join(', ') : 'No web healing actions required',
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  async _isServiceActive(serviceName) {
    try {
      const stdout = await execCmd('systemctl', ['is-active', serviceName], { timeout: 5000 });
      return stdout.trim() === 'active';
    } catch {
      return false;
    }
  }

  async _isInstalled(binOrService) {
    try {
      const out = await execCmd('which', [binOrService], { timeout: 4000 });
      if (out.trim()) return true;
    } catch {}
    try {
      const out = await execCmd('systemctl', ['list-unit-files', `${binOrService}.service`], { timeout: 4000 });
      return out.includes(`${binOrService}.service`);
    } catch {
      return false;
    }
  }

  async _findFirstActive(services) {
    for (const svc of services) {
      if (await this._isServiceActive(svc)) return svc;
    }
    return null;
  }

  async _testNginxSyntax() {
    try {
      const res = await execCmd('nginx', ['-t'], { timeout: 8000 });
      return res.includes('successful') || res.includes('syntax is ok');
    } catch {
      return false;
    }
  }

  async _tryRestoreNginxBackup() {
    const backupPath = '/etc/nginx/nginx.conf.bak';
    const confPath = '/etc/nginx/nginx.conf';
    try {
      await fs.access(backupPath);
      await fs.copyFile(backupPath, confPath);
      return true;
    } catch {
      return false;
    }
  }

  async _detectPhpFpmPools() {
    const pools = [];
    const versions = ['8.4', '8.3', '8.2', '8.1', '8.0', '7.4'];
    for (const v of versions) {
      const svc = `php${v}-fpm`;
      if (await this._isInstalled(svc)) {
        const active = await this._isServiceActive(svc);
        pools.push({
          version: v,
          service: svc,
          active,
          socket: `/run/php/php${v}-fpm.sock`,
        });
      }
    }
    return pools;
  }
}

export default new WebProvider();
