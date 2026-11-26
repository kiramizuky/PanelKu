/**
 * Panelku — Vulnerabilities Controller (v3.8.0)
 */

import vulnerabilitiesService from './vulnerabilities.service.js';
import hardeningService from './hardening.service.js';
import fimService from './fim.service.js';
import { success, error } from '../../helpers/response.js';
import logger from '../../config/logger.js';

class VulnerabilitiesController {
  async getSummary(req, res) {
    try {
      const summary = await vulnerabilitiesService.getSummary();
      return success(res, summary, 'Summary loaded successfully');
    } catch (err) {
      logger.error(`Failed to get vulnerability summary: ${err.message}`);
      return error(res, err.message, 500);
    }
  }

  async getScans(req, res) {
    try {
      const limit = req.query.limit || 10;
      const scans = await vulnerabilitiesService.getScans(limit);
      return success(res, scans, 'Scans loaded successfully');
    } catch (err) {
      logger.error(`Failed to get scans: ${err.message}`);
      return error(res, err.message, 500);
    }
  }

  async getFindings(req, res) {
    try {
      const filters = {
        category: req.query.category,
        severity: req.query.severity,
        status: req.query.status,
        scanId: req.query.scanId,
        limit: req.query.limit,
      };
      const findings = await vulnerabilitiesService.getFindings(filters);
      return success(res, findings, 'Findings loaded successfully');
    } catch (err) {
      logger.error(`Failed to get findings: ${err.message}`);
      return error(res, err.message, 500);
    }
  }

  async startScan(req, res) {
    try {
      const scanType = req.body.type || 'full';
      const result = await vulnerabilitiesService.startScan(scanType);
      return success(res, result, 'Vulnerability scan completed successfully.');
    } catch (err) {
      logger.error(`Scan execution failed: ${err.message}`);
      return error(res, err.message, 500);
    }
  }

  async remediate(req, res) {
    try {
      const { id } = req.params;
      const { confirmed } = req.body;
      const result = await vulnerabilitiesService.remediate(id, {
        confirmed: Boolean(confirmed),
        user: req.user,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      return success(res, result, result.message);
    } catch (err) {
      logger.error(`Remediation failed: ${err.message}`);
      return error(res, err.message, 400);
    }
  }

  async ignoreFinding(req, res) {
    try {
      const { id } = req.params;
      const result = await vulnerabilitiesService.ignoreFinding(id);
      return success(res, result, result.message);
    } catch (err) {
      logger.error(`Failed to ignore finding: ${err.message}`);
      return error(res, err.message, 500);
    }
  }

  async askAI(req, res) {
    try {
      const { question, context } = req.body;
      const result = await vulnerabilitiesService.askAI(question, context);
      return success(res, result, 'AI response received');
    } catch (err) {
      logger.error(`Failed to query AI copilot: ${err.message}`);
      return error(res, err.message, 500);
    }
  }

  async exportReport(req, res) {
    try {
      const format = req.query.format || 'markdown';
      const report = await vulnerabilitiesService.exportReport(format);

      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="panelku-vulnerability-report.json"');
        return res.send(JSON.stringify(report, null, 2));
      }

      if (format === 'sarif') {
        res.setHeader('Content-Type', 'application/sarif+json; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="panelku-vulnerability-report.sarif.json"');
        return res.send(JSON.stringify(report, null, 2));
      }

      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="panelku-vulnerability-report.md"');
      return res.send(report);
    } catch (err) {
      logger.error(`Failed to export report: ${err.message}`);
      return error(res, err.message, 500);
    }
  }

  async getCisReport(req, res) {
    try {
      const report = await vulnerabilitiesService.getCisReport();
      return success(res, report, 'CIS compliance audit completed');
    } catch (err) {
      logger.error(`Failed to run CIS benchmark: ${err.message}`);
      return error(res, err.message, 500);
    }
  }

  async listHardeningProfiles(req, res) {
    try {
      return success(res, hardeningService.listProfiles(), 'Hardening profiles loaded');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async previewHardeningProfile(req, res) {
    try {
      const preview = hardeningService.previewProfile(req.params.profile);
      return success(res, preview, 'Hardening diff preview generated');
    } catch (err) {
      return error(res, err.message, 400);
    }
  }

  async applyHardeningProfile(req, res) {
    try {
      const { confirmed } = req.body || {};
      const result = await hardeningService.applyProfile(req.params.profile, { confirmed: Boolean(confirmed) });
      return success(res, result, result.rolledBack ? 'Healthcheck failed; profile rolled back' : 'Hardening profile applied');
    } catch (err) {
      return error(res, err.message, 400);
    }
  }

  async rollbackHardeningProfile(req, res) {
    try {
      const result = await hardeningService.rollbackSnapshot();
      return success(res, result, 'Hardening snapshot rolled back');
    } catch (err) {
      return error(res, err.message, 400);
    }
  }

  async getFimStatus(req, res) {
    try {
      return success(res, fimService.getStatus(), 'FIM status loaded');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async checkFimNow(req, res) {
    try {
      const result = await fimService.checkNow();
      return success(res, result, 'FIM verification completed');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async acceptFimDrift(req, res) {
    try {
      const { file } = req.body || {};
      if (!file) return error(res, 'file is required', 400);
      return success(res, fimService.acceptDrift(file), 'FIM baseline updated');
    } catch (err) {
      return error(res, err.message, 400);
    }
  }
}

export default new VulnerabilitiesController();

