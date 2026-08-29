import wafService from './waf.service.js';
import securityScannerService from './security-scanner.service.js';
import geoipService from './geoip.service.js';
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

  async getSecurityScan(req, res) {
    try {
      const scan = await securityScannerService.getLatestScan();
      return success(res, scan);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async runSecurityScan(req, res) {
    try {
      const scan = await securityScannerService.runScan();
      return success(res, scan, 'Security audit scan completed');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async fixSecurityIssue(req, res) {
    try {
      const { fixAction } = req.body;
      if (!fixAction) {
        return errorResponse(res, new Error('fixAction is required'), 400);
      }
      const result = await securityScannerService.applyFix(fixAction);
      return success(res, result, result.message || 'Fix applied successfully');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async getThreatMap(req, res) {
    try {
      const mapData = await geoipService.getThreatMapData();
      return success(res, mapData, 'Threat map data retrieved');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async blockCountry(req, res) {
    try {
      const { countryCode, description } = req.body;
      if (!countryCode) {
        return errorResponse(res, new Error('countryCode is required'), 400);
      }
      const result = await geoipService.blockCountry(countryCode, description);
      return success(res, result, `Country ${countryCode} has been blocked`);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async unblockCountry(req, res) {
    try {
      const { code } = req.params;
      const result = await geoipService.unblockCountry(code);
      return success(res, result, `Country ${code} has been unblocked`);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }
}

export default new WafController();


