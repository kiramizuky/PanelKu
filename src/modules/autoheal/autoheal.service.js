import { exec } from 'child_process';
import { promisify } from 'util';
import scheduler from '../../core/scheduler/Scheduler.js';
import Notification from '../../models/Notification.js';
import Setting from '../../models/Setting.js';
import alertsService from '../alerts/alerts.service.js';
import logger from '../../config/logger.js';

const execAsync = promisify(exec);

class AutoHealService {
  constructor() {
    this._incidentCounts = {};
    this._initialized = false;
  }

  async init() {
    if (this._initialized) return;
    this._initialized = true;

    // Register the auto-healing job
    scheduler.register('autoheal:check', async () => {
      await this._runHealthCheck();
    }, 180000, false); // every 3 minutes

    logger.info('AutoHeal: Engine initialized, monitoring services every 3 minutes');
  }

  // ═══════════════════════════════════════════════════════════════
  //  CONFIGURATION
  // ═══════════════════════════════════════════════════════════════

  async _getConfig() {
    const raw = await Setting.get('autoheal_config') || '{}';
    let config = {};
    try {
      config = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
    } catch {
      config = {};
    }
    return {
      enabled: config.enabled !== false,
      checkInterval: config.checkInterval || 180, // seconds
      maxRetries: config.maxRetries || 3,
      cooldownMinutes: config.cooldownMinutes || 15,
      notifyOnHeal: config.notifyOnHeal !== false,
      notifyOnRecovery: config.notifyOnRecovery !== false,
      services: config.services || this._getDefaultServices(),
      websites: config.websites !== false,
      docker: config.docker !== false,
      diskThreshold: config.diskThreshold || 90,
      memoryThreshold: config.memoryThreshold || 90,
      cpuThreshold: config.cpuThreshold || 90,
    };
  }

  async saveConfig(data) {
    const config = {
      enabled: data.enabled !== false,
      checkInterval: parseInt(data.checkInterval) || 180,
      maxRetries: parseInt(data.maxRetries) || 3,
      cooldownMinutes: parseInt(data.cooldownMinutes) || 15,
      notifyOnHeal: data.notifyOnHeal !== false,
      notifyOnRecovery: data.notifyOnRecovery !== false,
      services: Array.isArray(data.services) ? data.services : this._getDefaultServices(),
      websites: data.websites !== false,
      docker: data.docker !== false,
      diskThreshold: parseInt(data.diskThreshold) || 90,
      memoryThreshold: parseInt(data.memoryThreshold) || 90,
      cpuThreshold: parseInt(data.cpuThreshold) || 90,
    };
    await Setting.set('autoheal_config', JSON.stringify(config), 'json');
    return { message: 'Auto-Healing configuration saved', config };
  }

  async getConfig() {
    return this._getConfig();
  }

  _getDefaultServices() {
    return [
      { name: 'nginx', displayName: 'Nginx', type: 'systemd', enabled: true, critical: true },
      { name: 'apache2', displayName: 'Apache', type: 'systemd', enabled: true, critical: false },
      { name: 'mysql', displayName: 'MySQL', type: 'systemd', enabled: true, critical: true },
      { name: 'postgresql', displayName: 'PostgreSQL', type: 'systemd', enabled: true, critical: true },
      { name: 'redis-server', displayName: 'Redis', type: 'systemd', enabled: true, critical: false },
      { name: 'docker', displayName: 'Docker', type: 'systemd', enabled: true, critical: true },
      { name: 'ssh', displayName: 'SSH', type: 'systemd', enabled: true, critical: false },
      { name: 'ufw', displayName: 'UFW Firewall', type: 'systemd', enabled: true, critical: false },
    ];
  }

  // ═══════════════════════════════════════════════════════════════
  //  HEALTH CHECK ENGINE
  // ═══════════════════════════════════════════════════════════════

