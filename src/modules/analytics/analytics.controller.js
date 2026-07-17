import analyticsService from './analytics.service.js';
import { successResponse, errorResponse } from '../../helpers/response.js';

class AnalyticsController {
  // ── Metrics ──────────────────────────────────────────────────────

  async getMetricsHistory(req, res) {
    try {
      const hours = parseInt(req.query.hours) || 24;
      const data = await analyticsService.getMetricsHistory(Math.min(Math.max(hours, 1), 720));
      return successResponse(res, data);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async getRealtimeMetrics(req, res) {
    try {
      const data = await analyticsService.getRealtimeMetrics();
      return successResponse(res, data);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Logs ─────────────────────────────────────────────────────────

  async getSystemLogs(req, res) {
    try {
      const type = req.query.type || 'syslog';
      const lines = parseInt(req.query.lines) || 100;
      const data = await analyticsService.getSystemLogs(type, lines);
      return successResponse(res, data);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async getWebLogs(req, res) {
    try {
      const service = req.query.service || 'nginx';
      const logType = req.query.logType || 'access';
      const lines = parseInt(req.query.lines) || 100;
      const data = await analyticsService.getWebLogs(service, logType, lines);
      return successResponse(res, data);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Services ─────────────────────────────────────────────────────

  async getServiceHealth(req, res) {
    try {
      const data = await analyticsService.getServiceHealth();
      return successResponse(res, data);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Processes ────────────────────────────────────────────────────

  async getTopProcesses(req, res) {
    try {
      const sortBy = req.query.sort || 'cpu';
      const limit = parseInt(req.query.limit) || 20;
      const data = await analyticsService.getTopProcesses(sortBy, limit);
      return successResponse(res, data);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Network ──────────────────────────────────────────────────────

  async getNetworkAnalytics(req, res) {
    try {
      const data = await analyticsService.getNetworkAnalytics();
      return successResponse(res, data);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Docker ───────────────────────────────────────────────────────

  async getDockerAnalytics(req, res) {
    try {
      const data = await analyticsService.getDockerAnalytics();
      return successResponse(res, data);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }
}

export default new AnalyticsController();
