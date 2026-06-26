import rolesService from './roles.service.js';
import { success, created, error } from '../../helpers/response.js';

class RolesController {
  async list(req, res) {
    try {
      const roles = await rolesService.list();
      return success(res, { roles });
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async getById(req, res) {
    try {
      const role = await rolesService.getById(req.params.id);
      return success(res, { role });
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async create(req, res) {
    try {
      const role = await rolesService.create(req.body);
      return created(res, { role }, 'Role created');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async update(req, res) {
    try {
      const role = await rolesService.update(req.params.id, req.body);
      return success(res, { role }, 'Role updated');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async updatePermissions(req, res) {
    try {
      const role = await rolesService.updatePermissions(req.params.id, req.body.permissions);
      return success(res, { role }, 'Permissions updated');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async delete(req, res) {
    try {
      await rolesService.delete(req.params.id);
      return success(res, {}, 'Role deleted');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async getAvailableResources(req, res) {
    return success(res, { resources: rolesService.getAvailableResources() });
  }
}

const rolesController = new RolesController();
export default rolesController;
