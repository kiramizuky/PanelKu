/**
 * Panelku — Vulnerabilities Controller (v3.8.0)
 */

import vulnerabilitiesService from './vulnerabilities.service.js';
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
      return success(res, result, 'Pemindaian kerentanan berhasil diselesaikan.');
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
        return success(res, report, 'Export successful');
      }

      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="panelku-vulnerability-report.md"');
      return res.send(report);
    } catch (err) {
      logger.error(`Failed to export report: ${err.message}`);
      return error(res, err.message, 500);
    }
  }
}

export default new VulnerabilitiesController();

