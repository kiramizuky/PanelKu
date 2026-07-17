import apacheService from './apache.service.js';
import { successResponse, errorResponse } from '../../helpers/response.js';

class ApacheController {
  // ── Status ──────────────────────────────────────────────────────

  async getStatus(req, res) {
    try {
      const status = await apacheService.getStatus();
      return successResponse(res, { status });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Install / Uninstall ────────────────────────────────────────

  async install(req, res) {
    try {
      const result = await apacheService.installApache();
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async uninstall(req, res) {
    try {
      const result = await apacheService.uninstallApache();
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Service Control ────────────────────────────────────────────

  async serviceAction(req, res) {
    try {
      const { action } = req.body;
      if (!action) return errorResponse(res, 'Action is required (start/stop/restart/reload)', 400);
      if (!['start', 'stop', 'restart', 'reload'].includes(action)) {
        return errorResponse(res, 'Invalid action. Use: start, stop, restart, reload', 400);
      }
      const result = await apacheService.serviceAction(action);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async testConfig(req, res) {
    try {
      const result = await apacheService.testConfig();
      return successResponse(res, result, result.valid ? 'Config syntax OK' : 'Config has errors');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Modules ────────────────────────────────────────────────────

  async getModules(req, res) {
    try {
      const modules = await apacheService.getModules();
      return successResponse(res, { modules });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async enableModule(req, res) {
    try {
      const { name } = req.body;
      if (!name) return errorResponse(res, 'Module name is required', 400);
      const result = await apacheService.enableModule(name);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async disableModule(req, res) {
    try {
      const { name } = req.body;
      if (!name) return errorResponse(res, 'Module name is required', 400);
      const result = await apacheService.disableModule(name);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Virtual Hosts ──────────────────────────────────────────────

  async getVhosts(req, res) {
    try {
      const vhosts = await apacheService.getVhosts();
      return successResponse(res, { vhosts });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async getVhost(req, res) {
    try {
      const vhost = await apacheService.getVhost(req.params.name);
      return successResponse(res, { vhost });
    } catch (error) {
      return errorResponse(res, error.message, 404);
    }
  }

  async createVhost(req, res) {
    try {
      const { serverName, aliases, type, rootDirectory, port, phpVersion, sslCert, sslKey, createRoot } = req.body;
      if (!serverName) return errorResponse(res, 'ServerName is required', 400);

      const result = await apacheService.createVhost({
        serverName, aliases, type, rootDirectory, port, phpVersion, sslCert, sslKey, createRoot,
      });
      return successResponse(res, result, result.message, 201);
    } catch (error) {
      return errorResponse(res, error.message, 400);
    }
  }

  async updateVhost(req, res) {
    try {
      const { name } = req.params;
      const result = await apacheService.updateVhost(name, req.body);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 400);
    }
  }

  async deleteVhost(req, res) {
    try {
      const result = await apacheService.deleteVhost(req.params.name);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 400);
    }
  }

  async toggleVhost(req, res) {
    try {
      const { name, enable } = req.body;
      if (!name) return errorResponse(res, 'Vhost name is required', 400);
      if (enable === undefined) return errorResponse(res, 'Enable flag is required', 400);

      const result = await apacheService.toggleVhost(name, enable);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Config File ────────────────────────────────────────────────

  async getConfig(req, res) {
    try {
      const config = await apacheService.getMainConfig();
      return successResponse(res, { config });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async saveConfig(req, res) {
    try {
      const { content } = req.body;
      if (!content) return errorResponse(res, 'Config content is required', 400);
      const result = await apacheService.saveMainConfig(content);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 400);
    }
  }

  // ── Logs ───────────────────────────────────────────────────────

  async getLogs(req, res) {
    try {
      const { vhost, type, lines } = req.query;
      const result = await apacheService.getLogs(vhost, type, parseInt(lines) || 100);
      return successResponse(res, result);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }
}

export default new ApacheController();
