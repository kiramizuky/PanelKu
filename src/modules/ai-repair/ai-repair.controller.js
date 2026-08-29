import aiRepairService from './ai-repair.service.js';
import anomalyDetectorService from './anomaly-detector.service.js';
import { successResponse, errorResponse } from '../../helpers/response.js';

class AIRepairController {
  // ── Configuration ────────────────────────────────────────────────

  async getConfig(req, res) {
    try {
      const config = await aiRepairService.getConfig();
      return successResponse(res, config);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async saveConfig(req, res) {
    try {
      const result = await aiRepairService.saveConfig(req.body);
      return successResponse(res, result.config, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 400);
    }
  }

  // ── Log Analysis ─────────────────────────────────────────────────

  async analyzeLog(req, res) {
    try {
      const { log, type, lines } = req.body;
      if (!log) return errorResponse(res, 'Log content is required', 400);
      const result = await aiRepairService.analyzeLog(log, type, parseInt(lines) || 200);
      return successResponse(res, result);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Auto Diagnostic ──────────────────────────────────────────────

  async runDiagnostic(req, res) {
    try {
      const result = await aiRepairService.runAutoDiagnostic();
      return successResponse(res, result);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Auto-Fix ─────────────────────────────────────────────────────

  async getFixSuggestions(req, res) {
    try {
      const { fixId, ...params } = req.query;
      if (!fixId) return errorResponse(res, 'Fix ID is required', 400);
      const result = await aiRepairService.getAutoFixSuggestions(fixId, params);
      return successResponse(res, result);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async applyFix(req, res) {
    try {
      const { fixId, ...params } = req.body;
      if (!fixId) return errorResponse(res, 'Fix ID is required', 400);
      const result = await aiRepairService.applyAutoFix(fixId, params);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 400);
    }
  }

  async suggestFix(req, res) {
    try {
      const { log } = req.body;
      if (!log) return errorResponse(res, 'Log content is required', 400);
      const result = await aiRepairService.suggestFix(log);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Predictive Alerts & Anomaly Detection ────────────────────────

  async analyzeTrends(req, res) {
    try {
      const hours = parseInt(req.query.hours) || 24;
      const result = await aiRepairService.analyzeTrends(Math.min(Math.max(hours, 1), 720));
      return successResponse(res, result);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async scanAnomalies(req, res) {
    try {
      const result = await anomalyDetectorService.scanLogAnomalies();
      return successResponse(res, result, 'Log anomalies scanned');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Incident Post-Mortem Reports (Fase 3) ────────────────────────

  async listIncidents(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 20;
      const reports = await anomalyDetectorService.listIncidentReports(limit);
      return successResponse(res, { reports }, 'Incident reports retrieved');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async createIncident(req, res) {
    try {
      const report = await anomalyDetectorService.createIncidentReport(req.body);
      return successResponse(res, { report }, 'Incident report created');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Health Score ─────────────────────────────────────────────────

  async getHealthScore(req, res) {
    try {
      const result = await aiRepairService.getHealthScore();
      return successResponse(res, result);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Available Fix Patterns ───────────────────────────────────────

  async getFixPatterns(req, res) {
    try {
      const patterns = [
        { id: 'port.conflict', name: 'Port Conflict', severity: 'critical', description: 'Detects and resolves port conflicts by killing the process on the specified port' },
        { id: 'disk.full', name: 'Disk Space Critical', severity: 'critical', description: 'Cleans up journal logs, Docker data, and package cache' },
        { id: 'service.down', name: 'Service Not Running', severity: 'high', description: 'Restarts a failed systemd service' },
        { id: 'permission.denied', name: 'Permission Denied', severity: 'medium', description: 'Resets file permissions on a directory' },
        { id: 'high.cpu', name: 'High CPU Usage', severity: 'high', description: 'Diagnoses high CPU and clears OS cache' },
        { id: 'high.ram', name: 'High RAM Usage', severity: 'high', description: 'Diagnoses high RAM and clears OS cache' },
        { id: 'nginx.error', name: 'Nginx Config Error', severity: 'high', description: 'Tests Nginx configuration and reports errors' },
      ];
      return successResponse(res, patterns);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }
}

export default new AIRepairController();

