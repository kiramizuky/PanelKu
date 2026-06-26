import userRepository from '../../repositories/user.repository.js';
import roleRepository from '../../repositories/role.repository.js';
import permissionManager from '../../core/permissions/PermissionManager.js';
import { generateApiKey } from '../../helpers/crypto.js';
import { toSlug } from '../../helpers/validate.js';
import eventBus, { EVENTS } from '../../core/events/EventBus.js';

class UsersService {
  async list(page = 1, limit = 20, search = '') {
    const filter = search
      ? { $or: [{ username: new RegExp(search, 'i') }, { email: new RegExp(search, 'i') }] }
      : {};
    const result = await userRepository.paginate(filter, page, limit, { populate: 'role', sort: { createdAt: -1 } });
    return result;
  }

  async getById(id) {
    const user = await userRepository.findById(id, { populate: 'role' });
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });
    return user;
  }

  async create(data) {
    const existing = await userRepository.findOne({
      $or: [{ username: data.username }, { email: data.email }],
    });
    if (existing) throw Object.assign(new Error('Username or email already exists'), { statusCode: 409 });

    const role = await roleRepository.findBySlug(data.role || 'read_only');
    if (!role) throw Object.assign(new Error('Role not found'), { statusCode: 400 });

    const user = await userRepository.create({ ...data, role: role._id });
    eventBus.publish(EVENTS.USER_CREATED, { userId: user._id, username: user.username });
    return userRepository.findById(user._id, { populate: 'role' });
  }

  async update(id, data) {
    const { password, role: roleName, ...rest } = data;

    if (roleName) {
      const role = await roleRepository.findBySlug(roleName);
      if (role) rest.role = role._id;
    }

    const user = await userRepository.updateById(id, rest, { new: true, runValidators: true });
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });

    eventBus.publish(EVENTS.USER_UPDATED, { userId: id });
    return userRepository.findById(id, { populate: 'role' });
  }

  async changePassword(id, currentPassword, newPassword) {
    const user = await userRepository.findById(id, { select: '+password' });
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });

    const valid = await user.comparePassword(currentPassword);
    if (!valid) throw Object.assign(new Error('Current password is incorrect'), { statusCode: 400 });

    user.password = newPassword;
    await user.save();
  }

  async delete(id, requestingUserId) {
    if (String(id) === String(requestingUserId)) {
      throw Object.assign(new Error('Cannot delete your own account'), { statusCode: 400 });
    }
    const user = await userRepository.findById(id);
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });
    if (user.isSuperAdmin) throw Object.assign(new Error('Cannot delete super admin'), { statusCode: 403 });

    await userRepository.deleteById(id);
    eventBus.publish(EVENTS.USER_DELETED, { userId: id });
  }

  async toggleStatus(id) {
    const user = await userRepository.findById(id);
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });
    return userRepository.updateById(id, { isActive: !user.isActive });
  }

  async regenerateApiKey(userId) {
    const apiKey = generateApiKey();
    await userRepository.updateById(userId, { apiKey, apiKeyEnabled: true });
    return apiKey;
  }

  async revokeApiKey(userId) {
    await userRepository.updateById(userId, { apiKeyEnabled: false });
  }
}

const usersService = new UsersService();
export default usersService;
