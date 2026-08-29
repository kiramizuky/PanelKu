import alertsService from './alerts.service.js';
import webpushService from './webpush.service.js';
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

  async getVapidPublicKey(req, res) {
    try {
      const publicKey = webpushService.getPublicKey();
      return success(res, { publicKey });
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async subscribeWebPush(req, res) {
    try {
      const { subscription } = req.body;
      const userAgent = req.headers['user-agent'] || '';
      const result = await webpushService.subscribe(req.user._id, subscription, userAgent);
      return success(res, result, 'Subscribed to WebPush notifications');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async unsubscribeWebPush(req, res) {
    try {
      const { endpoint } = req.body;
      const result = await webpushService.unsubscribe(endpoint);
      return success(res, result, 'Unsubscribed from WebPush notifications');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }
}

export default new AlertsController();

