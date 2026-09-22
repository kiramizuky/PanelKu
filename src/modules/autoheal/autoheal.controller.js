import autohealService from './autoheal.service.js';
import { successResponse, errorResponse } from '../../helpers/response.js';

class AutoHealController {
  // ── Config ──

  async getConfig(req, res) {
    try {
      const config = await autohealService.getConfig();
      return successResponse(res, { config });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async saveConfig(req, res) {
    try {
      const result = await autohealService.saveConfig(req.body);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 400);
    }
  }

  // ── Status & Providers ──

  async getStatus(req, res) {
    try {
      const status = await autohealService.getCurrentStatus();
      return successResponse(res, { status });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async getProviders(req, res) {
    try {
      const providers = autohealService.getProviders();
      return successResponse(res, { providers });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Universal Diagnostics ──

  async diagnoseAll(req, res) {
    try {
      const diagnosis = await autohealService.diagnoseAll();
      return successResponse(res, { diagnosis }, 'Full multi-module diagnosis completed');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Manual Checks & Healing ──

  async runCheck(req, res) {
    try {
      const results = await autohealService.runManualCheck();
      return successResponse(res, { results }, 'Health check complete');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async healService(req, res) {
    try {
      const { name } = req.body;
      if (!name) return errorResponse(res, 'Service name is required', 400);
      const result = await autohealService.healService(name);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async healModule(req, res) {
    try {
      const { module: moduleKey, target = 'all' } = req.body;
      if (!moduleKey) return errorResponse(res, 'Module key is required', 400);
      const result = await autohealService.healModule(moduleKey, target);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async healAll(req, res) {
    try {
      const result = await autohealService.healAll();
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Incidents ──

  async getIncidents(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const incidents = await autohealService.getIncidentHistory(limit);
      return successResponse(res, { incidents });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Emergency Playbooks ──

  async emergencyClean(req, res) {
    try {
      const result = await autohealService.executeDiskEmergencyClean();
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async resurrectServices(req, res) {
    try {
      const result = await autohealService.resurrectDeadServices();
      return successResponse(res, result, 'Service resurrect routine finished');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }
}

export default new AutoHealController();
