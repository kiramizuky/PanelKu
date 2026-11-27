import { successResponse, errorResponse } from '../../helpers/response.js';
import Setting from '../../models/Setting.js';
import pluginLoader from '../../core/plugin-loader/PluginLoader.js';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import util from 'util';
import { getPluginsDir } from '../../config/paths.js';
import pluginUpdateService, { PLUGIN_RELEASE_CATALOG } from './pluginUpdate.service.js';
import processRunner from '../../services/processRunner.js';

const execFileAsync = util.promisify(execFile);

/**
 * Validate a plugin ID — prevent path traversal and command injection.
 * Only allow safe characters: alphanumeric, hyphens, underscores.
 */
function validatePluginId(id) {
  if (!id || typeof id !== 'string') throw new Error('Plugin ID is required');
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid plugin ID: use only letters, numbers, hyphens, and underscores');
  if (id.length > 64) throw new Error('Plugin ID too long');
  // Prevent path traversal
  if (id.includes('..') || id.includes('/') || id.includes('\\')) throw new Error('Path traversal detected in plugin ID');
  return id;
}

async function checkAndInstallSystemDependencies(pluginPath) {
  if (process.platform !== 'linux') return;
  try {
    const manifestPath = path.join(pluginPath, 'plugin.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const deps = manifest.systemDependencies || manifest.systemPackages || [];

    if (Array.isArray(deps) && deps.length > 0) {
      const pkgsToInstall = [];
      for (const pkg of deps) {
        try {
          await execFileAsync('which', [pkg]);
        } catch (_) {
          pkgsToInstall.push(pkg);
        }
      }

      if (pkgsToInstall.length > 0) {
        let cmd = '';
        let args = [];

        try {
          await execFileAsync('which', ['apt-get']);
          cmd = 'apt-get';
          const aptPkgs = pkgsToInstall.map(p => p === 'docker' ? 'docker.io' : p);
          args = ['install', '-y', ...aptPkgs];
        } catch (_) {
          try {
            await execFileAsync('which', ['dnf']);
            cmd = 'dnf';
            args = ['install', '-y', ...pkgsToInstall];
          } catch (_) {
            try {
              await execFileAsync('which', ['yum']);
              cmd = 'yum';
              args = ['install', '-y', ...pkgsToInstall];
            } catch (_) {
              try {
                await execFileAsync('which', ['pacman']);
                cmd = 'pacman';
                args = ['-S', '--noconfirm', ...pkgsToInstall];
              } catch (_) {}
            }
          }
        }

        if (cmd) {
          await execFileAsync(cmd, args, { env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' } });
        }

        if (pkgsToInstall.includes('docker')) {
          try {
            await execFileAsync('systemctl', ['enable', '--now', 'docker']);
          } catch (_) {
            try {
              await execFileAsync('service', ['docker', 'start']);
            } catch (_) {}
          }
        }
      }
    }
  } catch (_) {
    // Ignore dependency install errors to allow plugin registration
  }
}

class PluginsController {
  async getPlugins(req, res) {
    try {
      const pluginsDir = getPluginsDir();
      let dirs = [];
      try {
        dirs = await fs.readdir(pluginsDir, { withFileTypes: true });
      } catch (err) {
        // Create directory if not exists
        await fs.mkdir(pluginsDir, { recursive: true });
      }

      // Load installed plugin IDs from database
      const installedStr = await Setting.get('installed_plugins') || '[]';
      const installedIds = JSON.parse(typeof installedStr === 'string' ? installedStr : JSON.stringify(installedStr));

      // Load installed plugin proxies from database
      const proxiesStr = await Setting.get('plugin_proxies') || '{}';
      const proxies = JSON.parse(typeof proxiesStr === 'string' ? proxiesStr : JSON.stringify(proxiesStr));

      const policy = await pluginUpdateService.getPolicy();
      pluginUpdateService.startPeriodicScheduler(req.app);

      const pluginsList = [];
      for (const entry of dirs) {
        if (!entry.isDirectory() || entry.name === 'shared') continue;
        try {
          const manifestPath = path.join(pluginsDir, entry.name, 'plugin.json');
          const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
          const currentVersion = manifest.version || '1.0.0';
          const catalogInfo = PLUGIN_RELEASE_CATALOG[entry.name];
          const latestVersion = catalogInfo?.version || currentVersion;
          const isInstalled = installedIds.includes(entry.name) && (
            proxies[entry.name]   // proxy plugin — no local route needed
              ? true
              : pluginLoader.isLoaded(entry.name) && pluginLoader.hasRoute(entry.name) // local plugin must have route
          );
          const updateInfo = policy.availableUpdates?.[entry.name];
          const updateAvailable = isInstalled && (Boolean(updateInfo) || currentVersion !== latestVersion);

          pluginsList.push({
            id: entry.name,
            name: manifest.name || entry.name,
            description: manifest.description || '',
            version: currentVersion,
            latestVersion,
            updateAvailable,
            updateNotes: catalogInfo?.notes || '',
            autoUpdate: policy.autoUpdatePlugins.includes(entry.name),
            path: (isInstalled && proxies[entry.name]) ? proxies[entry.name] : `/plugins/${entry.name}`,
            icon: manifest.icon || 'bi-plugin',
            color: manifest.color || '#38bdf8',
            installed: isInstalled,
            proxyUrl: proxies[entry.name] || ''
          });
        } catch (e) {
          // Skip invalid plugin folders
        }
      }

      return successResponse(res, { plugins: pluginsList, policy }, 'Plugins retrieved successfully');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async installPlugin(req, res) {
    try {
      const { id, proxyUrl } = req.body;
      if (!id) return errorResponse(res, 'Plugin ID is required', 400);
      // [SECURITY FIX] Validate plugin ID to prevent path traversal
      const safeId = validatePluginId(id);

      // Verify directory exists
      const pluginPath = path.join(getPluginsDir(), safeId);
      try {
        await fs.access(pluginPath);
      } catch {
        return errorResponse(res, `Plugin folder ${safeId} not found`, 404);
      }

      // Auto check & install system CLI dependencies specified in plugin.json
      await checkAndInstallSystemDependencies(pluginPath);

      // Add to SQLite settings
      const installedStr = await Setting.get('installed_plugins') || '[]';
      const installedIds = JSON.parse(typeof installedStr === 'string' ? installedStr : JSON.stringify(installedStr));

      if (!installedIds.includes(safeId)) {
        installedIds.push(safeId);
        await Setting.set('installed_plugins', JSON.stringify(installedIds), 'json');
      }

      // Save proxyUrl if provided
      if (proxyUrl !== undefined) {
        const proxiesStr = await Setting.get('plugin_proxies') || '{}';
        const proxies = JSON.parse(typeof proxiesStr === 'string' ? proxiesStr : JSON.stringify(proxiesStr));
        if (proxyUrl) {
          // [SECURITY FIX] Validate proxy URL via pluginLoader
          pluginLoader._validateProxyUrl(proxyUrl);
          proxies[safeId] = proxyUrl.trim();
        } else {
          delete proxies[safeId];
        }
        await Setting.set('plugin_proxies', JSON.stringify(proxies), 'json');
        pluginLoader.setProxy(safeId, proxyUrl);
      }

      // Load it dynamically into memory
      await pluginLoader._loadPlugin(safeId, req.app, req.app.get('io'));

      return successResponse(res, null, `Plugin ${safeId} installed successfully`);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async updateProxy(req, res) {
    try {
      const { id, proxyUrl } = req.body;
      if (!id) return errorResponse(res, 'Plugin ID is required', 400);
      // [SECURITY FIX] Validate plugin ID to prevent path traversal
      const safeId = validatePluginId(id);

      const proxiesStr = await Setting.get('plugin_proxies') || '{}';
      const proxies = JSON.parse(typeof proxiesStr === 'string' ? proxiesStr : JSON.stringify(proxiesStr));

      if (proxyUrl) {
        // [SECURITY FIX] Validate proxy URL against SSRF
        pluginLoader._validateProxyUrl(proxyUrl);
        proxies[safeId] = proxyUrl.trim();
      } else {
        delete proxies[safeId];
      }

      await Setting.set('plugin_proxies', JSON.stringify(proxies), 'json');
      pluginLoader.setProxy(safeId, proxyUrl);

      return successResponse(res, null, `Plugin ${safeId} proxy updated successfully`);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async uninstallPlugin(req, res) {
    try {
      const { id } = req.body;
      if (!id) return errorResponse(res, 'Plugin ID is required', 400);
      // [SECURITY FIX] Validate plugin ID to prevent path traversal
      const safeId = validatePluginId(id);

      // Remove from SQLite settings
      const installedStr = await Setting.get('installed_plugins') || '[]';
      const installedIds = JSON.parse(typeof installedStr === 'string' ? installedStr : JSON.stringify(installedStr));

      const index = installedIds.indexOf(safeId);
      if (index !== -1) {
        installedIds.splice(index, 1);
        await Setting.set('installed_plugins', JSON.stringify(installedIds), 'json');
      }

      // Remove from proxies
      const proxiesStr = await Setting.get('plugin_proxies') || '{}';
      const proxies = JSON.parse(typeof proxiesStr === 'string' ? proxiesStr : JSON.stringify(proxiesStr));
      if (proxies[safeId]) {
        delete proxies[safeId];
        await Setting.set('plugin_proxies', JSON.stringify(proxies), 'json');
      }
      pluginLoader.setProxy(safeId, null);

      // Unload from memory
      pluginLoader._plugins.delete(safeId);

      return successResponse(res, null, `Plugin ${safeId} uninstalled successfully. Please restart panel if necessary.`);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Marketplace ────────────────────────────────────────────────────

  async getMarketplace(req, res) {
    try {
      const installedStr = await Setting.get('installed_plugins') || '[]';
      const installedIds = JSON.parse(typeof installedStr === 'string' ? installedStr : JSON.stringify(installedStr));

      // In production, this would fetch from a remote registry API.
      // For now, return curated list of available plugins with installation instructions.
      const marketplace = [
        {
          id: 'php-manager',
          name: 'PHP Manager',
          description: 'Install multiple PHP versions, manage php.ini, FPM pools, extensions, and Composer.',
          version: '1.2.0',
          author: 'Panelku Team',
          icon: 'bi-filetype-php',
          color: '#787cb5',
          category: 'runtime',
          downloads: 1240,
          
        },
        {
          id: 'home-assistant-manager',
          name: 'Home Assistant Manager',
          description: 'Deploy and manage Home Assistant via Docker with SSL, backups, and add-ons.',
          version: '1.5.0',
          author: 'Panelku Team',
          icon: 'bi-house-heart',
          color: '#41bdf5',
          category: 'smarthome',
          downloads: 890,
          
        },
        {
          id: 'adguard-manager',
          name: 'AdGuard Home Manager',
          description: 'DNS-level ad-blocking with AdGuard Home. Manage blocklists, clients, and statistics.',
          version: '1.1.0',
          author: 'Panelku Team',
          icon: 'bi-shield-shaded',
          color: '#68bd59',
          category: 'security',
          downloads: 750,
          
        },
        {
          id: 'fail2ban-manager',
          name: 'Fail2Ban Manager',
          description: 'Monitor Fail2Ban jails, manage banned IPs, view security logs and intrusion attempts.',
          version: '1.0.5',
          author: 'Panelku Team',
          icon: 'bi-shield-exclamation',
          color: '#ef4444',
          category: 'security',
          downloads: 1100,
          
        },
        {
          id: 'nextcloud-manager',
          name: 'Nextcloud Manager',
          description: 'Deploy and manage Nextcloud with Docker. Backup data, manage users, and configure apps.',
          version: '1.3.0',
          author: 'Panelku Team',
          icon: 'bi-cloud',
          color: '#0082c9',
          category: 'storage',
          downloads: 650,
          
        },
        {
          id: 'uptime-kuma-manager',
          name: 'Uptime Kuma Manager',
          description: 'Self-hosted uptime monitoring with status pages, notifications, and SSL checks.',
          version: '1.0.0',
          author: 'Panelku Team',
          icon: 'bi-activity',
          color: '#5cdd8b',
          category: 'monitoring',
          downloads: 520,
          
        },
        {
          id: 'wireguard-manager',
          name: 'WireGuard VPN Manager',
          description: 'Manage WireGuard VPN peers, generate configs, monitor traffic and connection status.',
          version: '1.0.0',
          author: 'Panelku Team',
          icon: 'bi-shield-lock',
          color: '#38bdf8',
          category: 'network',
          downloads: 430,
          
        },
        {
          id: 'redis-manager',
          name: 'Redis Manager',
          description: 'Monitor Redis keyspace, memory usage, manage config, flush, backup, and performance.',
          version: '1.0.0',
          author: 'Panelku Team',
          icon: 'bi-database-fill-gear',
          color: '#dc382d',
          category: 'database',
          downloads: 380,
          
        },
        {
          id: 'rclone-manager',
          name: 'Rclone Manager',
          description: 'Manage rclone remotes for cloud storage sync across S3, Google Drive, Dropbox, and more.',
          version: '1.0.0',
          author: 'Panelku Team',
          icon: 'bi-cloud-arrow-up',
          color: '#6366f1',
          category: 'storage',
          downloads: 310,
          
        },
        {
          id: 'rclone-backuper',
          name: 'Rclone Backuper',
          description: 'Scheduled backups to cloud storage via rclone with retention policies.',
          version: '1.0.0',
          author: 'Panelku Team',
          icon: 'bi-archive',
          color: '#10b981',
          category: 'backup',
          downloads: 290,
          
        },
        {
          id: 'log-analyzer-manager',
          name: 'Log Analyzer',
          description: 'Parse and analyze system logs, detect anomalies, and visualize log patterns.',
          version: '1.0.0',
          author: 'Panelku Team',
          icon: 'bi-journal-text',
          color: '#f59e0b',
          category: 'monitoring',
          downloads: 270,
          
        },
        {
          id: 'lvm-manager',
          name: 'LVM Manager',
          description: 'Manage Logical Volume Manager volumes, resize, snapshot, and monitor disk usage.',
          version: '1.0.0',
          author: 'Panelku Team',
          icon: 'bi-hdd-stack',
          color: '#8b5cf6',
          category: 'storage',
          downloads: 150,
          
        },
        {
          id: 'pm2-manager',
          name: 'PM2 Manager',
          description: 'Monitor and manage PM2 processes, logs, restart policies, and clustering.',
          version: '1.0.0',
          author: 'Panelku Team',
          icon: 'bi-diagram-3',
          color: '#2b4ad4',
          category: 'runtime',
          downloads: 200,
          
        },
      ];


      const result = marketplace.map(p => ({
        ...p,
        path: `/plugins/${p.id}`,
        installed: installedIds.includes(p.id),
      }));

      return successResponse(res, result, 'Marketplace plugins retrieved');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Plugin Upload ────────────────────────────────────────────────────

  async uploadPlugin(req, res) {
    try {
      // This would handle multer upload of a plugin zip file
      // For now, return helpful instructions
      return successResponse(res, {
        message: 'Plugin upload is handled via the plugins directory. To install a plugin:\n' +
          '1. Download the plugin zip file\n' +
          '2. Extract it to /opt/panelku/plugins/<plugin-name>/\n' +
          '3. Ensure it has a valid plugin.json manifest\n' +
          '4. Go to Plugins page and click Install',
      }, 'Upload instructions');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async updatePlugin(req, res) {
    try {
      const { id } = req.body;
      if (!id) return errorResponse(res, 'Plugin ID is required', 400);
      const safeId = validatePluginId(id);
      const io = req.app.get('io');

      const proc = processRunner.create(io, {
        title: `Updating Plugin: ${safeId}`,
        subtitle: 'Snapshot backup, dependency sync, and runtime reload',
        steps: [
          'Create pre-update snapshot backup',
          'Update manifest & install dependencies',
          'Reload plugin into runtime & verify'
        ]
      });

      pluginUpdateService.updatePlugin({ id: safeId, app: req.app, io, proc }).catch((err) => {
        proc.fail(err.message);
      });

      return successResponse(res, { processId: proc.id }, `Update started for ${safeId}`);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async checkUpdates(req, res) {
    try {
      const io = req.app.get('io');
      const proc = processRunner.create(io, {
        title: 'Checking Plugin Updates',
        subtitle: 'Comparing local plugin manifests against release catalog',
        steps: ['Scan plugin manifests', 'Save update state to SQLite']
      });
      const policy = await pluginUpdateService.checkUpdates({ proc });
      return successResponse(res, { policy, processId: proc.id }, 'Plugin update check completed');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async updatePolicy(req, res) {
    try {
      const { pluginId, autoUpdate, intervalHours, autoUpdateEnabled } = req.body;
      let policy;
      if (pluginId) {
        const safeId = validatePluginId(pluginId);
        policy = await pluginUpdateService.togglePluginAutoUpdate(safeId, Boolean(autoUpdate));
      } else {
        const patch = {};
        if (intervalHours !== undefined) patch.intervalHours = Number(intervalHours);
        if (autoUpdateEnabled !== undefined) patch.autoUpdateEnabled = Boolean(autoUpdateEnabled);
        policy = await pluginUpdateService.savePolicy(patch);
      }
      return successResponse(res, policy, 'Plugin update policy saved');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async updateAllPlugins(req, res) {
    try {
      const io = req.app.get('io');
      const currentPolicy = await pluginUpdateService.checkUpdates();
      const ids = Object.keys(currentPolicy.availableUpdates || {});
      if (ids.length === 0) {
        return successResponse(res, { updated: 0 }, 'All plugins are already up to date');
      }

      const proc = processRunner.create(io, {
        title: `Updating ${ids.length} Plugin(s)`,
        subtitle: ids.join(', '),
        steps: ids.map((id) => `Update ${id}`)
      });

      (async () => {
        for (let i = 0; i < ids.length; i++) {
          const id = ids[i];
          proc.startStep(i, `Updating ${id}...`);
          const subProc = processRunner.create(null, { title: id, steps: ['Snapshot', 'Install', 'Reload'] });
          try {
            await pluginUpdateService.updatePlugin({ id, app: req.app, io, proc: subProc });
            subProc.getState().logs.forEach((l) => proc.log(`[${id}] ${l.text}`, l.stream));
            proc.completeStep(i, 'Updated');
          } catch (err) {
            proc.failStep(i, err.message);
            proc.log(`[${id}] Failed: ${err.message}`, 'stderr');
          }
        }
        proc.finish({ updated: ids.length }, 'Batch plugin update completed.');
      })().catch((err) => proc.fail(err.message));

      return successResponse(res, { processId: proc.id, count: ids.length }, 'Batch update started');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async getProcessStatus(req, res) {
    const proc = processRunner.get(req.params.processId);
    if (!proc) return errorResponse(res, 'Process not found', 404);
    return successResponse(res, proc, 'Process status');
  }
}

export default new PluginsController();
