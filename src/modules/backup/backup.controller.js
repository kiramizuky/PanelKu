import backupService from './backup.service.js';
import { successResponse, errorResponse } from '../../helpers/response.js';

class BackupController {
  async getBackups(req, res) {
    try {
      const backups = await backupService.getBackups();
      successResponse(res, backups);
    } catch (error) {
      errorResponse(res, 500, error.message);
    }
  }

  async createBackup(req, res) {
    try {
      const { type, target } = req.body;
      if (!type || !target) return errorResponse(res, 400, 'Type and target are required');

      const result = await backupService.createBackup(type, target);
      successResponse(res, result, 'Backup created successfully');
    } catch (error) {
      errorResponse(res, 500, error.message);
    }
  }

  async deleteBackup(req, res) {
    try {
      const { filename } = req.body;
      if (!filename) return errorResponse(res, 400, 'Filename is required');

      await backupService.deleteBackup(filename);
      successResponse(res, null, 'Backup deleted successfully');
    } catch (error) {
      errorResponse(res, 500, error.message);
    }
  }

  async restoreBackup(req, res) {
    try {
      const { filename, target } = req.body;
      if (!filename || !target) return errorResponse(res, 400, 'Filename and target are required');

      const result = await backupService.restoreBackup(filename, target);
      successResponse(res, result, result.message);
    } catch (error) {
      errorResponse(res, 500, error.message);
    }
  }
}

export default new BackupController();
