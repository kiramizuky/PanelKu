import firewallService from './firewall.service.js';
import nftablesService from './nftables.service.js';
import { success, errorResponse } from '../../helpers/response.js';
import { withLock } from '../../helpers/moduleGuard.js';
import processRunner from '../../services/processRunner.js';

class FirewallController {
  async getStatus(req, res) {
    try {
      const status = await firewallService.getStatus();
      return success(res, status);
    } catch (error) {
      return errorResponse(res, error.message || 'Internal server error', 500);
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
      return errorResponse(res, error.message || 'Internal server error', 500);
    }
  }

  async addRule(req, res) {
    try {
      const { port, protocol, action } = req.body;
      if (!port) return errorResponse(res, 'Port is required', 400);

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
      return errorResponse(res, error.message || 'Internal server error', 500);
    }
  }

  async getNftablesStatus(req, res) {
    try {
      const status = await nftablesService.getStatus();
      return success(res, status);
    } catch (error) {
      return errorResponse(res, error.message || 'Internal server error', 500);
    }
  }

  async enableEgressFilter(req, res) {
    const { allowedTcpPorts, allowedUdpPorts } = req.body || {};
    const proc = processRunner.create(req.app.get('io'), {
      title: 'Configure nftables Outbound Egress Filter',
      subtitle: 'Applying outbound port allowlist to prevent reverse shells',
      steps: ['Validate port allowlist', 'Apply nftables egress policy']
    });
    try {
      const result = await withLock('firewall:nftables', async () => {
        proc.startStep(0, 'Validating ports...');
        proc.completeStep(0, 'Valid');
        proc.startStep(1, 'Applying nftables rules...');
        return nftablesService.enableEgressFilter({ allowedTcpPorts, allowedUdpPorts });
      });
      proc.completeStep(1, 'Active');
      proc.finish(result, 'Outbound egress filter configured.');
      return success(res, { ...result, processId: proc.id }, 'Outbound egress filter configured');
    } catch (error) {
      proc.fail(error.message);
      return errorResponse(res, error.message || 'Invalid egress configuration', 400);
    }
  }

  async disableEgressFilter(req, res) {
    try {
      const result = await nftablesService.disableEgressFilter();
      return success(res, result, 'Outbound egress filter removed');
    } catch (error) {
      return errorResponse(res, error.message || 'Internal server error', 500);
    }
  }

  async addNftIngressRule(req, res) {
    try {
      const { port, protocol, action } = req.body || {};
      if (!port) return errorResponse(res, 'Port is required', 400);
      const result = await nftablesService.addIngressRule({ port, protocol, action });
      return success(res, result, 'nftables ingress rule applied');
    } catch (error) {
      return errorResponse(res, error.message || 'Invalid ingress rule', 400);
    }
  }
}

export default new FirewallController();
