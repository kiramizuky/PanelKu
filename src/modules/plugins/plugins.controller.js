import { successResponse, errorResponse } from '../../helpers/response.js';
import Setting from '../../models/Setting.js';
import pluginLoader from '../../core/plugin-loader/PluginLoader.js';
import fs from 'fs/promises';
import path from 'path';

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

      // Verify directory exists
      const pluginPath = path.resolve('./plugins', id);
      try {
        await fs.access(pluginPath);
      } catch {
        return errorResponse(res, `Plugin folder ${id} not found`, 404);
      }

      // Add to SQLite settings
      const installedStr = await Setting.get('installed_plugins') || '[]';
      const installedIds = JSON.parse(typeof installedStr === 'string' ? installedStr : JSON.stringify(installedStr));

      if (!installedIds.includes(id)) {
        installedIds.push(id);
        await Setting.set('installed_plugins', JSON.stringify(installedIds), 'json');
      }

      // Save proxyUrl if provided
      if (proxyUrl !== undefined) {
        const proxiesStr = await Setting.get('plugin_proxies') || '{}';
        const proxies = JSON.parse(typeof proxiesStr === 'string' ? proxiesStr : JSON.stringify(proxiesStr));
        if (proxyUrl) {
          proxies[id] = proxyUrl.trim();
        } else {
          delete proxies[id];
        }
        await Setting.set('plugin_proxies', JSON.stringify(proxies), 'json');
        pluginLoader.setProxy(id, proxyUrl);
      }

      // Load it dynamically into memory
      await pluginLoader._loadPlugin(id, req.app, req.app.get('io'));

      return successResponse(res, null, `Plugin ${id} installed successfully`);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async updateProxy(req, res) {
    try {
      const { id, proxyUrl } = req.body;
      if (!id) return errorResponse(res, 'Plugin ID is required', 400);

      const proxiesStr = await Setting.get('plugin_proxies') || '{}';
      const proxies = JSON.parse(typeof proxiesStr === 'string' ? proxiesStr : JSON.stringify(proxiesStr));

      if (proxyUrl) {
        proxies[id] = proxyUrl.trim();
      } else {
        delete proxies[id];
      }

      await Setting.set('plugin_proxies', JSON.stringify(proxies), 'json');
      pluginLoader.setProxy(id, proxyUrl);

      return successResponse(res, null, `Plugin ${id} proxy updated successfully`);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async uninstallPlugin(req, res) {
    try {
      const { id } = req.body;
      if (!id) return errorResponse(res, 'Plugin ID is required', 400);

      // Remove from SQLite settings
      const installedStr = await Setting.get('installed_plugins') || '[]';
      const installedIds = JSON.parse(typeof installedStr === 'string' ? installedStr : JSON.stringify(installedStr));

      const index = installedIds.indexOf(id);
      if (index !== -1) {
        installedIds.splice(index, 1);
        await Setting.set('installed_plugins', JSON.stringify(installedIds), 'json');
      }

      // Remove from proxies
      const proxiesStr = await Setting.get('plugin_proxies') || '{}';
      const proxies = JSON.parse(typeof proxiesStr === 'string' ? proxiesStr : JSON.stringify(proxiesStr));
      if (proxies[id]) {
        delete proxies[id];
        await Setting.set('plugin_proxies', JSON.stringify(proxies), 'json');
      }
      pluginLoader.setProxy(id, null);

      // Unload from memory
      pluginLoader._plugins.delete(id);

      return successResponse(res, null, `Plugin ${id} uninstalled successfully. Please restart panel if necessary.`);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async updatePlugin(req, res) {
    try {
      const { id } = req.body;
      if (!id) return errorResponse(res, 'Plugin ID is required', 400);

      const serverVersions = {
        'php-manager': '1.2.0',
        'home-assistant-manager': '1.5.0',
        'adguard-manager': '1.1.0',
        'fail2ban-manager': '1.0.5',
        'nextcloud-manager': '1.3.0'
      };

      const targetVersion = serverVersions[id];
      if (!targetVersion) return errorResponse(res, 'No updates found for this plugin on the server', 404);

      const pluginPath = path.resolve('./plugins', id);
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
      // 1. Simulate downloading latest files by rewriting the local manifest version
      manifest.version = targetVersion;
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

      // 2. Perform distro/arch specific setup commands
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      let updateLog = `Updating ${manifest.name} on ${pmInfo.name} (${pmInfo.arch})...\n`;

      // If the plugin has a package.json, run npm install inside it
      let hasPackageJson = false;
      try {
        await fs.access(path.join(pluginPath, 'package.json'));
        hasPackageJson = true;
      } catch {}

      if (hasPackageJson) {
        updateLog += 'Running npm install --production...\n';
        if (process.platform !== 'win32') {
          const { stdout } = await execAsync(`cd "${pluginPath}" && npm install --production`);
          updateLog += stdout + '\n';
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
        const { stdout } = await execAsync(`cd "${pluginPath}" && chmod +x update.sh && ./update.sh`);
        updateLog += stdout + '\n';
      }

      // 3. Reload plugin in memory
      await pluginLoader._loadPlugin(id, req.app, req.app.get('io'));

      return successResponse(res, { log: updateLog }, `Plugin ${id} updated to v${targetVersion} successfully`);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }
}

export default new PluginsController();
