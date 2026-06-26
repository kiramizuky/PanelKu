import firewallService from './firewall.service.js';
import { success, errorResponse } from '../../helpers/response.js';

class FirewallController {
  async getStatus(req, res) {
    try {
      const status = await firewallService.getStatus();
      return success(res, status);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async toggleStatus(req, res) {
    try {
      const { enable } = req.body;
      if (enable) {
        await firewallService.enable();
      } else {
        await firewallService.disable();
      }
      return success(res, null, `Firewall ${enable ? 'enabled' : 'disabled'} successfully`);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async addRule(req, res) {
    try {
      const { port, protocol, action } = req.body;
      if (!port) return errorResponse(res, new Error('Port is required'), 400);

      await firewallService.addRule(port, protocol || 'tcp', action || 'allow');
      return success(res, null, 'Firewall rule added successfully');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async deleteRule(req, res) {
    try {
      const { id } = req.params;
      await firewallService.deleteRule(id);
      return success(res, null, 'Firewall rule deleted successfully');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }
}

export default new FirewallController();
