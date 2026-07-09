import clusterService from './cluster.service.js';
import { success, errorResponse } from '../../helpers/response.js';

class ClusterController {
  async getNodes(req, res) {
    try {
      const nodes = await clusterService.getNodes();
      return success(res, nodes);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async addNode(req, res) {
    try {
      const { name, ipAddress, port, apiKey } = req.body;
      if (!name || !ipAddress || !apiKey) {
        return errorResponse(res, new Error('name, ipAddress, and apiKey are required'), 400);
      }
      const node = await clusterService.addNode(name, ipAddress, port, apiKey);
      return success(res, node, 'Agent node added successfully');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async deleteNode(req, res) {
    try {
      const { id } = req.params;
      await clusterService.deleteNode(id);
      return success(res, null, 'Agent node deleted successfully');
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }

  async pingNode(req, res) {
    try {
      const { id } = req.params;
      const status = await clusterService.pingNode(id);
      return success(res, { status }, `Node status is: ${status}`);
    } catch (error) {
      return errorResponse(res, error, 500);
    }
  }
}

export default new ClusterController();
