import alertsService from './alerts.service.js';
import { success, errorResponse } from '../../helpers/response.js';

class AlertsController {
  async getConfig(req, res) {
    try {
      const config = await alertsService.getConfig();
      return success(res, config);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async updateConfig(req, res) {
    try {
      const config = await alertsService.updateConfig(req.body);
      return success(res, config, 'Alert configuration updated successfully');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async testAlert(req, res) {
    try {
      await alertsService.triggerAlert('Test Alert', 'This is a test alert from your Linux Server Control Panel.');
      return success(res, null, 'Test alert dispatched');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }
}

export default new AlertsController();