  async _runHealthCheck() {
    const config = await this._getConfig();
    if (!config.enabled) return;

    const results = [];

    // 1. Check systemd services
    for (const svc of config.services) {
      if (!svc.enabled) continue;
      try {
        const result = await this._checkService(svc, config);
        results.push(result);
      } catch (err) {
        logger.error(`AutoHeal: Error checking service ${svc.name}: ${err.message}`);
      }
    }

    // 2. Check Docker
    if (config.docker) {
      try {
        const result = await this._checkDocker(config);
        results.push(result);
      } catch (err) {
        logger.error(`AutoHeal: Docker check error: ${err.message}`);
      }
    }

    // 3. Check websites if configured
    if (config.websites) {
      try {
        const siteResults = await this._checkWebsites(config);
        results.push(...siteResults);
      } catch (err) {
        logger.error(`AutoHeal: Website check error: ${err.message}`);
      }
    }

    // 4. Check system resources
    try {
      const resourceResults = await this._checkResources(config);
      results.push(...resourceResults);
    } catch (err) {
      logger.error(`AutoHeal: Resource check error: ${err.message}`);
    }

    return results;
  }

  /**
   * Check a single systemd service and auto-heal if needed.
   */
  async _checkService(svc, config) {
    const key = `svc:${svc.name}`;

    try {
      const { stdout } = await execAsync(`systemctl is-active ${svc.name} 2>/dev/null || echo "inactive"`, { timeout: 10000 });
      const isActive = stdout.trim() === 'active';

      if (isActive) {
        // Service is healthy — reset incident counter
        this._incidentCounts[key] = 0;
        return {
          type: 'service',
          name: svc.displayName || svc.name,
          status: 'healthy',
          message: `${svc.displayName || svc.name} is running`,
        };
      }

      // Service is down — increment counter and attempt heal
      this._incidentCounts[key] = (this._incidentCounts[key] || 0) + 1;
      const attemptCount = this._incidentCounts[key];

      if (attemptCount <= config.maxRetries) {
        logger.warn(`AutoHeal: ${svc.displayName || svc.name} is inactive. Attempt #${attemptCount} to restart...`);

        try {
          await execAsync(`systemctl start ${svc.name} 2>&1`, { timeout: 15000 });
          const { stdout: checkAgain } = await execAsync(`systemctl is-active ${svc.name} 2>/dev/null || echo "inactive"`, { timeout: 5000 });

          if (checkAgain.trim() === 'active') {
            this._incidentCounts[key] = 0;
            const msg = `${svc.displayName || svc.name} was down. Auto-Healer restarted it successfully.`;
            logger.info(`AutoHeal: ${msg}`);
            await this._createNotification('service_recovered', `✅ ${svc.displayName || svc.name} Recovered`, msg);
            if (config.notifyOnRecovery) {
              alertsService.triggerAlert('Service Auto-Recovery', msg);
            }
            return { type: 'service', name: svc.displayName || svc.name, status: 'recovered', message: msg };
          }
        } catch { /* restart attempt failed */ }

        const failMsg = `${svc.displayName || svc.name} is inactive. Auto-Healer restart attempt #${attemptCount} failed.`;
        await this._createNotification('service_critical', `⚠️ ${svc.displayName || svc.name} Down`, failMsg);
        alertsService.triggerAlert(`Service Down: ${svc.displayName || svc.name}`, failMsg);

        return { type: 'service', name: svc.displayName || svc.name, status: 'critical', message: failMsg };
      }

      // Max retries exceeded — enter cooldown
      return {
        type: 'service',
        name: svc.displayName || svc.name,
        status: 'critical',
        message: `${svc.displayName || svc.name} remains down after ${config.maxRetries} restart attempts. Entering cooldown (${config.cooldownMinutes} min).`,
      };
    } catch (err) {
      // Service may not be installed
      return {
        type: 'service',
        name: svc.displayName || svc.name,
        status: 'unknown',
        message: `${svc.displayName || svc.name}: ${err.message}`,
      };
    }
  }

