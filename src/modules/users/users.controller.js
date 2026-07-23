import usersService from './users.service.js';
import { success, created, error, paginated } from '../../helpers/response.js';

function cleanId(id) {
  if (!id) return '';
  return String(id).replace(/^["']|["']$/g, '').trim();
}

class UsersController {
  async list(req, res) {
    try {
      const { page = 1, limit = 20, search = '' } = req.query;
      const result = await usersService.list(page, limit, search);
      return paginated(res, result);
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async getById(req, res) {
    try {
      const id = cleanId(req.params.id);
      const user = await usersService.getById(id);
      return success(res, { user });
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async create(req, res) {
    try {
      const user = await usersService.create(req.body);
      return created(res, { user }, 'User created successfully');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async update(req, res) {
    try {
      const id = cleanId(req.params.id);
      const user = await usersService.update(id, req.body);
      return success(res, { user }, 'User updated successfully');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async updateMyProfile(req, res) {
    try {
      const { username, email } = req.body;
      const userId = cleanId(req.user._id || req.user.id);
      const user = await usersService.update(userId, { username, email });
      return success(res, { user }, 'Profile updated successfully');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async changePassword(req, res) {
    try {
      const { currentPassword, newPassword } = req.body;
      const userId = cleanId(req.user._id || req.user.id);
      await usersService.changePassword(userId, currentPassword, newPassword);
      return success(res, {}, 'Password changed successfully');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async delete(req, res) {
    try {
      const id = cleanId(req.params.id);
      const requestingUserId = cleanId(req.user._id || req.user.id);
      await usersService.delete(id, requestingUserId);
      return success(res, {}, 'User deleted successfully');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async toggleStatus(req, res) {
    try {
      const id = cleanId(req.params.id);
      const user = await usersService.toggleStatus(id);
      return success(res, { user }, 'User status updated');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async regenerateApiKey(req, res) {
    try {
      const apiKey = await usersService.regenerateApiKey(req.user._id);
      return success(res, { apiKey }, 'API key regenerated');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async revokeApiKey(req, res) {
    try {
      await usersService.revokeApiKey(req.user._id);
      return success(res, {}, 'API key revoked');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async getAiSettings(req, res) {
    try {
      const user = await usersService.getById(req.user._id);
      return success(res, { aiSettings: user.aiSettings });
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async updateAiSettings(req, res) {
    try {
      const { provider, apiKey, model } = req.body;
      const user = await usersService.update(req.user._id, {
        aiSettings: { provider, apiKey, model }
      });
      return success(res, { aiSettings: user.aiSettings }, 'AI settings updated successfully');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }
}

const usersController = new UsersController();
export default usersController;
