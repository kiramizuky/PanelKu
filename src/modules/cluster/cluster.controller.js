import clusterService from './cluster.service.js';
import k8sService from './k8s.service.js';
import { success, error } from '../../helpers/response.js';

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

  // ── K3s / MicroK8s Cluster Support (Fase 5) ──
  async getK8sSummary(req, res) {
    try {
      const summary = await k8sService.getClusterSummary();
      return success(res, summary, 'Kubernetes cluster summary retrieved');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }
}

export default new ClusterController();

