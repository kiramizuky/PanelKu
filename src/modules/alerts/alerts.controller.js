import alertsService from './alerts.service.js';
import { success, error } from '../../helpers/response.js';

class AlertsController {
  async getConfig(req, res) {
    try {
      const config = await alertsService.getConfig();
      return success(res, config);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async updateConfig(req, res) {
    try {
      const config = await alertsService.updateConfig(req.body);
      return success(res, config, 'Alert configuration updated successfully');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async testAlert(req, res) {
    try {
      await alertsService.triggerAlert('Test Alert', 'This is a test alert from your Linux Server Control Panel.');
      return success(res, null, 'Test alert dispatched');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }
}

export default new AlertsController();
