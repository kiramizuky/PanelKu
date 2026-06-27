import dockerService from './docker.service.js';
import { successResponse, errorResponse } from '../../helpers/response.js';

class DockerController {
  async getSummary(req, res) {
    try {
      const summary = await dockerService.getDashboardSummary();
      if (!summary) return errorResponse(res, 'Docker daemon not reachable', 503);
      return successResponse(res, summary, 'Docker summary retrieved');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async listContainers(req, res) {
    try {
      const all = req.query.all !== 'false';
      const containers = await dockerService.listContainers(all);
      return successResponse(res, { containers }, 'Containers retrieved');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async getContainer(req, res) {
    try {
      const info = await dockerService.getContainerInfo(req.params.id);
      return successResponse(res, { container: info }, 'Container details retrieved');
    } catch (error) {
      return errorResponse(res, error.message, 404);
    }
  }

  async startContainer(req, res) {
    try {
      await dockerService.startContainer(req.params.id);
      return successResponse(res, null, 'Container started');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async stopContainer(req, res) {
    try {
      await dockerService.stopContainer(req.params.id);
      return successResponse(res, null, 'Container stopped');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async restartContainer(req, res) {
    try {
      await dockerService.restartContainer(req.params.id);
      return successResponse(res, null, 'Container restarted');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async killContainer(req, res) {
    try {
      await dockerService.killContainer(req.params.id);
      return successResponse(res, null, 'Container killed');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async removeContainer(req, res) {
    try {
      const force = req.query.force === 'true';
      await dockerService.removeContainer(req.params.id, force);
      return successResponse(res, null, 'Container removed');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async listImages(req, res) {
    try {
      const images = await dockerService.listImages();
      return successResponse(res, { images }, 'Images retrieved');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async removeImage(req, res) {
    try {
      const force = req.query.force === 'true';
      await dockerService.removeImage(req.params.id, force);
      return successResponse(res, null, 'Image removed');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async pruneImages(req, res) {
    try {
      const result = await dockerService.pruneImages();
      const count = result?.ImagesDeleted?.length || 0;
      const reclaimed = result?.SpaceReclaimed || 0;
      return successResponse(res, { count, reclaimed }, `Pruned ${count} unused images`);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async searchImages(req, res) {
    try {
      const { term } = req.query;
      if (!term) return errorResponse(res, 400, 'Search term is required');
      const results = await dockerService.searchImages(term);
      return successResponse(res, { results }, 'Images search results');
    } catch (error) {
      return errorResponse(res, 500, error.message);
    }
  }

  async createContainer(req, res) {
    try {
      const result = await dockerService.createContainer(req.body);
      return successResponse(res, result, 'Container created successfully');
    } catch (error) {
      return errorResponse(res, 500, error.message);
    }
  }

  async deployCompose(req, res) {
    try {
      const { projectName, yaml } = req.body;
      if (!projectName || !yaml) return errorResponse(res, 400, 'Project name and docker-compose YAML are required');
      const result = await dockerService.deployCompose(projectName, yaml);
      return successResponse(res, result, 'Docker Compose deployed successfully');
    } catch (error) {
      return errorResponse(res, 500, error.message);
    }
  }
}

export default new DockerController();
