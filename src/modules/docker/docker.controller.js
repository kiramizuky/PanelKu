import dockerService, { validateProjectName } from './docker.service.js';
import { successResponse, errorResponse } from '../../helpers/response.js';

function cleanId(id) {
  if (!id) return '';
  return String(id).replace(/^["']|["']$/g, '').trim();
}

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
      const id = cleanId(req.params.id);
      const info = await dockerService.getContainerInfo(id);
      return successResponse(res, { container: info }, 'Container details retrieved');
    } catch (error) {
      return errorResponse(res, error.message, 404);
    }
  }

  async startContainer(req, res) {
    try {
      const id = cleanId(req.params.id);
      await dockerService.startContainer(id);
      return successResponse(res, null, 'Container started');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async stopContainer(req, res) {
    try {
      const id = cleanId(req.params.id);
      await dockerService.stopContainer(id);
      return successResponse(res, null, 'Container stopped');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async restartContainer(req, res) {
    try {
      const id = cleanId(req.params.id);
      await dockerService.restartContainer(id);
      return successResponse(res, null, 'Container restarted');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async killContainer(req, res) {
    try {
      const id = cleanId(req.params.id);
      await dockerService.killContainer(id);
      return successResponse(res, null, 'Container killed');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async removeContainer(req, res) {
    try {
      const id = cleanId(req.params.id);
      const force = req.query.force === 'true';
      await dockerService.removeContainer(id, force);
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
      const id = cleanId(req.params.id);
      const force = req.query.force === 'true';
      await dockerService.removeImage(id, force);
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
      if (!projectName || !yaml) return errorResponse(res, 'Project name and docker-compose YAML are required', 400);
      if (!validateProjectName(projectName)) {
        return errorResponse(res, 'Invalid project name: use letters, digits, underscore or dash (max 64 chars)', 400);
      }
      const result = await dockerService.deployCompose(projectName, yaml);
      return successResponse(res, result, 'Docker Compose deployed successfully');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async getAppStore(req, res) {
    try {
      const catalog = dockerService.getAppStoreCatalog();
      return successResponse(res, { catalog }, 'App Store catalog retrieved');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async installAppTemplate(req, res) {
    try {
      const { templateId, projectName, customValues } = req.body;
      if (!templateId) return errorResponse(res, 'templateId is required', 400);
      const result = await dockerService.installAppStoreTemplate(templateId, projectName, customValues);
      return successResponse(res, result, 'App template installed and deployed successfully');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async getContainerStats(req, res) {
    try {
      const id = cleanId(req.params.id);
      const stats = await dockerService.getContainerStats(id);
      return successResponse(res, { stats }, 'Container stats retrieved');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async updateContainerResources(req, res) {
    try {
      const id = cleanId(req.params.id);
      const result = await dockerService.updateContainerResources(id, req.body);
      return successResponse(res, result, 'Container resources updated successfully');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Compose Stacks & Studio Endpoints ─────────────────────────

  async listComposeStacks(req, res) {
    try {
      const stacks = await dockerService.listComposeProjects();
      return successResponse(res, { stacks }, 'Compose stacks retrieved');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async getComposeStack(req, res) {
    try {
      const name = cleanId(req.params.name);
      const stack = await dockerService.getComposeProject(name);
      return successResponse(res, { stack }, 'Compose stack details retrieved');
    } catch (error) {
      return errorResponse(res, error.message, 404);
    }
  }

  async startComposeStack(req, res) {
    try {
      const name = cleanId(req.params.name);
      const result = await dockerService.startComposeProject(name);
      return successResponse(res, result, `Stack ${name} started successfully`);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async stopComposeStack(req, res) {
    try {
      const name = cleanId(req.params.name);
      const result = await dockerService.stopComposeProject(name);
      return successResponse(res, result, `Stack ${name} stopped successfully`);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async restartComposeStack(req, res) {
    try {
      const name = cleanId(req.params.name);
      const result = await dockerService.restartComposeProject(name);
      return successResponse(res, result, `Stack ${name} restarted successfully`);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async deleteComposeStack(req, res) {
    try {
      const name = cleanId(req.params.name);
      const removeVolumes = req.query.removeVolumes === 'true';
      const result = await dockerService.deleteComposeProject(name, { removeVolumes });
      return successResponse(res, result, `Stack ${name} deleted successfully`);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async getComposeLogs(req, res) {
    try {
      const name = cleanId(req.params.name);
      const lines = parseInt(req.query.lines, 10) || 200;
      const service = req.query.service || '';
      const logs = await dockerService.getComposeLogs(name, { lines, service });
      return successResponse(res, { logs }, 'Compose logs retrieved');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async createAutoProxy(req, res) {
    try {
      const { domain, port } = req.body;
      const userId = req.user?.id || req.user?._id;
      const website = await dockerService.createAutoProxy({ domain, port, userId });
      return successResponse(res, { website }, `Auto HTTPS proxy created for ${domain}`);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }
}

export default new DockerController();

