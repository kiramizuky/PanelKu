import caddyService from './caddy.service.js';
import { successResponse, errorResponse } from '../../helpers/response.js';

class CaddyController {
  // ── Status ──────────────────────────────────────────────────────

  async getStatus(req, res) {
    try {
      const status = await caddyService.getStatus();
      return successResponse(res, { status });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Install / Uninstall ────────────────────────────────────────

  async install(req, res) {
    try {
      const result = await caddyService.installCaddy();
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async uninstall(req, res) {
    try {
      const result = await caddyService.uninstallCaddy();
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
      const result = await caddyService.serviceAction(action);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Caddyfile Management ────────────────────────────────────────

  async getCaddyfile(req, res) {
    try {
      const caddyfile = await caddyService.getCaddyfile();
      return successResponse(res, { caddyfile });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async saveCaddyfile(req, res) {
    try {
      const { content } = req.body;
      if (!content) return errorResponse(res, 'Caddyfile content is required', 400);
      const result = await caddyService.saveCaddyfile(content);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 400);
    }
  }

  async validateCaddyfile(req, res) {
    try {
      const { content } = req.body;
      const result = await caddyService.validateCaddyfile(content);
      return successResponse(res, result, result.valid ? 'Syntax OK' : 'Syntax has errors');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async formatCaddyfile(req, res) {
    try {
      const result = await caddyService.formatCaddyfile();
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Site Management ─────────────────────────────────────────────

  async getSites(req, res) {
    try {
      const sites = await caddyService.getSites();
      return successResponse(res, { sites });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async getSite(req, res) {
    try {
      const site = await caddyService.getSite(req.params.name);
      return successResponse(res, { site });
    } catch (error) {
      return errorResponse(res, error.message, 404);
    }
  }

  async createSite(req, res) {
    try {
      const { domain, name, type, rootDir, port, phpSocket, redirectTarget, redirectCode, ssl, extraDirectives, createRoot, basicAuthUser, basicAuthPass } = req.body;
      if (!domain) return errorResponse(res, 'Domain is required', 400);

      const result = await caddyService.createSite({
        domain, name, type, rootDir, port, phpSocket,
        redirectTarget, redirectCode, ssl, extraDirectives,
        createRoot, basicAuthUser, basicAuthPass,
      });
      return successResponse(res, result, result.message, 201);
    } catch (error) {
      return errorResponse(res, error.message, 400);
    }
  }

  async updateSite(req, res) {
    try {
      const { name } = req.params;
      const result = await caddyService.updateSite(name, req.body);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 400);
    }
  }

  async deleteSite(req, res) {
    try {
      const result = await caddyService.deleteSite(req.params.name);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 400);
    }
  }

  async toggleSite(req, res) {
    try {
      const { name, enable } = req.body;
      if (!name) return errorResponse(res, 'Site name is required', 400);
      if (enable === undefined) return errorResponse(res, 'Enable flag is required', 400);
      const result = await caddyService.toggleSite(name, enable);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Certificates ────────────────────────────────────────────────

  async getCertificates(req, res) {
    try {
      const certs = await caddyService.getCertificates();
      return successResponse(res, { certificates: certs });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Admin API ────────────────────────────────────────────────────

  async getAdminConfig(req, res) {
    try {
      const config = await caddyService.getAdminConfig();
      return successResponse(res, { config });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async getAdminStats(req, res) {
    try {
      const stats = await caddyService.getAdminStats();
      return successResponse(res, { stats });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async getAdminReverseProxy(req, res) {
    try {
      const upstreams = await caddyService.getAdminReverseProxy();
      return successResponse(res, { upstreams });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Logs ────────────────────────────────────────────────────────

  async getLogs(req, res) {
    try {
      const { type, lines } = req.query;
      const result = await caddyService.getLogs(type, parseInt(lines) || 100);
      return successResponse(res, result);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Validate All Configs ────────────────────────────────────────

  async validateConfig(req, res) {
    try {
      const result = await caddyService.validateAllConfigs();
      return successResponse(res, result, result.valid ? 'Configuration is valid' : 'Configuration has errors');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }
}

export default new CaddyController();