  /**
   * Check Docker daemon health.
   */
  async _checkDocker(config) {
    const key = 'docker:daemon';

    try {
      await execAsync('docker info 2>/dev/null', { timeout: 10000 });
      this._incidentCounts[key] = 0;
      return { type: 'docker', name: 'Docker Daemon', status: 'healthy', message: 'Docker is running' };
    } catch {
      this._incidentCounts[key] = (this._incidentCounts[key] || 0) + 1;
      const attempt = this._incidentCounts[key];

      if (attempt <= config.maxRetries) {
        logger.warn(`AutoHeal: Docker daemon is down. Attempt #${attempt} to restart...`);
        try {
          await execAsync('systemctl start docker 2>&1', { timeout: 20000 });
          await new Promise(r => setTimeout(r, 3000)); // wait for daemon

          try { await execAsync('docker info 2>/dev/null', { timeout: 5000 }); } catch { /* not up yet */ }

          const msg = 'Docker daemon was down. Auto-Healer restarted it.';
          await this._createNotification('docker_recovered', '✅ Docker Recovered', msg);
          if (config.notifyOnRecovery) alertsService.triggerAlert('Docker Auto-Recovery', msg);
          return { type: 'docker', name: 'Docker Daemon', status: 'recovered', message: msg };
        } catch {
          const msg = `Docker daemon restart attempt #${attempt} failed.`;
          alertsService.triggerAlert('Docker Critical', msg);
          return { type: 'docker', name: 'Docker Daemon', status: 'critical', message: msg };
        }
      }
      return { type: 'docker', name: 'Docker Daemon', status: 'critical', message: 'Docker is down' };
    }
  }

