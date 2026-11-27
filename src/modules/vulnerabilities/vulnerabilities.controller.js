/**
 * Panelku — Vulnerabilities Controller (v3.8.0)
 */

import vulnerabilitiesService from './vulnerabilities.service.js';
import hardeningService from './hardening.service.js';
import fimService from './fim.service.js';
import { success, error } from '../../helpers/response.js';
import logger from '../../config/logger.js';
import { withLock } from '../../helpers/moduleGuard.js';
import processRunner from '../../services/processRunner.js';

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
    const scanType = req.body.type || 'full';
    const proc = processRunner.create(req.app.get('io'), {
      title: `Vulnerability Scan (${scanType})`,
      subtitle: 'Scanning OS packages, runtimes, web configs, and plugins',
      steps: ['Run multi-vector security scan', 'Aggregate findings & risk score']
    });
    try {
      const result = await withLock('vuln:scan', async () => {
        proc.startStep(0, `Running ${scanType} scan...`);
        const r = await vulnerabilitiesService.startScan(scanType);
        proc.completeStep(0, 'Scan complete');
        proc.startStep(1, 'Saving scan report...');
        return r;
      });
      proc.completeStep(1, 'Saved');
      proc.finish(result, `Vulnerability ${scanType} scan completed.`);
      return success(res, { ...result, processId: proc.id }, 'Vulnerability scan completed successfully.');
    } catch (err) {
      proc.fail(err.message);
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
    const profile = req.params.profile;
    const { confirmed } = req.body || {};
    const proc = processRunner.create(req.app.get('io'), {
      title: `Apply Hardening Profile: ${profile}`,
      subtitle: 'Applying sshd, sysctl, fail2ban, and systemd baseline with healthcheck',
      steps: ['Snapshot current configs', 'Apply hardening rules & verify healthcheck']
    });
    try {
      const result = await withLock('vuln:hardening', async () => {
        proc.startStep(0, 'Snapshotting baseline configs...');
        proc.completeStep(0, 'Snapshotted');
        proc.startStep(1, `Applying ${profile} profile...`);
        return hardeningService.applyProfile(profile, { confirmed: Boolean(confirmed) });
      });
      proc.completeStep(1, result.rolledBack ? 'Rolled back' : 'Applied');
      proc.finish(result, result.rolledBack ? 'Healthcheck failed; profile rolled back.' : 'Hardening profile applied.');
      return success(res, { ...result, processId: proc.id }, result.rolledBack ? 'Healthcheck failed; profile rolled back' : 'Hardening profile applied');
    } catch (err) {
      proc.fail(err.message);
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

