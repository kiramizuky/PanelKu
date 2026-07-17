import updaterService from './updater.service.js';
import { success, errorResponse } from '../../helpers/response.js';

class UpdaterController {
  // ── Version Info ───────────────────────────────────────────────
  async getVersionInfo(req, res) {
    try {
      const info = await updaterService.getVersionInfo();
      return success(res, info);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Check Updates ──────────────────────────────────────────────
  async checkForUpdates(req, res) {
    try {
      const data = await updaterService.checkForUpdates();
      return success(res, data);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Changelog ──────────────────────────────────────────────────
  async getChangelog(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const log = await updaterService.getChangelog(limit);
      return success(res, { entries: log });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Diff Preview ───────────────────────────────────────────────
  async getDiffPreview(req, res) {
    try {
      const data = await updaterService.getDiffPreview();
      return success(res, data);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Perform Update ─────────────────────────────────────────────
  async performUpdate(req, res) {
    try {
      const { method = 'git', branch = 'main', channel = 'stable', skipBackup = false, dryRun = false } = req.body;
      const result = await updaterService.performUpdate({ method, branch, channel, skipBackup, dryRun });
      return success(res, result, result.success ? 'Update completed successfully' : 'Update encountered issues');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Dry Run Update ─────────────────────────────────────────────
  async dryRunUpdate(req, res) {
    try {
      const { method = 'git', branch = 'main', channel = 'stable' } = req.body;
      const result = await updaterService.performUpdate({ method, branch, channel, dryRun: true });
      return success(res, result, 'Dry run completed');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Rollback ───────────────────────────────────────────────────
  async performRollback(req, res) {
    try {
      const { commit, restoreBackup } = req.body;
      if (!commit && !restoreBackup) {
        return errorResponse(res, 'Either commit hash or restoreBackup name is required', 400);
      }
      const result = await updaterService.performRollback({ commit, restoreBackup });
      return success(res, result, result.success ? 'Rollback completed' : 'Rollback failed');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Restart Panel ──────────────────────────────────────────────
  async restartPanel(req, res) {
    try {
      await updaterService.restartPanel();
      return success(res, null, 'Panel is restarting...');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Health Check ───────────────────────────────────────────────
  async runHealthCheck(req, res) {
    try {
      const result = await updaterService.runHealthCheck();
      return success(res, result);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Update History ─────────────────────────────────────────────
  async getUpdateHistory(req, res) {
    try {
      const history = await updaterService.getUpdateHistory();
      return success(res, history);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async clearUpdateHistory(req, res) {
    try {
      await updaterService.clearUpdateHistory();
      return success(res, null, 'Update history cleared');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Backups ────────────────────────────────────────────────────
  async listBackups(req, res) {
    try {
      const backups = await updaterService.listBackups();
      return success(res, backups);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async createBackup(req, res) {
    try {
      const backup = await updaterService.createPreUpdateBackup();
      return success(res, backup, 'Backup created successfully');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Schedule ───────────────────────────────────────────────────
  async getScheduleConfig(req, res) {
    try {
      const config = await updaterService.getScheduleConfig();
      return success(res, config);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async setScheduleConfig(req, res) {
    try {
      const config = await updaterService.setScheduleConfig(req.body);
      return success(res, config, 'Schedule configuration saved');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }
}

export default new UpdaterController();
