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

      const pluginsList = [];
      for (const entry of dirs) {
        if (!entry.isDirectory()) continue;
        try {
          const manifestPath = path.join(pluginsDir, entry.name, 'plugin.json');
          const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
          pluginsList.push({
            id: entry.name,
            name: manifest.name || entry.name,
            description: manifest.description || '',
            version: manifest.version || '1.0.0',
            installed: installedIds.includes(entry.name)
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
      const { id } = req.body;
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

      // Load it dynamically into memory
      await pluginLoader._loadPlugin(id, req.app, req.app.get('io'));

      return successResponse(res, null, `Plugin ${id} installed successfully`);
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

      // Unload from memory
      pluginLoader._plugins.delete(id);

      return successResponse(res, null, `Plugin ${id} uninstalled successfully. Please restart panel if necessary.`);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }
}

export default new PluginsController();
