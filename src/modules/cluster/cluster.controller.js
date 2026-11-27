import clusterService from './cluster.service.js';
import k8sService from './k8s.service.js';
import mtlsService from './mtls.service.js';
import { success, error } from '../../helpers/response.js';
import { withLock } from '../../helpers/moduleGuard.js';
import processRunner from '../../services/processRunner.js';

class ClusterController {
  async getNodes(req, res) {
    try {
      const nodes = await clusterService.getNodes();
      return success(res, nodes);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async addNode(req, res) {
    try {
      const { name, ipAddress, port, apiKey } = req.body;
      if (!name || !ipAddress || !apiKey) {
        return error(res, 'name, ipAddress, and apiKey are required', 400);
      }
      const node = await clusterService.addNode(name, ipAddress, port, apiKey);
      return success(res, node, 'Agent node added successfully');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async deleteNode(req, res) {
    try {
      const { id } = req.params;
      await clusterService.deleteNode(id);
      return success(res, null, 'Agent node deleted successfully');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async pingNode(req, res) {
    try {
      const { id } = req.params;
      const status = await clusterService.pingNode(id);
      return success(res, { status }, `Node status: ${status}`);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async getNodeMetrics(req, res) {
    try {
      const { id } = req.params;
      const metrics = await clusterService.getNodeMetrics(id);
      return success(res, metrics ?? {}, metrics ? 'Metrics retrieved' : 'Node offline or metrics unavailable');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  // ── Fleet Capacity Aggregation ────────────────────────────────

  async getFleetSummary(req, res) {
    try {
      const summary = await clusterService.getClusterFleetSummary();
      return success(res, summary, 'Cluster fleet summary retrieved');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  // ── 1-Click Pairing & Self-Registration ───────────────────────

  async generatePairingToken(req, res) {
    try {
      const { suggestedName } = req.body || {};
      const protocol = req.protocol || 'http';
      const host = req.get('host') || '127.0.0.1:23456';
      const masterUrl = `${protocol}://${host}`;

      const pairing = clusterService.generatePairingToken(suggestedName);
      const installScriptCmd = `curl -fsSL ${masterUrl}/api/cluster/install-script?token=${pairing.token} | sudo bash`;

      return success(res, {
        ...pairing,
        masterUrl,
        installScriptCmd,
      }, 'Pairing token generated');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async registerNodeByToken(req, res) {
    try {
      const { token, name, ipAddress, port, apiKey } = req.body;
      if (!token || !ipAddress || !apiKey) {
        return error(res, 'token, ipAddress, and apiKey are required', 400);
      }
      const node = await clusterService.registerNodeByToken({ token, name, ipAddress, port, apiKey });
      return success(res, node, 'Node paired and registered successfully');
    } catch (err) {
      return error(res, err.message, 400);
    }
  }

  async getInstallScript(req, res) {
    try {
      const { token } = req.query;
      const protocol = req.protocol || 'http';
      const host = req.get('host') || '127.0.0.1:23456';
      const masterUrl = `${protocol}://${host}`;

      const script = clusterService.getAgentInstallScript(token || '', masterUrl);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.send(script);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  // ── Distributed Remote Command Dispatcher ─────────────────────

  async executeCommand(req, res) {
    try {
      const { nodeIds, command } = req.body;
      if (!command || !nodeIds) {
        return error(res, 'nodeIds and command are required', 400);
      }
      const results = await clusterService.executeRemoteCommand(nodeIds, command);
      return success(res, { results }, 'Remote commands executed');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  // ── K3s / MicroK8s Cluster Support (Fase 5) ──
  async getK8sSummary(req, res) {
    try {
      const summary = await k8sService.getClusterSummary();
      return success(res, summary, 'Kubernetes cluster summary retrieved');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async getMtlsStatus(req, res) {
    try {
      return success(res, mtlsService.getStatus(), 'Cluster mTLS status retrieved');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async initMtlsCa(req, res) {
    const proc = processRunner.create(req.app.get('io'), {
      title: 'Initialize Cluster Internal mTLS CA',
      subtitle: 'Generating root CA and master client identity',
      steps: ['Generate CA key & certificate', 'Persist mTLS trust store']
    });
    try {
      const status = await withLock('cluster:mtls-ca', async () => {
        proc.startStep(0, 'Generating internal CA...');
        const s = await mtlsService.initCA();
        proc.completeStep(0, 'Generated');
        proc.startStep(1, 'Saved trust store...');
        return s;
      });
      proc.completeStep(1, 'Active');
      proc.finish(status, 'Internal Cluster CA initialized.');
      return success(res, { ...status, processId: proc.id }, 'Internal Cluster CA initialized');
    } catch (err) {
      proc.fail(err.message);
      return error(res, err.message, 500);
    }
  }

  async issueNodeMtlsCert(req, res) {
    try {
      const { id } = req.params;
      const { host } = req.body || {};
      const bundle = await mtlsService.issueNodeCert(id, host);
      return success(res, bundle, 'Node mTLS certificate issued');
    } catch (err) {
      return error(res, err.message, 400);
    }
  }
}

export default new ClusterController();

