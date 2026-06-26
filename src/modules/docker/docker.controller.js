import dockerService from './docker.service.js';
import { successResponse, errorResponse } from '../../helpers/response.js';

class DockerController {
  async getSummary(req, res) {
    try {
      const summary = await dockerService.getDashboardSummary();
      if (!summary) return errorResponse(res, 503, 'Docker daemon not reachable');
      return successResponse(res, 'Docker summary retrieved', summary);
    } catch (error) {
      return errorResponse(res, 500, error.message);
    }
  }

  async listContainers(req, res) {
    try {
      const all = req.query.all !== 'false';
      const containers = await dockerService.listContainers(all);
      return successResponse(res, 'Containers retrieved', { containers });
    } catch (error) {
      return errorResponse(res, 500, error.message);
    }
  }

  async getContainer(req, res) {
    try {
      const info = await dockerService.getContainerInfo(req.params.id);
      return successResponse(res, 'Container details retrieved', { container: info });
    } catch (error) {
      return errorResponse(res, 404, error.message);
    }
  }

  async startContainer(req, res) {
    try {
      await dockerService.startContainer(req.params.id);
      return successResponse(res, 'Container started');
    } catch (error) {
      return errorResponse(res, 500, error.message);
    }
  }

  async stopContainer(req, res) {
    try {
      await dockerService.stopContainer(req.params.id);
      return successResponse(res, 'Container stopped');
    } catch (error) {
      return errorResponse(res, 500, error.message);
    }
  }

  async restartContainer(req, res) {
    try {
      await dockerService.restartContainer(req.params.id);
      return successResponse(res, 'Container restarted');
    } catch (error) {
      return errorResponse(res, 500, error.message);
    }
  }

  async killContainer(req, res) {
    try {
      await dockerService.killContainer(req.params.id);
      return successResponse(res, 'Container killed');
    } catch (error) {
      return errorResponse(res, 500, error.message);
    }
  }

  async removeContainer(req, res) {
    try {
      const force = req.query.force === 'true';
      await dockerService.removeContainer(req.params.id, force);
      return successResponse(res, 'Container removed');
    } catch (error) {
      return errorResponse(res, 500, error.message);
    }
  }

  async listImages(req, res) {
    try {
      const images = await dockerService.listImages();
      return successResponse(res, 'Images retrieved', { images });
    } catch (error) {
      return errorResponse(res, 500, error.message);
    }
  }

  async removeImage(req, res) {
    try {
      const force = req.query.force === 'true';
      await dockerService.removeImage(req.params.id, force);
      return successResponse(res, 'Image removed');
    } catch (error) {
      return errorResponse(res, 500, error.message);
    }
  }
}

export default new DockerController();
