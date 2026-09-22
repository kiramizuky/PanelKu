import scheduler from '../../core/scheduler/Scheduler.js';
import Notification from '../../models/Notification.js';
import Setting from '../../models/Setting.js';
import alertsService from '../alerts/alerts.service.js';
import logger from '../../config/logger.js';
import { getPrimaryDisk } from '../../helpers/system.js';
import { execCmd } from '../../helpers/exec.js';

// AutoHeal 2.0 Providers
import webProvider from './providers/web.provider.js';
import databaseProvider from './providers/database.provider.js';
import containerProvider from './providers/container.provider.js';
import storageProvider from './providers/storage.provider.js';
import securityProvider from './providers/security.provider.js';
import runtimeProvider from './providers/runtime.provider.js';

class AutoHealService {
  constructor() {
    this._incidentCounts = {};
    this._initialized = false;
    this.providers = {
      web: webProvider,
      database: databaseProvider,
      container: containerProvider,
      storage: storageProvider,
      security: securityProvider,
      runtime: runtimeProvider,
    };
  }

  async init() {
    if (this._initialized) return;
    this._initialized = true;

    // Register the auto-healing job
    scheduler.register('autoheal:check', async () => {
      await this._runHealthCheck();
    }, 180000, false); // every 3 minutes

    logger.info('AutoHeal 2.0: Universal Multi-Module Engine initialized (Web, DB, Containers, Storage, Security, Runtimes)');
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
      modules: {
        web: config.modules?.web !== false,
        database: config.modules?.database !== false,
        container: config.modules?.container !== false,
        storage: config.modules?.storage !== false,
        security: config.modules?.security !== false,
        runtime: config.modules?.runtime !== false,
      },
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
      modules: {
        web: data.modules?.web !== false,
        database: data.modules?.database !== false,
        container: data.modules?.container !== false,
        storage: data.modules?.storage !== false,
        security: data.modules?.security !== false,
        runtime: data.modules?.runtime !== false,
      },
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
  //  HEALTH CHECK ENGINE (Multi-Module)
  // ═══════════════════════════════════════════════════════════════

  async _runHealthCheck() {
    const config = await this._getConfig();
    if (!config.enabled) return [];

    const results = [];

    // 1. Core Systemd Services
    for (const svc of config.services) {
      if (!svc.enabled) continue;
      try {
        const result = await this._checkService(svc, config);
        results.push(result);
      } catch (err) {
        logger.error(`AutoHeal: Error checking service ${svc.name}: ${err.message}`);
      }
    }

    // 2. Core Docker daemon
    if (config.docker) {
      try {
        const result = await this._checkDocker(config);
        results.push(result);
      } catch (err) {
        logger.error(`AutoHeal: Docker check error: ${err.message}`);
      }
    }

    // 3. Websites HTTP check
    if (config.websites) {
      try {
        const siteResults = await this._checkWebsites(config);
        results.push(...siteResults);
      } catch (err) {
        logger.error(`AutoHeal: Website check error: ${err.message}`);
      }
    }

    // 4. System resources (CPU, RAM, Disk)
    try {
      const resourceResults = await this._checkResources(config);
      results.push(...resourceResults);
    } catch (err) {
      logger.error(`AutoHeal: Resource check error: ${err.message}`);
    }

    // 5. Providers Execution (Web, DB, Containers, Storage, Security, Runtimes)
    for (const [key, provider] of Object.entries(this.providers)) {
      if (config.modules[key] === false) continue;
      try {
        const items = await provider.check();
        for (const item of items) {
          results.push({ ...item, module: key });

          // Auto-heal if critical or warning with healable flag
          if ((item.status === 'critical' || item.status === 'warning') && item.healable) {
            const incKey = `prov:${key}:${item.serviceName || item.name}`;
            this._incidentCounts[incKey] = (this._incidentCounts[incKey] || 0) + 1;

            if (this._incidentCounts[incKey] <= config.maxRetries) {
              logger.warn(`AutoHeal: Auto-healing ${item.name} (${key}). Attempt #${this._incidentCounts[incKey]}...`);
              try {
                const healRes = await provider.heal(item.serviceName || 'all');
                if (healRes.success) {
                  this._incidentCounts[incKey] = 0;
                  const msg = `Auto-Healed ${item.name}: ${healRes.message}`;
                  await this._createNotification('service_recovered', `✅ ${item.name} Auto-Healed`, msg);
                  if (config.notifyOnRecovery) {
                    alertsService.triggerAlert(`Auto-Heal Recovery: ${item.name}`, msg);
                  }
                }
              } catch (healErr) {
                logger.error(`AutoHeal: Failed to heal ${item.name}: ${healErr.message}`);
              }
            }
          } else if (item.status === 'healthy') {
            const incKey = `prov:${key}:${item.serviceName || item.name}`;
            this._incidentCounts[incKey] = 0;
          }
        }
      } catch (err) {
        logger.error(`AutoHeal: Provider ${key} error: ${err.message}`);
      }
    }

    return results;
  }

  async _checkService(svc, config) {
    const key = `svc:${svc.name}`;
    try {
      const stdout = await execCmd('systemctl', ['is-active', svc.name], { timeout: 10000 }).catch(() => 'inactive');
      const isActive = stdout.trim() === 'active';

      if (isActive) {
        this._incidentCounts[key] = 0;
        return {
          type: 'service',
          name: svc.displayName || svc.name,
          status: 'healthy',
          message: `${svc.displayName || svc.name} is running`,
        };
      }

      this._incidentCounts[key] = (this._incidentCounts[key] || 0) + 1;
      const attemptCount = this._incidentCounts[key];

      if (attemptCount <= config.maxRetries) {
        logger.warn(`AutoHeal: ${svc.displayName || svc.name} is inactive. Attempt #${attemptCount} to restart...`);
        try {
          await execCmd('systemctl', ['start', svc.name], { timeout: 15000 });
          const checkAgain = await execCmd('systemctl', ['is-active', svc.name], { timeout: 5000 }).catch(() => 'inactive');

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

      return {
        type: 'service',
        name: svc.displayName || svc.name,
        status: 'critical',
        message: `${svc.displayName || svc.name} remains down after ${config.maxRetries} restart attempts. Entering cooldown (${config.cooldownMinutes} min).`,
      };
    } catch (err) {
      return {
        type: 'service',
        name: svc.displayName || svc.name,
        status: 'unknown',
        message: `${svc.displayName || svc.name}: ${err.message}`,
      };
    }
  }

  async _checkDocker(config) {
    const key = 'docker:daemon';
    try {
      await execCmd('docker', ['info'], { timeout: 10000 });
      this._incidentCounts[key] = 0;
      return { type: 'docker', name: 'Docker Daemon', status: 'healthy', message: 'Docker is running' };
    } catch {
      this._incidentCounts[key] = (this._incidentCounts[key] || 0) + 1;
      const attempt = this._incidentCounts[key];

      if (attempt <= config.maxRetries) {
        logger.warn(`AutoHeal: Docker daemon is down. Attempt #${attempt} to restart...`);
        try {
          await execCmd('systemctl', ['start', 'docker'], { timeout: 20000 });
          await new Promise(r => setTimeout(r, 3000));
          try { await execCmd('docker', ['info'], { timeout: 5000 }); } catch {}

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
      const primaryDisk = getPrimaryDisk(disk || []);
      const diskPct = primaryDisk.use || (primaryDisk.size ? Math.round((primaryDisk.used / primaryDisk.size) * 100) : 0);

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
        await this.executeDiskEmergencyClean().catch(() => {});
        const key = 'resource:disk';
        this._incidentCounts[key] = (this._incidentCounts[key] || 0) + 1;
        if (this._incidentCounts[key] >= 2) {
          const msg = `High disk usage: ${diskPct}% on ${primaryDisk.mount || '/'}. Cleanup executed.`;
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

  // ═══════════════════════════════════════════════════════════════
  //  AUTOHEAL 2.0 MULTI-MODULE API METHODS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get metadata on all registered AutoHeal providers
   */
  getProviders() {
    return Object.entries(this.providers).map(([key, provider]) => ({
      key,
      name: provider.displayName || key,
    }));
  }

  /**
   * Perform comprehensive diagnostic across all modules
   */
  async diagnoseAll() {
    const config = await this._getConfig();
    const moduleResults = {};

    for (const [key, provider] of Object.entries(this.providers)) {
      try {
        const items = await provider.check();
        moduleResults[key] = {
          name: provider.displayName,
          enabled: config.modules[key] !== false,
          items,
        };
      } catch (err) {
        moduleResults[key] = {
          name: provider.displayName,
          enabled: config.modules[key] !== false,
          items: [{ name: key, status: 'unknown', message: err.message, healable: false }],
        };
      }
    }

    return moduleResults;
  }

  /**
   * Heal a specific module domain or item
   */
  async healModule(moduleKey, target = 'all') {
    if (!this.providers[moduleKey]) {
      throw new Error(`Invalid AutoHeal module: ${moduleKey}`);
    }

    const provider = this.providers[moduleKey];
    const result = await provider.heal(target);

    if (result.actionsTaken && result.actionsTaken.length > 0) {
      const msg = `Module [${provider.displayName}] Auto-Healed: ${result.actionsTaken.join(', ')}`;
      await this._createNotification('service_recovered', `✅ ${provider.displayName} Healed`, msg);
      await alertsService.dispatchMultiChannelAlert({
        title: `${provider.displayName} Healed`,
        message: msg,
        level: 'resolved',
      });
    }

    return result;
  }

  /**
   * Heal all modules in sequence
   */
  async healAll() {
    const summary = {};
    const totalActions = [];

    for (const [key, provider] of Object.entries(this.providers)) {
      try {
        const res = await provider.heal('all');
        summary[key] = res;
        if (res.actionsTaken) totalActions.push(...res.actionsTaken);
      } catch (err) {
        summary[key] = { success: false, message: err.message };
      }
    }

    if (totalActions.length > 0) {
      const msg = `Universal Auto-Healer completed: ${totalActions.join(', ')}`;
      await this._createNotification('service_recovered', '✅ Full System Auto-Healed', msg);
    }

    return {
      success: true,
      totalActionsCount: totalActions.length,
      actionsTaken: totalActions,
      summary,
      message: totalActions.length > 0 ? `Executed ${totalActions.length} auto-healing actions` : 'All modules are currently optimal',
    };
  }

  /**
   * Legacy status method (maintained for existing UI)
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
        const stdout = await execCmd('systemctl', ['is-active', svc.name], { timeout: 8000 }).catch(() => 'inactive');
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

    try {
      await execCmd('docker', ['info'], { timeout: 5000 });
      results.push({ type: 'docker', name: 'Docker Daemon', status: 'healthy', message: 'Running' });
    } catch {
      results.push({ type: 'docker', name: 'Docker Daemon', status: 'critical', message: 'Not running' });
    }

    return results;
  }

  async runManualCheck() {
    return this._runHealthCheck();
  }

  async healService(serviceName) {
    if (!serviceName) throw new Error('Service name is required');

    // Check if it's a provider module key
    if (this.providers[serviceName]) {
      return this.healModule(serviceName, 'all');
    }

    try {
      await execCmd('systemctl', ['restart', serviceName], { timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));
      const status = await execCmd('systemctl', ['is-active', serviceName], { timeout: 5000 }).catch(() => 'inactive');
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

  async executeDiskEmergencyClean() {
    return this.providers.storage.heal('storage:disk');
  }

  async resurrectDeadServices() {
    return this.healAll();
  }
}

export default new AutoHealService();
