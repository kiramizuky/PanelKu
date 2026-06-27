import userRepository from '../../repositories/user.repository.js';
import roleRepository from '../../repositories/role.repository.js';
import permissionManager from '../../core/permissions/PermissionManager.js';
import { generateApiKey } from '../../helpers/crypto.js';
import { toSlug } from '../../helpers/validate.js';
import eventBus, { EVENTS } from '../../core/events/EventBus.js';
import bcrypt from 'bcryptjs';
import { getDb } from '../../core/db/sqlite.js';

class UsersService {
  async list(page = 1, limit = 20, search = '') {
    // SQLite doesn't support $or, do filtering manually
    const all = await userRepository.findWithRole({});
    let filtered = all;
    if (search) {
      const q = search.toLowerCase();
      filtered = all.filter(u =>
        u.username.includes(q) || (u.email || '').includes(q)
      );
    }
    const total = filtered.length;
    page  = parseInt(page);
    limit = parseInt(limit);
    const data = filtered.slice((page - 1) * limit, page * limit);
    return { data, total, page, limit };
  }

  async getById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!row) throw Object.assign(new Error('User not found'), { statusCode: 404 });

    const User = (await import('../../models/User.js')).default;
    const user = await User.findById(id);
    return userRepository._populateRole(user);
  }

  async create(data) {
    const db = getDb();
    const existingUsername = db.prepare('SELECT id FROM users WHERE username = ?').get(data.username?.toLowerCase());
    const existingEmail    = db.prepare('SELECT id FROM users WHERE email = ?').get(data.email?.toLowerCase());
    if (existingUsername || existingEmail) {
      throw Object.assign(new Error('Username or email already exists'), { statusCode: 409 });
    }

    const role = await roleRepository.findBySlug(data.role || 'read_only');
    if (!role) throw Object.assign(new Error('Role not found'), { statusCode: 400 });

    const user = await userRepository.create({ ...data, role: role._id });
    eventBus.publish(EVENTS.USER_CREATED, { userId: user._id, username: user.username });
    return userRepository._populateRole(user);
  }

  async update(id, data) {
    const { password, role: roleName, ...rest } = data;

    if (roleName) {
      const role = await roleRepository.findBySlug(roleName);
      if (role) rest.role = role._id;
    }

    const user = await userRepository.updateById(id, rest);
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });

    eventBus.publish(EVENTS.USER_UPDATED, { userId: id });
    return userRepository._populateRole(user);
  }

  async changePassword(id, currentPassword, newPassword) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!row) throw Object.assign(new Error('User not found'), { statusCode: 404 });

    const valid = await bcrypt.compare(currentPassword, row.password);
    if (!valid) throw Object.assign(new Error('Current password is incorrect'), { statusCode: 400 });

    const hashed = await bcrypt.hash(newPassword, 12);
    db.prepare('UPDATE users SET password = ?, updated_at = ? WHERE id = ?').run(
      hashed, new Date().toISOString(), id
    );
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
