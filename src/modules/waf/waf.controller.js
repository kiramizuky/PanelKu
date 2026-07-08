import wafService from './waf.service.js';
import { success, errorResponse } from '../../helpers/response.js';

class WafController {
  async getRules(req, res) {
    try {
      const rules = await wafService.getRules();
      return success(res, rules);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async addRule(req, res) {
    try {
      const { type, value, action, description } = req.body;
      if (!type || !value || !action) {
        return errorResponse(res, new Error('type, value, and action are required'), 400);
      }

      const rule = await wafService.addRule(type, value, action, description);
      return success(res, rule, 'WAF rule added successfully');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async deleteRule(req, res) {
    try {
      const { id } = req.params;
      await wafService.deleteRule(id);
      return success(res, null, 'WAF rule deleted successfully');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async getFail2BanLogs(req, res) {
    try {
      const logs = await wafService.getFail2BanLogs();
      return success(res, logs);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }
}

export default new WafController();