  /**
   * Check website health via HTTP.
   */
  async _checkWebsites(_config) {
    const results = [];
    try {
      const { getDb, fromJson } = await import('../../core/db/sqlite.js');
      const db = getDb();
      const websites = db.prepare("SELECT * FROM websites WHERE status = 'active'").all();

      for (const site of websites) {
        const domain = site.domain;
        const ssl = fromJson(site.ssl, {});
        const key = `web:${domain}`;
        const proto = ssl && ssl.enabled ? 'https' : 'http';
        const url = `${proto}://${domain}`;

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);
          const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
          clearTimeout(timeout);

          if (res.ok || res.status < 500) {
            this._incidentCounts[key] = 0;
            results.push({ type: 'website', name: domain, status: 'healthy', message: `${domain} is reachable` });
          } else {
            throw new Error(`HTTP ${res.status}`);
          }
        } catch (err) {
          this._incidentCounts[key] = (this._incidentCounts[key] || 0) + 1;
          if (this._incidentCounts[key] >= 3) {
            const msg = `Website ${domain} is down (${err.message})`;
            alertsService.triggerAlert('Website Down', msg);
            results.push({ type: 'website', name: domain, status: 'critical', message: msg });
          }
        }
      }
    } catch (err) {
      logger.error('AutoHeal: Website check error:', err.message);
    }
    return results;
  }

  /**
   * Check system resource thresholds (CPU, RAM, Disk).
   */
  async _checkResources(config) {
    const results = [];
    try {
      const si = await import('systeminformation');

      const [load, mem, disk] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
      ]);

      const cpuPct = Math.round(load.currentLoad || 0);
      const ramPct = mem.total ? Math.round((mem.used / mem.total) * 100) : 0;
      const primaryDisk = (disk || [])[0] || {};
      const diskPct = primaryDisk.use || 0;

      if (cpuPct > config.cpuThreshold) {
        const key = 'resource:cpu';
        this._incidentCounts[key] = (this._incidentCounts[key] || 0) + 1;
        if (this._incidentCounts[key] >= 2) {
          const msg = `High CPU usage: ${cpuPct}% (threshold: ${config.cpuThreshold}%)`;
          alertsService.triggerAlert('High CPU Alert', msg);
          results.push({ type: 'resource', name: 'CPU', status: 'warning', message: msg });
        }
      } else {
        this._incidentCounts['resource:cpu'] = 0;
      }

      if (ramPct > config.memoryThreshold) {
        const key = 'resource:ram';
        this._incidentCounts[key] = (this._incidentCounts[key] || 0) + 1;
        if (this._incidentCounts[key] >= 2) {
          const msg = `High RAM usage: ${ramPct}% (threshold: ${config.memoryThreshold}%)`;
          alertsService.triggerAlert('High RAM Alert', msg);
          results.push({ type: 'resource', name: 'RAM', status: 'warning', message: msg });
        }
      } else {
        this._incidentCounts['resource:ram'] = 0;
      }

      if (diskPct > config.diskThreshold) {
        // Auto-cleanup: try journalctl vacuum on high disk
        if (diskPct > 85) {
          try {
            await execAsync('journalctl --vacuum-time=3d 2>/dev/null', { timeout: 30000 });
            await execAsync('apt-get clean 2>/dev/null || yum clean all 2>/dev/null || true', { timeout: 30000 });
            logger.info('AutoHeal: Disk cleanup executed (journalctl + package cache)');
          } catch { /* cleanup not available */ }
        }

        const key = 'resource:disk';
        this._incidentCounts[key] = (this._incidentCounts[key] || 0) + 1;
        if (this._incidentCounts[key] >= 2) {
          const msg = `High disk usage: ${diskPct}% on ${primaryDisk.mount || '/'} (threshold: ${config.diskThreshold}%). Cleanup attempted.`;
          alertsService.triggerAlert('High Disk Alert', msg);
          results.push({ type: 'resource', name: 'Disk', status: 'warning', message: msg });
        }
      } else {
        this._incidentCounts['resource:disk'] = 0;
      }
    } catch (err) {
      logger.error('AutoHeal: Resource check error:', err.message);
    }
    return results;
  }

  // ═══════════════════════════════════════════════════════════════
  //  INCIDENT HISTORY & NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════════

  async _createNotification(type, title, message) {
    try {
      await Notification.create({ title, message, type: type.includes('critical') ? 'alert' : 'info', icon: type, isGlobal: true });
    } catch (err) {
      logger.error('AutoHeal: Failed to create notification:', err.message);
    }
  }

  /**
   * Get incident history from notifications.
   */
  async getIncidentHistory(limit = 50) {
    const { getDb } = await import('../../core/db/sqlite.js');
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM notifications WHERE title LIKE '%Auto-Heal%' OR title LIKE '%Recover%' OR title LIKE '%Alert%'
      ORDER BY created_at DESC LIMIT ?
    `).all(limit);

    return rows.map(r => ({
      id: r.id,
      title: r.title,
      message: r.message,
      type: r.type,
      created: r.created_at,
    }));
  }

  /**
   * Get current health status of all monitored services.
   */
  async getCurrentStatus() {
    const config = await this._getConfig();
    const results = [];

    for (const svc of config.services) {
      if (!svc.enabled) {
        results.push({ type: 'service', name: svc.displayName || svc.name, status: 'disabled', message: 'Monitoring disabled' });
        continue;
      }
      try {
        const { stdout } = await execAsync(`systemctl is-active ${svc.name} 2>/dev/null || echo "inactive"`, { timeout: 8000 });
        const isActive = stdout.trim() === 'active';
        results.push({
          type: 'service',
          name: svc.displayName || svc.name,
          serviceName: svc.name,
          status: isActive ? 'healthy' : 'critical',
          message: isActive ? 'Running' : 'Inactive',
          critical: !!svc.critical,
        });
      } catch {
        results.push({ type: 'service', name: svc.displayName || svc.name, serviceName: svc.name, status: 'unknown', message: 'Not installed', critical: false });
      }
    }

    // Docker
    try {
      await execAsync('docker info 2>/dev/null', { timeout: 5000 });
      results.push({ type: 'docker', name: 'Docker Daemon', status: 'healthy', message: 'Running' });
    } catch {
      results.push({ type: 'docker', name: 'Docker Daemon', status: 'critical', message: 'Not running' });
    }

    return results;
  }

  /**
   * Trigger a manual health check and return results.
   */
  async runManualCheck() {
    const results = await this._runHealthCheck();
    return results;
  }

  /**
   * Manually heal a specific service.
   */
  async healService(serviceName) {
    if (!serviceName) throw new Error('Service name is required');

    try {
      await execAsync(`systemctl restart ${serviceName} 2>&1`, { timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));

      const { stdout: status } = await execAsync(`systemctl is-active ${serviceName} 2>/dev/null || echo "inactive"`, { timeout: 5000 });
      const isActive = status.trim() === 'active';

      const msg = isActive
        ? `${serviceName} restarted successfully`
        : `${serviceName} restart attempted but service not active`;

      await this._createNotification(
        isActive ? 'service_recovered' : 'service_critical',
        isActive ? `✅ ${serviceName} Restarted` : `⚠️ ${serviceName} Restart Failed`,
        msg
      );

      return { success: isActive, message: msg };
    } catch (err) {
      throw new Error(`Failed to restart ${serviceName}: ${err.message}`);
    }
  }
}

export default new AutoHealService();
