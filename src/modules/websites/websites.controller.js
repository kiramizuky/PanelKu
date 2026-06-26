import websiteService from './websites.service.js';
import { successResponse, errorResponse } from '../../helpers/response.js';

class WebsitesController {
  async listWebsites(req, res) {
    try {
      const websites = await websiteService.listWebsites();
      return successResponse(res, { websites }, 'Websites retrieved');
    } catch (error) {
      return errorResponse(res, 500, error.message);
    }
  }

  async getWebsite(req, res) {
    try {
      const website = await websiteService.getWebsite(req.params.id);
      return successResponse(res, { website }, 'Website retrieved');
    } catch (error) {
      return errorResponse(res, 404, error.message);
    }
  }

  async createWebsite(req, res) {
    try {
      const { domain, aliases, type, rootDirectory, port } = req.body;
      if (!domain) return errorResponse(res, 400, 'Domain is required');
      
      const website = await websiteService.createWebsite({
        domain, aliases, type, rootDirectory, port
      }, req.user._id);

      return successResponse(res, { website }, 'Website created successfully', 201);
    } catch (error) {
      return errorResponse(res, 400, error.message);
    }
  }

  async updateWebsite(req, res) {
    try {
      const website = await websiteService.updateWebsite(req.params.id, req.body);
      return successResponse(res, { website }, 'Website updated');
    } catch (error) {
      return errorResponse(res, 400, error.message);
    }
  }

  async deleteWebsite(req, res) {
    try {
      await websiteService.deleteWebsite(req.params.id);
      return successResponse(res, null, 'Website deleted');
    } catch (error) {
      return errorResponse(res, 400, error.message);
    }
  }

  async deployGit(req, res) {
    try {
      const result = await websiteService.deployGit(req.params.id);
      return successResponse(res, result.message, { result });
    } catch (error) {
      return errorResponse(res, 500, error.message);
    }
  }
  async webhookDeploy(req, res) {
    try {
      const { id, token } = req.params;
      const website = await websiteService.getWebsite(id);
      if (!website || website.webhookToken !== token) {
        return errorResponse(res, 401, 'Unauthorized or invalid token');
      }
      
      const result = await websiteService.deployGit(id);
      return successResponse(res, result.message, { result });
    } catch (error) {
      return errorResponse(res, 500, error.message);
    }
  }
}

export default new WebsitesController();
