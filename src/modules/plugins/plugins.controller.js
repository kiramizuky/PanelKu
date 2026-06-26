import { successResponse, errorResponse } from '../../helpers/response.js';

// Dummy plugins for marketplace
const MOCK_PLUGINS = [
  { id: 'redis-manager', name: 'Redis Manager', description: 'Advanced UI for managing Redis caching server.', version: '1.0.2', installed: false },
  { id: 'phpmyadmin', name: 'phpMyAdmin', description: 'Web interface for MySQL and MariaDB.', version: '5.2.1', installed: false },
  { id: 'wordpress-toolkit', name: 'WordPress Toolkit', description: 'One-click installer and manager for WordPress.', version: '2.1.0', installed: false },
  { id: 'fail2ban-gui', name: 'Fail2Ban GUI', description: 'Manage ban rules and view blocked IPs visually.', version: '1.4.5', installed: false }
];

class PluginsController {
  async getPlugins(req, res) {
    try {
      successResponse(res, MOCK_PLUGINS, 'Plugins retrieved');
    } catch (error) {
      errorResponse(res, 500, error.message);
    }
  }

  async installPlugin(req, res) {
    try {
      const { id } = req.body;
      const plugin = MOCK_PLUGINS.find(p => p.id === id);
      if (!plugin) return errorResponse(res, 404, 'Plugin not found');

      // Simulate installation
      plugin.installed = true;
      successResponse(res, plugin, `Plugin ${plugin.name} installed successfully`);
    } catch (error) {
      errorResponse(res, 500, error.message);
    }
  }

  async uninstallPlugin(req, res) {
    try {
      const { id } = req.body;
      const plugin = MOCK_PLUGINS.find(p => p.id === id);
      if (!plugin) return errorResponse(res, 404, 'Plugin not found');

      // Simulate uninstallation
      plugin.installed = false;
      successResponse(res, plugin, `Plugin ${plugin.name} uninstalled successfully`);
    } catch (error) {
      errorResponse(res, 500, error.message);
    }
  }
}

export default new PluginsController();
