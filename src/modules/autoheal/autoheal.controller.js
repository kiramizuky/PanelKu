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

  // ── Status ──

  async getStatus(req, res) {
    try {
      const status = await autohealService.getCurrentStatus();
      return successResponse(res, { status });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Manual Check ──

  async runCheck(req, res) {
    try {
      const results = await autohealService.runManualCheck();
      return successResponse(res, { results }, 'Health check complete');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Heal Service ──

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
}

export default new AutoHealController();
