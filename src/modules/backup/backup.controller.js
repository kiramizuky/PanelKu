import backupService from './backup.service.js';
import snapshotService from './snapshot.service.js';
import { successResponse, errorResponse } from '../../helpers/response.js';

class BackupController {
  // ── Rclone Management ────────────────────────────────────────────

  async getRcloneStatus(req, res) {
    try {
      const status = await backupService.getRcloneStatus();
      return successResponse(res, { status });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async installRclone(req, res) {
    try {
      const result = await backupService.installRclone();
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async testRemote(req, res) {
    try {
      const { name } = req.body;
      if (!name) return errorResponse(res, 'Remote name is required', 400);
      const result = await backupService.testRemote(name);
      return successResponse(res, result, 'Connection successful');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async listRemoteFiles(req, res) {
    try {
      const { remote, path: remotePath } = req.query;
      if (!remote) return errorResponse(res, 'Remote name is required', 400);
      const result = await backupService.listRemoteFiles(remote, remotePath);
      return successResponse(res, result);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Backup Jobs ──────────────────────────────────────────────────

  async getBackupJobs(req, res) {
    try {
      const data = await backupService.getBackupJobs();
      return successResponse(res, data);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async createBackupJob(req, res) {
    try {
      const result = await backupService.createBackupJob(req.body);
      return successResponse(res, result, result.message, 201);
    } catch (error) {
      return errorResponse(res, error.message, error.statusCode || 400);
    }
  }

  async updateBackupJob(req, res) {
    try {
      const result = await backupService.updateBackupJob(req.params.id, req.body);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, error.statusCode || 400);
    }
  }

  async deleteBackupJob(req, res) {
    try {
      const result = await backupService.deleteBackupJob(req.params.id);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, error.statusCode || 400);
    }
  }

  async runBackupJob(req, res) {
    try {
      const result = await backupService.runBackupJob(req.params.id);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Local Backups ────────────────────────────────────────────────

  async getBackups(req, res) {
    try {
      const backups = await backupService.getBackups();
      return successResponse(res, backups || []);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async createBackup(req, res) {
    try {
      const { type, target } = req.body;
      if (!type || !target) return errorResponse(res, 'Type and target are required', 400);

      const result = await backupService.createBackup(type, target);
      return successResponse(res, result, 'Backup created successfully');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async deleteBackup(req, res) {
    try {
      const { filename } = req.body;
      if (!filename) return errorResponse(res, 'Filename is required', 400);

      await backupService.deleteBackup(filename);
      return successResponse(res, null, 'Backup deleted successfully');
    } catch (error) {
      return errorResponse(res, error.message, error.statusCode || 500);
    }
  }

  async restoreBackup(req, res) {
    try {
      const { filename, target } = req.body;
      if (!filename || !target) return errorResponse(res, 'Filename and target are required', 400);

      const result = await backupService.restoreBackup(filename, target);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── S3 Configuration ─────────────────────────────────────────────

  async getS3Config(req, res) {
    try {
      const config = await backupService.getS3Config();
      return successResponse(res, config);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async updateS3Config(req, res) {
    try {
      const result = await backupService.updateS3Config(req.body || {});
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, error.statusCode || 400);
    }
  }

  async testS3Connection(req, res) {
    try {
      const result = await backupService.testS3Connection();
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async listS3Backups(req, res) {
    try {
      const prefix = req.query.prefix || '';
      const result = await backupService.listS3Backups(prefix);
      return successResponse(res, result);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async downloadFromS3(req, res) {
    try {
      const { key } = req.body;
      if (!key) return errorResponse(res, 'S3 key is required', 400);
      const result = await backupService.downloadFromS3(key);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Rclone Custom Config Path ───────────────────────────────────

  async getRcloneConfigPath(req, res) {
    try {
      const result = await backupService.getRcloneConfigPathSetting();
      return successResponse(res, { path: result });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async setRcloneConfigPath(req, res) {
    try {
      const { path: customPath } = req.body;
      const result = await backupService.setRcloneConfigPathSetting(customPath || null);
      return successResponse(res, result, 'Config path saved');
    } catch (error) {
      return errorResponse(res, error.message, error.statusCode || 400);
    }
  }

  async testRcloneConfigPath(req, res) {
    try {
      const { path: customPath } = req.body;
      if (!customPath) return errorResponse(res, 'Path is required', 400);
      const result = await backupService.testRcloneConfigPath(customPath);
      return successResponse(res, result, `Found ${result.count} remote(s)`);
    } catch (error) {
      return errorResponse(res, error.message, 400);
    }
  }

  async listRemoteBackups(req, res) {
    try {
      const { remote, path: remotePath } = req.query;
      if (!remote) return errorResponse(res, 'Remote name is required', 400);
      const result = await backupService.listRemoteBackups(remote, remotePath || 'backups');
      return successResponse(res, result);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async restoreFromRemote(req, res) {
    try {
      const { remote, remotePath, localTarget } = req.body;
      if (!remote || !remotePath || !localTarget) {
        return errorResponse(res, 'Remote, remotePath, and localTarget are required', 400);
      }
      const result = await backupService.restoreFromRemote(remote, remotePath, localTarget);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Instant Volume Snapshots & Rollback (Fase 4) ──────────────────

  async listSnapshots(req, res) {
    try {
      const snapshots = await snapshotService.listSnapshots();
      return successResponse(res, { snapshots }, 'Snapshots retrieved');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async createSnapshot(req, res) {
    try {
      const { name, targetPath, description } = req.body;
      if (!name) return errorResponse(res, 'Snapshot name is required', 400);
      const snapshot = await snapshotService.createSnapshot(name, targetPath, description);
      return successResponse(res, { snapshot }, 'Snapshot created successfully');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async rollbackSnapshot(req, res) {
    try {
      const { id } = req.params;
      const result = await snapshotService.rollbackSnapshot(id);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async verifySnapshot(req, res) {
    try {
      const { id } = req.params;
      const result = await snapshotService.verifySnapshot(id);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async deleteSnapshot(req, res) {
    try {
      const { id } = req.params;
      await snapshotService.deleteSnapshot(id);
      return successResponse(res, null, 'Snapshot deleted successfully');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }
}

export default new BackupController();

