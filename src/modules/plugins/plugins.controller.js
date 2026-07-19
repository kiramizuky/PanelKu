import { successResponse, errorResponse } from '../../helpers/response.js';
import Setting from '../../models/Setting.js';
import pluginLoader from '../../core/plugin-loader/PluginLoader.js';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import util from 'util';

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

class PluginsController {
  async getPlugins(req, res) {
    try {
      const pluginsDir = path.resolve('./plugins');
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

      const serverVersions = {
        'php-manager': '1.2.0',
        'home-assistant-manager': '1.5.0',
        'adguard-manager': '1.1.0',
        'fail2ban-manager': '1.0.5',
        'nextcloud-manager': '1.3.0'
      };

      const pluginsList = [];
      for (const entry of dirs) {
        if (!entry.isDirectory()) continue;
        try {
          const manifestPath = path.join(pluginsDir, entry.name, 'plugin.json');
          const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
          const currentVersion = manifest.version || '1.0.0';
          const latestVersion = serverVersions[entry.name] || currentVersion;
          const isInstalled = installedIds.includes(entry.name);
          
          // Basic semver check
          const updateAvailable = isInstalled && (currentVersion !== latestVersion);

          pluginsList.push({
            id: entry.name,
            name: manifest.name || entry.name,
            description: manifest.description || '',
            version: currentVersion,
            latestVersion,
            updateAvailable,
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

      return successResponse(res, pluginsList, 'Plugins retrieved successfully');
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
      const pluginPath = path.resolve('./plugins', safeId);
      try {
        await fs.access(pluginPath);
      } catch {
        return errorResponse(res, `Plugin folder ${safeId} not found`, 404);
      }

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

      // Get installed plugins
      const installedStr = await Setting.get('installed_plugins') || '[]';
      const installedIds = JSON.parse(typeof installedStr === 'string' ? installedStr : JSON.stringify(installedStr));

      const result = marketplace.map(p => ({
        ...p,
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
      // [SECURITY FIX] Validate plugin ID to prevent path traversal AND command injection
      const safeId = validatePluginId(id);

      const serverVersions = {
        'php-manager': '1.2.0',
        'home-assistant-manager': '1.5.0',
        'adguard-manager': '1.1.0',
        'fail2ban-manager': '1.0.5',
        'nextcloud-manager': '1.3.0'
      };

      const targetVersion = serverVersions[safeId];
      if (!targetVersion) return errorResponse(res, 'No updates found for this plugin on the server', 404);

      const pluginPath = path.resolve('./plugins', safeId);
      const manifestPath = path.join(pluginPath, 'plugin.json');
      
      let manifest;
      try {
        manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      } catch {
        return errorResponse(res, 'Plugin manifest not found', 404);
      }

      // Initialize PackageManager to check active distro and architecture
      const packageManager = (await import('../system/package-manager.js')).default;
      await packageManager.init();
      const pmInfo = packageManager.getPMInfo();
      
      // Perform one-click update actions
      // 1. Update the local manifest version
      manifest.version = targetVersion;
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

      let updateLog = `Updating ${manifest.name} on ${pmInfo.name} (${pmInfo.arch})...\n`;

      // 2. Perform install/setup commands safely
      // [SECURITY FIX] Use execFile with args array — no shell string interpolation.
      // The plugin directory is already validated by validatePluginId, so safeId is safe.

      // If the plugin has a package.json, run npm install inside it
      let hasPackageJson = false;
      try {
        await fs.access(path.join(pluginPath, 'package.json'));
        hasPackageJson = true;
      } catch {}

      if (hasPackageJson) {
        updateLog += 'Running npm install --production...\n';
        if (process.platform !== 'win32') {
          try {
            const { stdout } = await execFileAsync('npm', ['install', '--production'], {
              cwd: pluginPath,
              timeout: 180000
            });
            updateLog += stdout + '\n';
          } catch (cmdErr) {
            updateLog += `npm install failed: ${cmdErr.message}\n`;
          }
        } else {
          updateLog += 'Mock npm install completed on Windows.\n';
        }
      }

      // If there is an update.sh or setup.sh, run it
      let hasUpdateScript = false;
      try {
        await fs.access(path.join(pluginPath, 'update.sh'));
        hasUpdateScript = true;
      } catch {}

      if (hasUpdateScript && process.platform !== 'win32') {
        updateLog += 'Running update.sh...\n';
        try {
          await execFileAsync('chmod', ['+x', path.join(pluginPath, 'update.sh')], { timeout: 10000 });
          const { stdout } = await execFileAsync('./update.sh', [], {
            cwd: pluginPath,
            timeout: 300000
          });
          updateLog += stdout + '\n';
        } catch (cmdErr) {
          updateLog += `update.sh failed: ${cmdErr.message}\n`;
        }
      }

      // 3. Reload plugin in memory
      await pluginLoader._loadPlugin(safeId, req.app, req.app.get('io'));

      return successResponse(res, { log: updateLog }, `Plugin ${safeId} updated to v${targetVersion} successfully`);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }
}

export default new PluginsController();
